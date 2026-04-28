[CmdletBinding()]
param(
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) "openclaw-bootstrap.config.json"
}

$defaultPort = 18792
if (-not (Test-Path $ConfigPath)) {
    Write-Output $defaultPort
    exit 0
}

try {
    $config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
    $parsed = 0
    if ($config.PSObject.Properties.Name -contains "toolkitDashboard" -and
        $null -ne $config.toolkitDashboard -and
        $config.toolkitDashboard.PSObject.Properties.Name -contains "port" -and
        [int]::TryParse([string]$config.toolkitDashboard.port, [ref]$parsed) -and
        $parsed -gt 0) {
        Write-Output $parsed
        exit 0
    }
}
catch {
}

Write-Output $defaultPort
