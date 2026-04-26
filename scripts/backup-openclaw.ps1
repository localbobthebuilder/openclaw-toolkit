[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$OutputDir,
    [switch]$IncludeSandboxes
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

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$DestinationDir,
        [string[]]$ExcludeNames = @()
    )

    if (-not (Test-Path $SourceDir)) {
        return
    }

    New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null

    Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
        if ($ExcludeNames -contains $_.Name) {
            return
        }

        $target = Join-Path $DestinationDir $_.Name
        if ($_.PSIsContainer) {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
        }
        else {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$hostConfigDir = Get-HostConfigDir -Config $config

if (-not $OutputDir) {
    $OutputDir = Join-Path (Split-Path -Parent $PSCommandPath) "backups"
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingDir = Join-Path $env:TEMP "openclaw-backup-$stamp"
$zipPath = Join-Path $OutputDir "openclaw-backup-$stamp.zip"

if (Test-Path $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

try {
    Write-Step "Collecting host OpenClaw state"
    $hostStage = Join-Path $stagingDir "host-openclaw"
    $excludes = @()
    if (-not $IncludeSandboxes) {
        $excludes += "sandboxes"
    }
    Copy-DirectoryContents -SourceDir $hostConfigDir -DestinationDir $hostStage -ExcludeNames $excludes

    Write-Step "Collecting repo-local setup files"
    $repoStage = Join-Path $stagingDir "repo"
    New-Item -ItemType Directory -Force -Path $repoStage | Out-Null

    foreach ($path in @($config.envFilePath, $config.composeFilePath)) {
        if ($path -and (Test-Path $path)) {
            Copy-Item -LiteralPath $path -Destination (Join-Path $repoStage (Split-Path -Leaf $path)) -Force
        }
    }

    Write-Step "Collecting setup toolkit"
    $setupStage = Join-Path $stagingDir "setup"
    New-Item -ItemType Directory -Force -Path $setupStage | Out-Null
    foreach ($name in @(
            "openclaw-bootstrap.config.json",
            "openclaw.env.template",
            "manual-steps.md",
            "bootstrap-report.txt"
        )) {
        $path = Join-Path (Split-Path -Parent $PSCommandPath) $name
        if (Test-Path $path) {
            Copy-Item -LiteralPath $path -Destination (Join-Path $setupStage $name) -Force
        }
    }

    Write-Step "Creating backup archive"
    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host ""
    Write-Host "Backup created:" -ForegroundColor Green
    Write-Host $zipPath
}
finally {
    if (Test-Path $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
}
