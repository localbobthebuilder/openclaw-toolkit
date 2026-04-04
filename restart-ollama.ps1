Write-Host "Stopping Ollama..." -ForegroundColor Cyan
taskkill /f /im "ollama app.exe" /t 2>$null
taskkill /f /im "ollama.exe" /t 2>$null
Start-Sleep -Seconds 2

# Discovery sequence
$ollamaApp = Get-Command "ollama app" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if ($null -eq $ollamaApp) {
    $commonPaths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe",
        "$env:ProgramFiles\Ollama\ollama app.exe"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) { $ollamaApp = $path; break }
    }
}

if ($ollamaApp) {
    Write-Host "Starting Ollama App from $ollamaApp..." -ForegroundColor Cyan
    Start-Process -FilePath $ollamaApp
    Write-Host "Ollama restarted." -ForegroundColor Green
}
else {
    Write-Warning "Ollama app not found. Attempting to start ollama.exe serve..."
    $ollamaExe = Get-Command "ollama" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($ollamaExe) {
        Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
        Write-Host "Ollama engine started." -ForegroundColor Green
    }
    else {
        throw "Ollama executable not found."
    }
}
