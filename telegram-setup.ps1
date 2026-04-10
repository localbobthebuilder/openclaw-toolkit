[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$AccountId,
    [switch]$SkipRelaunch
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-interactive-window.ps1")
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-gateway-cli-startup.ps1")

if (-not $SkipRelaunch) {
    $launchArgs = @()
    if ($ConfigPath) { $launchArgs += @("-ConfigPath", $ConfigPath) }
    if ($ContainerName) { $launchArgs += @("-ContainerName", $ContainerName) }
    if ($AccountId) { $launchArgs += @("-AccountId", $AccountId) }
    $launchArgs += "-SkipRelaunch"

    $launched = Restart-InInteractiveWindowIfNeeded `
        -ScriptPath $PSCommandPath `
        -Arguments $launchArgs `
        -WindowTitle "OpenClaw Toolkit - Telegram Setup"
    if ($launched) { return }
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

try {
    $dockerCommand = Get-Command "docker" -ErrorAction SilentlyContinue
    if ($null -eq $dockerCommand) {
        throw "Docker is not installed on this machine. Install/start it first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') prereqs"
    }

    Write-Step "Checking gateway container"
    $containerProbe = Invoke-External -FilePath $dockerCommand.Source -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
    if ($containerProbe.ExitCode -ne 0) {
        throw "Docker is not ready. Start OpenClaw first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') start"
    }
    if (($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
        throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') start"
    }

    Write-Step "Launching Telegram channel setup"
    if ($AccountId) {
        Write-Host "Complete the interactive Telegram setup for account '$AccountId' in this window." -ForegroundColor Yellow
    }
    else {
        Write-Host "Complete the interactive Telegram setup in this window." -ForegroundColor Yellow
    }
    Write-Host "When it finishes, return to the toolkit dashboard and refresh status." -ForegroundColor Yellow

    $channelArgs = @("channels", "add", "--channel", "telegram")
    if ($AccountId) {
        $channelArgs += @("--account", $AccountId)
    }

    & $dockerCommand.Source @(Get-ToolkitGatewayOpenClawDockerExecArgs -ContainerName $ContainerName -Interactive -Arguments $channelArgs)
    if ($LASTEXITCODE -ne 0) {
        throw "Telegram channel setup did not complete successfully."
    }

    Write-Host ""
    if ($AccountId) {
        Write-Host "Telegram channel setup finished for account '$AccountId'." -ForegroundColor Green
    }
    else {
        Write-Host "Telegram channel setup finished." -ForegroundColor Green
    }
}
catch {
    $message = if ($_.Exception -and $_.Exception.Message) { [string]$_.Exception.Message } else { [string]$_ }
    Write-Host ""
    Write-Host "Telegram setup could not start." -ForegroundColor Red
    Write-Host $message -ForegroundColor Red
    $global:LASTEXITCODE = 1
}
