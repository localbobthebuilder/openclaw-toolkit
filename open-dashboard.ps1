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

function Get-OpenClawConfigPath {
    $path = "C:\Users\Deadline\.openclaw\openclaw.json"
    if (-not (Test-Path $path)) {
        throw "OpenClaw config not found at $path"
    }
    return $path
}

function Get-GatewayToken {
    $cfg = Get-Content -Raw (Get-OpenClawConfigPath) | ConvertFrom-Json
    $token = $cfg.gateway.auth.token
    if (-not $token) {
        throw "gateway.auth.token is not set in openclaw.json"
    }
    return [string]$token
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

    $localhost = "http://127.0.0.1:18789"
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
