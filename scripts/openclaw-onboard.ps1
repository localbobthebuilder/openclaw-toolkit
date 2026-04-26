[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [switch]$SkipRelaunch
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-interactive-window.ps1")
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-gateway-cli-startup.ps1")

if (-not $SkipRelaunch) {
    $launchArgs = @()
    if ($ConfigPath) { $launchArgs += @("-ConfigPath", $ConfigPath) }
    if ($ContainerName) { $launchArgs += @("-ContainerName", $ContainerName) }
    $launchArgs += "-SkipRelaunch"

    $launched = Restart-InInteractiveWindowIfNeeded `
        -ScriptPath $PSCommandPath `
        -Arguments $launchArgs `
        -WindowTitle "OpenClaw Toolkit - Onboarding"
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

$dockerCommand = Get-Command "docker" -ErrorAction SilentlyContinue
if ($null -eq $dockerCommand) {
    throw "Docker is not installed on this machine. Install/start it first with $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') prereqs"
}

Write-Step "Checking gateway container"
$containerProbe = Invoke-External -FilePath $dockerCommand.Source -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0) {
    throw "Docker is not ready. Start OpenClaw first with $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') start"
}
if (($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') start"
}

Write-Step "Launching OpenClaw onboarding"
Write-Host "Complete the interactive onboarding choices in this window." -ForegroundColor Yellow
Write-Host "When it finishes, return to the toolkit dashboard and refresh status." -ForegroundColor Yellow

& $dockerCommand.Source @(Get-ToolkitGatewayOpenClawDockerExecArgs -ContainerName $ContainerName -Interactive -Arguments @("onboard"))
if ($LASTEXITCODE -ne 0) {
    throw "OpenClaw onboarding did not complete successfully."
}

Write-Host ""
Write-Host "OpenClaw onboarding finished." -ForegroundColor Green
