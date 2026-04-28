param(
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) "openclaw-bootstrap.config.json"
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$enableServe = $true
$gatewayPort = 18789
$toolkitPort = 18792
$rootProxyTarget = "http://127.0.0.1:$gatewayPort"
$toolkitProxyTarget = "http://127.0.0.1:$toolkitPort"

if ($config.PSObject.Properties.Name -contains "gatewayPort") {
    $parsedGatewayPort = 0
    if ([int]::TryParse([string]$config.gatewayPort, [ref]$parsedGatewayPort) -and $parsedGatewayPort -gt 0) {
        $gatewayPort = $parsedGatewayPort
        $rootProxyTarget = "http://127.0.0.1:$gatewayPort"
    }
}

if ($config.PSObject.Properties.Name -contains "toolkitDashboard" -and
    $null -ne $config.toolkitDashboard -and
    $config.toolkitDashboard.PSObject.Properties.Name -contains "port") {
    $parsedToolkitPort = 0
    if ([int]::TryParse([string]$config.toolkitDashboard.port, [ref]$parsedToolkitPort) -and $parsedToolkitPort -gt 0) {
        $toolkitPort = $parsedToolkitPort
        $toolkitProxyTarget = "http://127.0.0.1:$toolkitPort"
    }
}

if ($config.PSObject.Properties.Name -contains "tailscale" -and $null -ne $config.tailscale) {
    if ($config.tailscale.PSObject.Properties.Name -contains "enableServe") {
        $enableServe = [bool]$config.tailscale.enableServe
    }
    if ($config.tailscale.PSObject.Properties.Name -contains "proxyTarget" -and
        -not [string]::IsNullOrWhiteSpace([string]$config.tailscale.proxyTarget)) {
        $rootProxyTarget = [string]$config.tailscale.proxyTarget
    }
    if ($config.tailscale.PSObject.Properties.Name -contains "toolkitProxyTarget" -and
        -not [string]::IsNullOrWhiteSpace([string]$config.tailscale.toolkitProxyTarget)) {
        $toolkitProxyTarget = [string]$config.tailscale.toolkitProxyTarget
    }
}

if (-not $enableServe) {
    Write-Host "Tailscale Serve is disabled in toolkit config; skipping route update." -ForegroundColor Yellow
    exit 0
}

Write-Host "Updating Tailscale Serve routes for OpenClaw and Toolkit Dashboard..." -ForegroundColor Cyan
try {
    & tailscale serve --bg $rootProxyTarget
    & tailscale serve --bg --set-path /toolkit $toolkitProxyTarget
    Write-Host "Configured `/ -> $rootProxyTarget` and `/toolkit -> $toolkitProxyTarget` on Tailscale Serve." -ForegroundColor Green

    $serveStatus = & tailscale serve status 2>$null
    $publicUrl = @($serveStatus | Select-Object -First 1)
    if ($publicUrl.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$publicUrl[0])) {
        $baseUrl = ([string]$publicUrl[0]).TrimEnd('/')
        Write-Host ("OpenClaw: " + $baseUrl) -ForegroundColor Yellow
        Write-Host ("Toolkit:  " + $baseUrl + "/toolkit") -ForegroundColor Yellow
    }
    else {
        Write-Host "Tailscale routes updated. Run `tailscale serve status` to confirm the public URL." -ForegroundColor Yellow
    }
}
catch {
    Write-Error "Failed to update Tailscale Serve configuration. Ensure you are running as Administrator."
    Write-Error $_
}
