[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$SkipRelaunch
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-interactive-window.ps1")
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-ollama-cloud-auth.ps1")

$bootstrapConfig = $null
if (Test-Path $ConfigPath) {
    $bootstrapConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $bootstrapConfig = Resolve-PortableConfigPaths -Config $bootstrapConfig -BaseDir (Split-Path -Parent $ConfigPath)
}

if (-not $SkipRelaunch) {
    $launchArgs = @()
    if ($ConfigPath) { $launchArgs += @("-ConfigPath", $ConfigPath) }
    $launchArgs += "-SkipRelaunch"

    $launched = Restart-InInteractiveWindowIfNeeded `
        -ScriptPath $PSCommandPath `
        -Arguments $launchArgs `
        -WindowTitle "OpenClaw Toolkit - Ollama Cloud Auth"
    if ($launched) { return }
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$ollama = Get-Command "ollama" -ErrorAction SilentlyContinue
if ($null -eq $ollama) {
    throw "Ollama is not installed. Install it first with $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') prereqs"
}

$existingMarker = Read-OllamaCloudAuthMarker -BootstrapConfig $bootstrapConfig
if ($existingMarker -and $existingMarker.recordedAt) {
    Write-Step "Checking Ollama cloud auth"
    Write-Host "Toolkit sign-in already recorded at $($existingMarker.recordedAt)." -ForegroundColor Green
    Write-Host "If cloud requests fail later, rerun this command to refresh the sign-in." -ForegroundColor Yellow
    return
}

Write-Step "Starting Ollama cloud auth"
Write-Host "This opens Ollama's host-side sign-in flow." -ForegroundColor Yellow
Write-Host "Use this for Ollama cloud models (:cloud) and Ollama Web Search." -ForegroundColor Yellow
Write-Host "Local Ollama models on your PC do not require this sign-in." -ForegroundColor Yellow

& $ollama.Source signin
if ($LASTEXITCODE -ne 0) {
    throw "Ollama sign-in did not complete successfully."
}

$markerPath = Write-OllamaCloudAuthMarker -BootstrapConfig $bootstrapConfig
Write-Host ""
Write-Host "Ollama cloud auth flow finished." -ForegroundColor Green
Write-Host "Recorded toolkit sign-in marker at: $markerPath" -ForegroundColor Green
Write-Host "Refresh the toolkit dashboard to update the Ollama Cloud Auth card." -ForegroundColor Green
