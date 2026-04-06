[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [switch]$SkipBootstrap,
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
    if ($SkipBootstrap) { $launchArgs += "-SkipBootstrap" }
    $launchArgs += "-SkipRelaunch"

    $launched = Restart-InInteractiveWindowIfNeeded `
        -ScriptPath $PSCommandPath `
        -Arguments $launchArgs `
        -WindowTitle "OpenClaw Toolkit - Copilot Auth"
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

Write-Step "Checking gateway container"
$containerProbe = Invoke-External -FilePath "docker" -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0 -or ($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') start"
}

Write-Step "Starting GitHub Copilot auth"
Write-Host "This runs OpenClaw's built-in GitHub Copilot provider login inside the gateway container." -ForegroundColor Yellow
Write-Host "That is separate from any host Copilot CLI login or Windows Credential Manager state." -ForegroundColor Yellow
Write-Host "Keep this terminal window open until the OpenClaw device flow finishes." -ForegroundColor Yellow

& docker @(Get-ToolkitGatewayNodeDockerExecArgs -ContainerName $ContainerName -Interactive -Arguments @("models", "auth", "login-github-copilot", "--yes"))
if ($LASTEXITCODE -ne 0) {
    throw "GitHub Copilot auth login did not complete successfully."
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap so managed models and agents are refreshed"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap failed after GitHub Copilot auth."
    }
}

Write-Host ""
Write-Host "GitHub Copilot auth flow finished." -ForegroundColor Green
