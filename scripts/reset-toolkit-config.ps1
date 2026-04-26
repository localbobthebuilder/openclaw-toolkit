[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$ConfigPath,
    [string]$DefaultConfigPath
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "openclaw-bootstrap.config.json"
}

if (-not $DefaultConfigPath) {
    $DefaultConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.default.json"
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "JSON file not found: $Path"
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "JSON file is empty: $Path"
    }

    $null = $raw | ConvertFrom-Json -Depth 100
}

Write-Step "Validating starter configuration snapshot"
Test-JsonFile -Path $DefaultConfigPath

$backupPath = "$ConfigPath.bak"
$didReset = $false
if (Test-Path -LiteralPath $ConfigPath) {
    Write-Step "Backing up current managed bootstrap config"
    if ($PSCmdlet.ShouldProcess($backupPath, "Save current managed bootstrap config backup")) {
        Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force
        Write-Host "Saved backup: $backupPath" -ForegroundColor Yellow
    }
}

if ($PSCmdlet.ShouldProcess($ConfigPath, "Reset managed bootstrap config to starter defaults")) {
    Write-Step "Restoring starter configuration"
    Copy-Item -LiteralPath $DefaultConfigPath -Destination $ConfigPath -Force
    $didReset = $true
}

if (-not $didReset) {
    Write-Host "No files were changed." -ForegroundColor Yellow
    return
}

Write-Step "Validating restored bootstrap config"
Test-JsonFile -Path $ConfigPath

Write-Host "Managed bootstrap config reset to starter defaults." -ForegroundColor Green
Write-Host "Re-apply when ready with Save & Apply in the dashboard or .\\run-openclaw.cmd agents / .\\run-openclaw.cmd bootstrap." -ForegroundColor Green
