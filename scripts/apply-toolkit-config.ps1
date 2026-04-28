[CmdletBinding()]
param(
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) "openclaw-bootstrap.config.json"
}

$scriptDir = Split-Path -Parent $PSCommandPath

& (Join-Path $scriptDir "configure-agent-layout.ps1") -ConfigPath $ConfigPath
& (Join-Path $scriptDir "expose-toolkit-dashboard.ps1") -ConfigPath $ConfigPath
