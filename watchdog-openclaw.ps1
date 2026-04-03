[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$RestartOnFailure,
    [switch]$AlertOnFailure,
    [switch]$SkipInternetCheck,
    [int]$RecoveryWaitSeconds = 20
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = (Get-Location).Path
    if ($Arguments.Count -gt 0) {
        $psi.Arguments = [string]::Join(" ", ($Arguments | ForEach-Object {
                    if ($_ -match '[\s"]') {
                        '"' + ($_ -replace '\\', '\\' -replace '"', '\"') + '"'
                    }
                    else {
                        $_
                    }
                }))
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $exitCode = $process.ExitCode
    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Test-InternetReachable {
    try {
        return [bool](Test-Connection -ComputerName "1.1.1.1" -Count 1 -Quiet -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-TelegramAlertConfig {
    param([Parameter(Mandatory = $true)][string]$OpenClawConfigFile)

    if (-not (Test-Path $OpenClawConfigFile)) {
        return $null
    }

    $cfg = Get-Content -Raw $OpenClawConfigFile | ConvertFrom-Json
    $telegram = $cfg.channels.telegram
    if ($null -eq $telegram -or -not $telegram.enabled) {
        return $null
    }

    $chatId = $null
    if ($telegram.allowFrom -and @($telegram.allowFrom).Count -gt 0) {
        $chatId = [string]@($telegram.allowFrom)[0]
    }

    if (-not $telegram.botToken -or -not $chatId) {
        return $null
    }

    [pscustomobject]@{
        BotToken = [string]$telegram.botToken
        ChatId   = $chatId
    }
}

function Send-TelegramAlert {
    param(
        [Parameter(Mandatory = $true)]$AlertConfig,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $uri = "https://api.telegram.org/bot$($AlertConfig.BotToken)/sendMessage"
    $body = @{
        chat_id = $AlertConfig.ChatId
        text    = $Message
    }

    Invoke-RestMethod -Method Post -Uri $uri -Body $body | Out-Null
}

function Get-HealthReport {
    param([Parameter(Mandatory = $true)][string]$ContainerName)

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "health", "--json"
    ) -AllowFailure

    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return $null
    }

    try {
        return ($result.Output | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$bootstrapConfig = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$bootstrapConfig = Resolve-PortableConfigPaths -Config $bootstrapConfig -BaseDir (Split-Path -Parent $ConfigPath)
$repoPath = [string]$bootstrapConfig.repoPath
$containerName = "openclaw-openclaw-gateway-1"
$openClawConfigFile = Join-Path (Get-HostConfigDir -Config $bootstrapConfig) "openclaw.json"
$alertConfig = $null

Write-Step "Running watchdog health check"

if (-not $SkipInternetCheck) {
    if (-not (Test-InternetReachable)) {
        Write-Host "Internet pre-check failed. Exiting quietly to avoid false alerts." -ForegroundColor Yellow
        exit 0
    }
}

$health = Get-HealthReport -ContainerName $containerName
if ($null -ne $health -and $health.ok) {
    Write-Host "OpenClaw health is OK." -ForegroundColor Green
    exit 0
}

$failureSummary = if ($null -ne $health) {
    ($health | ConvertTo-Json -Depth 8 -Compress)
}
else {
    "health probe failed"
}

Write-Host "OpenClaw health check failed." -ForegroundColor Yellow

if ($AlertOnFailure) {
    $alertConfig = Get-TelegramAlertConfig -OpenClawConfigFile $openClawConfigFile
    if ($null -ne $alertConfig) {
        $message = "OpenClaw watchdog detected a failure on $env:COMPUTERNAME. Summary: $failureSummary"
        try {
            Send-TelegramAlert -AlertConfig $alertConfig -Message $message
            Write-Host "Telegram failure alert sent." -ForegroundColor Green
        }
        catch {
            Write-Host "Telegram alert failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "Telegram alert skipped because bot token or allowlist chat ID is not available." -ForegroundColor Yellow
    }
}

if (-not $RestartOnFailure) {
    exit 1
}

Write-Step "Restarting the OpenClaw gateway"
$restart = Invoke-External -FilePath "docker" -Arguments @(
    "compose", "-f", (Join-Path $repoPath "docker-compose.yml"),
    "restart", "openclaw-gateway"
) -AllowFailure

if ($restart.ExitCode -ne 0) {
    throw "Gateway restart failed.`n$($restart.Output)"
}

Start-Sleep -Seconds $RecoveryWaitSeconds

$recheck = Get-HealthReport -ContainerName $containerName
if ($null -ne $recheck -and $recheck.ok) {
    Write-Host "Gateway recovered after restart." -ForegroundColor Green
    if ($AlertOnFailure -and $null -ne $alertConfig) {
        try {
            Send-TelegramAlert -AlertConfig $alertConfig -Message "OpenClaw watchdog restarted the gateway on $env:COMPUTERNAME and it is healthy again."
        }
        catch {
            Write-Host "Recovery alert failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    exit 0
}

Write-Host "Gateway is still unhealthy after restart." -ForegroundColor Yellow
exit 2
