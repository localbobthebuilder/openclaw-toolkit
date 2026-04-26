[CmdletBinding()]
param(
    [int]$WaitSeconds = 45
)

Write-Host "Stopping Docker Desktop..." -ForegroundColor Cyan
taskkill /f /im "Docker Desktop.exe" /t 2>$null
Start-Sleep -Seconds 2

# Try to find Docker Desktop via PATH or common locations
$desktopExe = Get-Command "Docker Desktop" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if ($null -eq $desktopExe) {
    $commonPaths = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $desktopExe = $path
            break
        }
    }
}

if ($desktopExe) {
    Write-Host "Starting Docker Desktop from $desktopExe..." -ForegroundColor Cyan
    Start-Process -FilePath $desktopExe
    
    Write-Host "Waiting for Docker engine to become ready (max $WaitSeconds seconds)..." -ForegroundColor Gray
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        & docker info 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker is ready." -ForegroundColor Green
            exit 0
        }
        Start-Sleep -Seconds 3
    }
    Write-Warning "Docker started but engine is not responding yet."
}
else {
    throw "Could not locate Docker Desktop.exe. Please ensure it is installed."
}
