[CmdletBinding()]
param(
    [string]$RepoPath = "D:\openclaw\openclaw",
    [switch]$StopDockerDesktop
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

function Stop-DockerDesktopHard {
    $dockerCli = "C:\Program Files\Docker\Docker\DockerCli.exe"
    if (Test-Path $dockerCli) {
        Write-Host "Requesting Docker Desktop shutdown..." -ForegroundColor Cyan
        $null = Invoke-External -FilePath $dockerCli -Arguments @("-Shutdown") -AllowFailure
    }

    $service = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne "Stopped") {
        try {
            Write-Host "Stopping Docker Desktop service..." -ForegroundColor Cyan
            Stop-Service -Name "com.docker.service" -Force -ErrorAction Stop
        }
        catch {
            Write-Host "Could not stop Docker Desktop service without elevation; continuing." -ForegroundColor Yellow
        }
    }

    $processNames = @(
        "Docker Desktop",
        "com.docker.backend",
        "com.docker.proxy",
        "com.docker.vpnkit"
    )
    $processes = Get-Process -Name $processNames -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Host "Stopping Docker Desktop processes..." -ForegroundColor Cyan
        $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Shutting down WSL..." -ForegroundColor Cyan
    $null = Invoke-External -FilePath "wsl.exe" -Arguments @("--shutdown") -AllowFailure
}

function Wait-ForDockerToStop {
    param([int]$TimeoutSeconds = 60)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (-not (Test-DockerReady)) {
            return $true
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    return $false
}

if (-not (Test-DockerReady)) {
    Write-Host "Docker engine is not running, so OpenClaw is already effectively stopped." -ForegroundColor Yellow
    return
}

Push-Location $RepoPath
try {
    Write-Host "Stopping OpenClaw gateway..." -ForegroundColor Cyan
    $null = Invoke-External -FilePath "docker" -Arguments @("compose", "stop", "openclaw-gateway") -AllowFailure
}
finally {
    Pop-Location
}

$sandboxNames = @()
$sandboxList = Invoke-External -FilePath "docker" -Arguments @(
    "ps", "-a",
    "--filter", "name=openclaw-sbx-",
    "--format", "{{.Names}}"
) -AllowFailure
if ($sandboxList.Output) {
    $sandboxNames = @($sandboxList.Output -split "`r?`n" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}

if ($sandboxNames.Count -gt 0) {
    Write-Host "Removing sandbox worker containers..." -ForegroundColor Cyan
    $rmArgs = @("rm", "-f") + $sandboxNames
    $null = Invoke-External -FilePath "docker" -Arguments $rmArgs
}
else {
    Write-Host "No sandbox worker containers were found."
}

if ($StopDockerDesktop) {
    Stop-DockerDesktopHard
    if (-not (Wait-ForDockerToStop)) {
        throw "Docker Desktop did not fully stop within the timeout. The engine is still responding."
    }
}

Write-Host ""
Write-Host "OpenClaw stop complete." -ForegroundColor Green
