[CmdletBinding()]
param(
    [string]$RepoPath = "D:\openclaw\openclaw",
    [string]$HealthUrl = "http://127.0.0.1:18789/healthz",
    [int]$DockerWaitSeconds = 240,
    [switch]$NoOpenDashboard
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

function Test-DockerReady {
    $result = Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure
    return $result.ExitCode -eq 0
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerReady) {
        Write-Host "Docker engine is already ready." -ForegroundColor Green
        return
    }

    $desktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktopExe) {
        Write-Host "Starting Docker Desktop..." -ForegroundColor Cyan
        Start-Process -FilePath $desktopExe | Out-Null
    }
    else {
        Write-Host "Docker Desktop executable was not found at the default path." -ForegroundColor Yellow
    }

    $deadline = (Get-Date).AddSeconds($DockerWaitSeconds)
    do {
        Start-Sleep -Seconds 3
        if (Test-DockerReady) {
            Write-Host "Docker engine is ready." -ForegroundColor Green
            return
        }
    } while ((Get-Date) -lt $deadline)

    throw "Docker engine did not become ready within $DockerWaitSeconds seconds."
}

function Wait-ForGateway {
    param([Parameter(Mandatory = $true)][string]$Url)

    for ($i = 0; $i -lt 30; $i++) {
        $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $Url) -AllowFailure
        if ($result.ExitCode -eq 0 -and $result.Output -match '"ok"\s*:\s*true') {
            Write-Host "OpenClaw gateway is healthy." -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 2
    }

    throw "OpenClaw gateway did not become healthy at $Url"
}

Start-DockerDesktopIfNeeded

Push-Location $RepoPath
try {
    Write-Host "Starting OpenClaw gateway..." -ForegroundColor Cyan
    $null = Invoke-External -FilePath "docker" -Arguments @("compose", "up", "-d", "openclaw-gateway")
}
finally {
    Pop-Location
}

Wait-ForGateway -Url $HealthUrl

$containers = Invoke-External -FilePath "docker" -Arguments @(
    "ps",
    "--format",
    "table {{.Names}}`t{{.Image}}`t{{.Status}}"
)
$serve = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure

Write-Host ""
Write-Host "[OpenClaw Containers]" -ForegroundColor Cyan
Write-Host $containers.Output

Write-Host ""
Write-Host "[Tailscale Serve]" -ForegroundColor Cyan
if ($serve.Output) {
    Write-Host $serve.Output
}
else {
    Write-Host "No Tailscale Serve status available."
}

Write-Host ""
Write-Host "Local dashboard: http://127.0.0.1:18789" -ForegroundColor Green

if (-not $NoOpenDashboard) {
    $dashboardScript = Join-Path (Split-Path -Parent $PSCommandPath) "open-dashboard.ps1"
    if (Test-Path $dashboardScript) {
        Write-Host "Opening authenticated dashboard..." -ForegroundColor Cyan
        & $dashboardScript -Target localhost -UiPath "/chat?session=main"
    }
    else {
        Write-Host "Dashboard helper not found at $dashboardScript" -ForegroundColor Yellow
    }
}
