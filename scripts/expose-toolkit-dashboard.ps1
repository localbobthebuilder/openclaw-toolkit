Write-Host "Updating Tailscale Serve path for Toolkit Dashboard..." -ForegroundColor Cyan

# Using the validated --set-path command
try {
    & tailscale serve --bg --set-path /toolkit http://127.0.0.1:18791
    Write-Host "Dashboard path /toolkit configured on Tailscale Serve." -ForegroundColor Green
    Write-Host "Access it at: https://lpc.tail6ed68d.ts.net/toolkit" -ForegroundColor Yellow
} catch {
    Write-Error "Failed to update Tailscale Serve configuration. Ensure you are running as Administrator."
    Write-Error $_
}
