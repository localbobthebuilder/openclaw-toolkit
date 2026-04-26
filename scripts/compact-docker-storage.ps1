[CmdletBinding(SupportsShouldProcess = $true, PositionalBinding = $false)]
param(
    [string]$ConfigPath,
    [string]$VhdPath,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

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

function Format-Bytes {
    param([Int64]$Bytes)

    if ($Bytes -ge 1GB) {
        return ("{0:N2} GB" -f ($Bytes / 1GB))
    }
    if ($Bytes -ge 1MB) {
        return ("{0:N2} MB" -f ($Bytes / 1MB))
    }

    return "$Bytes bytes"
}

function Compact-WithOptimizeVhd {
    param([Parameter(Mandatory = $true)][string]$Path)

    Optimize-VHD -Path $Path -Mode Full -ErrorAction Stop | Out-Null
}

function Compact-WithDiskPart {
    param([Parameter(Mandatory = $true)][string]$Path)

    $scriptPath = Join-Path $env:TEMP ("diskpart-compact-" + [guid]::NewGuid().ToString("N") + ".txt")
    @(
        "select vdisk file=""$Path"""
        "attach vdisk readonly"
        "compact vdisk"
        "detach vdisk"
    ) | Set-Content -Path $scriptPath -Encoding ASCII

    try {
        try {
            Invoke-External -FilePath "diskpart.exe" -Arguments @("/s", $scriptPath) | Out-Null
        }
        catch {
            if ($_.Exception.Message -match "requires elevation") {
                throw "Docker storage compaction requires an elevated PowerShell session on this machine. Re-run compact-storage as Administrator."
            }
            throw
        }
    }
    finally {
        Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
    }
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

if (-not $VhdPath) {
    $VhdPath = Join-Path $env:LOCALAPPDATA "Docker\wsl\disk\docker_data.vhdx"
}
if (-not (Test-Path $VhdPath)) {
    throw "Docker Desktop data VHDX was not found at $VhdPath"
}
$VhdPath = (Resolve-Path -LiteralPath $VhdPath).Path

$wasDockerReady = Test-DockerReady
$dockerDesktopRunning = $null -ne (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)
$shouldRestart = -not $NoRestart -and ($wasDockerReady -or $dockerDesktopRunning)

$before = (Get-Item -LiteralPath $VhdPath).Length

Write-Step "Compacting Docker Desktop storage"
Write-Host "Docker Desktop VHDX: $VhdPath" -ForegroundColor Gray
Write-Host "Before: $(Format-Bytes -Bytes $before)" -ForegroundColor Gray

if ($PSCmdlet.ShouldProcess($VhdPath, "compact Docker Desktop VHDX")) {
    $stopScript = Join-Path (Split-Path -Parent $PSCommandPath) "stop-openclaw.ps1"
    if (Test-Path $stopScript) {
        Write-Host "Stopping OpenClaw and Docker Desktop for compaction..." -ForegroundColor Cyan
        & $stopScript -RepoPath $config.repoPath -StopDockerDesktop
    }
    else {
        Write-Host "Stop helper not found; continuing with WSL shutdown only." -ForegroundColor Yellow
    }

    Write-Host "Shutting down WSL..." -ForegroundColor Cyan
    $null = Invoke-External -FilePath "wsl.exe" -Arguments @("--shutdown") -AllowFailure
    Start-Sleep -Seconds 3

    $compacted = $false
    try {
        Write-Host "Trying Hyper-V Optimize-VHD..." -ForegroundColor Cyan
        Compact-WithOptimizeVhd -Path $VhdPath
        $compacted = $true
    }
    catch {
        Write-Host "Optimize-VHD failed, falling back to diskpart compact." -ForegroundColor Yellow
        Compact-WithDiskPart -Path $VhdPath
        $compacted = $true
    }

    if (-not $compacted) {
        throw "Docker Desktop VHDX compaction did not complete."
    }

    $after = (Get-Item -LiteralPath $VhdPath).Length
    $delta = $before - $after
    Write-Host "After: $(Format-Bytes -Bytes $after)" -ForegroundColor Green
    Write-Host "Reclaimed: $(Format-Bytes -Bytes $delta)" -ForegroundColor Green

    if ($shouldRestart) {
        $startScript = Join-Path (Split-Path -Parent $PSCommandPath) "start-openclaw.ps1"
        if (Test-Path $startScript) {
            Write-Host "Restarting Docker Desktop and OpenClaw..." -ForegroundColor Cyan
            & $startScript -RepoPath $config.repoPath -HealthUrl $config.verification.healthUrl -NoOpenDashboard
        }
        else {
            Write-Host "Start helper not found; leaving Docker Desktop stopped." -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host "WhatIf: would compact Docker Desktop storage at $VhdPath" -ForegroundColor Yellow
}
