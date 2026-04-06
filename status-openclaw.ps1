[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$HealthUrl
)

$ErrorActionPreference = "Stop"

# Refresh PATH from registry so newly installed tools (e.g. Ollama, Docker) are found
# even if the parent process (dashboard server) started before they were installed
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

# Resolve paths portably from the config file next to this script
$configFile = [System.IO.Path]::Combine($PSScriptRoot, "openclaw-bootstrap.config.json")
$composeFilePath = $null
if (Test-Path $configFile) {
    . ([System.IO.Path]::Combine($PSScriptRoot, "shared-config-paths.ps1"))
    $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
    $cfg = Resolve-PortableConfigPaths -Config $cfg -BaseDir $PSScriptRoot
    if (-not $RepoPath)  { $RepoPath  = $cfg.repoPath }
    if (-not $HealthUrl) { $HealthUrl = "http://127.0.0.1:$($cfg.gatewayPort)/healthz" }
    if ($cfg.composeFilePath) { $composeFilePath = $cfg.composeFilePath }
}
if (-not $RepoPath)  { $RepoPath  = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\openclaw")) }
if (-not $HealthUrl) { $HealthUrl = "http://127.0.0.1:18789/healthz" }
if (-not $composeFilePath) { $composeFilePath = [System.IO.Path]::Combine($RepoPath, "docker-compose.yml") }

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure,
        [int]$TimeoutSeconds = 8
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

    try {
        $null = $process.Start()
    } catch [System.ComponentModel.Win32Exception] {
        if (-not $AllowFailure) {
            throw "Command not found: $FilePath"
        }
        return [pscustomobject]@{
            ExitCode = -1
            Output   = "not installed"
        }
    }

    # Read stdout/stderr asynchronously so we can enforce a wall-clock timeout
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $finished = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $finished) {
        try { $process.Kill() } catch {}
        if (-not $AllowFailure) {
            throw "Command timed out after ${TimeoutSeconds}s: $FilePath"
        }
        return [pscustomobject]@{
            ExitCode = -1
            Output   = "timed out"
        }
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    $exitCode = $process.ExitCode
    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine
    # wsl.exe (and some other Windows binaries) write UTF-16LE to stdout which leaves
    # NUL bytes between every character when read back as UTF-8. Strip them.
    $text = $text -replace [char]0, ''

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

# Check Docker installation with a fast command (no daemon connection needed),
# then separately check if the engine is actually running.
$dockerVersion   = Invoke-External -FilePath "docker" -Arguments @("--version") -AllowFailure -TimeoutSeconds 5
$dockerInstalled = $dockerVersion.ExitCode -ne -1   # -1 = Win32Exception = binary not found

# Only probe the daemon if Docker is installed — docker info hangs indefinitely otherwise
if ($dockerInstalled) {
    $dockerInfo = Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure
} else {
    $dockerInfo = [PSCustomObject]@{ ExitCode = -1; Output = "not installed" }
}

$wslVersion  = Invoke-External -FilePath "wsl" -Arguments @("--version") -AllowFailure

# $dockerInstalled already set above via docker --version
$dockerEngineReady = $dockerInstalled -and $dockerInfo.ExitCode -eq 0
$wslReady = $wslVersion.ExitCode -eq 0 -and $wslVersion.Output -match 'WSL version:\s*[0-9]+'

# Only call the gateway health endpoint when the Docker engine is actually running;
# otherwise curl just burns its full timeout before failing.
if ($dockerEngineReady) {
    $health = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "--max-time", "5", $HealthUrl) -AllowFailure
} else {
    $health = [PSCustomObject]@{ ExitCode = -1; Output = "not installed" }
}

if ($dockerEngineReady) {
    $containers = Invoke-External -FilePath "docker" -Arguments @(
        "ps", "--format", "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
    ) -AllowFailure
    $composePs = Invoke-External -FilePath "docker" -Arguments @(
        "compose", "-f", $composeFilePath, "ps"
    ) -AllowFailure
} else {
    $containers = [PSCustomObject]@{ ExitCode = -1; Output = "" }
    $composePs  = [PSCustomObject]@{ ExitCode = -1; Output = "" }
}
$serve  = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure
$ollama = Invoke-External -FilePath "ollama" -Arguments @("list") -AllowFailure

Write-Host "[Virtualization]" -ForegroundColor Cyan
$csInfo = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
$vmms = Get-Service -Name "vmms" -ErrorAction SilentlyContinue
$virtOk = ($csInfo -and $csInfo.HypervisorPresent) -or ($vmms -and $vmms.Status -eq "Running")
if ($virtOk) {
    Write-Host "Virtualization: enabled" -ForegroundColor Green
} else {
    Write-Host "Virtualization: not installed" -ForegroundColor Red
}

Write-Host ""
Write-Host "[WSL2]" -ForegroundColor Cyan
if ($wslReady -and $wslVersion.Output -match 'WSL version:\s*([0-9.]+)') {
    Write-Host "WSL version: $($Matches[1])" -ForegroundColor Green
} else {
    # wsl.exe is always present on Windows - a non-matching result means the feature
    # is not installed/enabled, not just "not ready"
    Write-Host "WSL2: not installed" -ForegroundColor Red
}

Write-Host ""
Write-Host "[Docker]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Docker: not installed" -ForegroundColor Red
} elseif ($dockerEngineReady) {
    Write-Host "Docker engine: ready" -ForegroundColor Green
} else {
    Write-Host "Docker engine: not ready" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Bootstrap]" -ForegroundColor Cyan
if (Test-Path $RepoPath) {
    Write-Host "Repo: found at $RepoPath" -ForegroundColor Green
} else {
    Write-Host "Repo: not cloned yet" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Gateway]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Gateway: not installed" -ForegroundColor Red
} elseif (-not $dockerEngineReady) {
    Write-Host "Gateway: not installed" -ForegroundColor Red
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Gateway: bootstrap not run yet" -ForegroundColor Yellow
} elseif ($health.ExitCode -eq 0 -and $health.Output -match '"ok"\s*:\s*true') {
    Write-Host $health.Output -ForegroundColor Green
} else {
    Write-Host "Gateway health check failed." -ForegroundColor Yellow
    if ($health.Output -and $health.Output -ne "not installed") {
        Write-Host $health.Output
    }
}

Write-Host ""
Write-Host "[Compose]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Compose: not installed"
} elseif (-not $dockerEngineReady) {
    Write-Host "Compose: not ready"
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Compose: bootstrap not run yet"
} elseif ($composePs.Output) {
    Write-Host $composePs.Output
}

Write-Host ""
Write-Host "[Containers]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Containers: not installed"
} elseif (-not $dockerEngineReady) {
    Write-Host "Containers: not ready"
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Containers: bootstrap not run yet"
} elseif ($containers.Output) {
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
elseif ($ollama.Output -eq "not installed") {
    Write-Host "Ollama: not installed" -ForegroundColor Red
}
else {
    Write-Host "Ollama: not responding" -ForegroundColor Yellow
}
