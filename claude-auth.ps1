[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [ValidateSet("api-key", "paste-token", "cli")]
    [string]$Method = "api-key",
    [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

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

Write-Step "Checking gateway container"
$containerProbe = Invoke-External -FilePath "docker" -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0 -or ($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with D:\openclaw\openclaw-toolkit\run-openclaw.cmd start"
}

if ($Method -eq "cli") {
    Write-Step "Starting Anthropic Claude CLI auth flow"
    Write-Host "This reuses Claude CLI-style auth for the Anthropic provider through OpenClaw." -ForegroundColor Yellow
    Write-Host "Use this only if you explicitly want the Claude CLI path." -ForegroundColor Yellow
    & docker exec -it $ContainerName node dist/index.js models auth login --provider anthropic --method cli --set-default
    if ($LASTEXITCODE -ne 0) {
        throw "Anthropic CLI auth login did not complete successfully."
    }
}
elseif ($Method -eq "api-key") {
    Write-Step "Starting Anthropic API-key auth flow"
    Write-Host "Recommended path: enter an Anthropic Console API key." -ForegroundColor Yellow
    Write-Host "This keeps Claude auth on the supported API-key path inside OpenClaw's own auth profiles." -ForegroundColor Yellow
    & docker exec -it $ContainerName node dist/index.js models auth login --provider anthropic --method api-key --set-default
    if ($LASTEXITCODE -ne 0) {
        throw "Anthropic API-key auth did not complete successfully."
    }
}
else {
    Write-Step "Starting Anthropic setup-token paste flow"
    Write-Host "Legacy path: paste a Claude setup-token into OpenClaw." -ForegroundColor Yellow
    Write-Host "Prefer -Method api-key unless you intentionally need this older flow." -ForegroundColor Yellow
    & docker exec -it $ContainerName node dist/index.js models auth paste-token --provider anthropic
    if ($LASTEXITCODE -ne 0) {
        throw "Anthropic setup-token paste did not complete successfully."
    }
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap so managed models and agents are refreshed"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap failed after Anthropic auth."
    }
}

Write-Host ""
Write-Host "Claude/Anthropic auth flow finished." -ForegroundColor Green


