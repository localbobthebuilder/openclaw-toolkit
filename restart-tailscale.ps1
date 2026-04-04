Write-Host "Restarting Tailscale service..." -ForegroundColor Cyan
Restart-Service "Tailscale" -Force -ErrorAction SilentlyContinue

Write-Host "Checking for Tailscale GUI..." -ForegroundColor Gray
$tsGui = Get-Command "tailscale-ipn" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if ($null -eq $tsGui) {
    # Fallback to common path if not in PATH
    $tsGui = "C:\Program Files\Tailscale\tailscale-ipn.exe"
}

if (Test-Path $tsGui) {
    Write-Host "Relaunching Tailscale GUI..." -ForegroundColor Gray
    Start-Process -FilePath $tsGui
}

Write-Host "Tailscale restart sequence complete." -ForegroundColor Green
