[CmdletBinding()]
param(
    [string]$RepoPath = "D:\openclaw\openclaw",
    [string]$HealthUrl = "http://127.0.0.1:18789/healthz"
)

$ErrorActionPreference = "Stop"

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = (Get-Location).Path
    if ($Arguments.Count -gt 0) {
        $psi.Arguments = [string]::Join(" ", ($Arguments | ForEach-Object {
                    if ($_ -match '[\s"]') {
                        '"' + ($_ -replace '\\', '\\' -replace '"', '\"') + '"'
                    }
                    else {
                        $_
                    }
                }))
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $exitCode = $process.ExitCode
    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

$dockerInfo = Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure
$health = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $HealthUrl) -AllowFailure
$containers = Invoke-External -FilePath "docker" -Arguments @(
    "ps",
    "--format",
    "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
) -AllowFailure
$composePs = Invoke-External -FilePath "docker" -Arguments @(
    "compose", "-f", (Join-Path $RepoPath "docker-compose.yml"), "ps"
) -AllowFailure
$serve = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure
$ollama = Invoke-External -FilePath "ollama" -Arguments @("list") -AllowFailure

Write-Host "[Docker]" -ForegroundColor Cyan
if ($dockerInfo.ExitCode -eq 0) {
    Write-Host "Docker engine: ready" -ForegroundColor Green
}
else {
    Write-Host "Docker engine: not ready" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Gateway]" -ForegroundColor Cyan
if ($health.ExitCode -eq 0 -and $health.Output -match '"ok"\s*:\s*true') {
    Write-Host $health.Output -ForegroundColor Green
}
else {
    Write-Host "Gateway health check failed." -ForegroundColor Yellow
    if ($health.Output) {
        Write-Host $health.Output
    }
}

Write-Host ""
Write-Host "[Compose]" -ForegroundColor Cyan
if ($composePs.Output) {
    Write-Host $composePs.Output
}

Write-Host ""
Write-Host "[Containers]" -ForegroundColor Cyan
if ($containers.Output) {
    Write-Host $containers.Output
}

Write-Host ""
Write-Host "[Tailscale Serve]" -ForegroundColor Cyan
if ($serve.Output) {
    Write-Host $serve.Output
}
else {
    Write-Host "No Tailscale Serve status available."
}

Write-Host ""
Write-Host "[Ollama]" -ForegroundColor Cyan
if ($ollama.ExitCode -eq 0) {
    if ($ollama.Output) {
        Write-Host $ollama.Output
    }
    else {
        Write-Host "Ollama: ready (no models loaded)" -ForegroundColor Green
    }
}
else {
    Write-Host "Ollama: not responding" -ForegroundColor Yellow
}
