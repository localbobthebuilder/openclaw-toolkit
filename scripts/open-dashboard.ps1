[CmdletBinding()]
param(
    [ValidateSet("auto", "localhost", "tailscale")]
    [string]$Target = "localhost",
    [string]$UiPath = "/chat?session=main",
    [switch]$PrintOnly,
    [switch]$PrintUrl,
    [switch]$CopyToClipboard
)

$ErrorActionPreference = "Stop"

$usingPowerShellCore = $PSVersionTable.PSEdition -eq "Core"
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $usingPowerShellCore -and $null -ne $pwshCommand) {
    Write-Host "INFO: Running under Windows PowerShell. 'pwsh' is installed and preferred for future runs." -ForegroundColor Yellow
    Write-Host "INFO: Next time, launch via run-dashboard.cmd or run:" -ForegroundColor Yellow
    Write-Host "      pwsh -ExecutionPolicy Bypass -File $($MyInvocation.MyCommand.Path)" -ForegroundColor Yellow
}

# Load bootstrap config portably to get hostConfigDir and gatewayPort
$_scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$_configFile  = Join-Path $_scriptDir "openclaw-bootstrap.config.json"
$_gatewayPort = 18789
$_hostConfigDir = Join-Path $env:USERPROFILE ".openclaw"
if (Test-Path $_configFile) {
    . (Join-Path $_scriptDir "shared-config-paths.ps1")
    $_cfg = Get-Content -Raw $_configFile | ConvertFrom-Json
    $_cfg = Resolve-PortableConfigPaths -Config $_cfg -BaseDir $_scriptDir
    if ($_cfg.gatewayPort)  { $_gatewayPort  = [int]$_cfg.gatewayPort }
    if ($_cfg.hostConfigDir) { $_hostConfigDir = [string]$_cfg.hostConfigDir }
}

function Get-OpenClawConfigPath {
    $path = Join-Path $_hostConfigDir "openclaw.json"
    if (-not (Test-Path $path)) {
        throw "OpenClaw config not found at $path"
    }
    return $path
}

function Get-GatewayToken {
    # Primary: read from openclaw.json (bootstrap always syncs this from OPENCLAW_GATEWAY_TOKEN)
    $jsonPath = Get-OpenClawConfigPath
    $cfg = Get-Content -Raw $jsonPath | ConvertFrom-Json
    $token = $cfg.gateway.auth.token
    if ($token) { return [string]$token }

    # Fallback: read OPENCLAW_GATEWAY_TOKEN directly from the .env file.
    # The gateway resolves credentials env-first, so this is the authoritative source
    # when the JSON was not yet synced.
    if ($_cfg -and $_cfg.envFilePath -and (Test-Path $_cfg.envFilePath)) {
        $envLine = Get-Content $_cfg.envFilePath -ErrorAction SilentlyContinue |
            Where-Object { $_ -match "^OPENCLAW_GATEWAY_TOKEN=(.+)$" }
        if ($envLine) {
            $envToken = $envLine -replace "^OPENCLAW_GATEWAY_TOKEN=", ""
            if ($envToken) { return [string]$envToken }
        }
    }

    throw "Gateway auth token not found. Run bootstrap or set gateway.auth.token in openclaw.json."
}

function Get-TailscaleServeUrl {
    $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($null -eq $tailscale) {
        return $null
    }

    $status = & $tailscale.Source serve status 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $status) {
        return $null
    }

    $firstLine = ($status | Select-Object -First 1).Trim()
    if ($firstLine -match '^(https://\S+)') {
        return $Matches[1]
    }
    return $null
}

function Resolve-BaseUrl {
    param([string]$Mode)

    $localhost = "http://127.0.0.1:$_gatewayPort"
    $tailscaleUrl = Get-TailscaleServeUrl

    switch ($Mode) {
        "localhost" { return $localhost }
        "tailscale" {
            if (-not $tailscaleUrl) {
                throw "Tailscale Serve URL not found. Run tailscale serve status and verify it is configured."
            }
            return $tailscaleUrl.TrimEnd("/")
        }
        default {
            if ($tailscaleUrl) {
                return $tailscaleUrl.TrimEnd("/")
            }
            return $localhost
        }
    }
}

$baseUrl = Resolve-BaseUrl -Mode $Target
$token = [uri]::EscapeDataString((Get-GatewayToken))
$pathPart = if ([string]::IsNullOrWhiteSpace($UiPath)) { "/" } else { $UiPath }
if (-not $pathPart.StartsWith("/")) {
    $pathPart = "/$pathPart"
}

$url = "$baseUrl$pathPart#token=$token"

if ($CopyToClipboard) {
    Set-Clipboard -Value $url
    Write-Host "Dashboard URL copied to clipboard for $baseUrl" -ForegroundColor Green
}

if ($PrintOnly -or $PrintUrl) {
    Write-Host "Dashboard URL prepared for $baseUrl" -ForegroundColor Green
    Write-Output $url
    exit 0
}

Start-Process $url | Out-Null
Write-Host "Opened OpenClaw dashboard for $baseUrl" -ForegroundColor Green
Write-Host "If the browser was already open on a stale dashboard tab, close it and use the newly opened 127.0.0.1 tab."
