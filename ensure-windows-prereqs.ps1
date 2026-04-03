[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-InfoLine {
    param([string]$Message)
    Write-Host "INFO: $Message" -ForegroundColor DarkGray
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "WARNING: $Message" -ForegroundColor Yellow
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
    $text = $text -replace [char]0, ''

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Get-FeatureState {
    param([Parameter(Mandatory = $true)][string]$FeatureName)

    try {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction Stop
        return [string]$feature.State
    }
    catch {
        return $null
    }
}

function Test-VersionAtLeast {
    param(
        [string]$VersionText,
        [Parameter(Mandatory = $true)][version]$Minimum
    )

    if ([string]::IsNullOrWhiteSpace($VersionText)) {
        return $false
    }

    try {
        return ([version]$VersionText) -ge $Minimum
    }
    catch {
        return $false
    }
}

function Get-WslVersionInfo {
    $result = Invoke-External -FilePath "wsl" -Arguments @("--version") -AllowFailure
    $status = Invoke-External -FilePath "wsl" -Arguments @("--status") -AllowFailure
    $versionText = $null
    if ($result.Output -match 'WSL version:\s*([0-9.]+)') {
        $versionText = $Matches[1]
    }
    $defaultVersion = $null
    if ($status.Output -match 'Default Version:\s*([0-9]+)') {
        $defaultVersion = [int]$Matches[1]
    }

    [pscustomobject]@{
        VersionText    = $versionText
        DefaultVersion = $defaultVersion
    }
}

function Get-VirtualizationStatus {
    $systemInfo = Invoke-External -FilePath "systeminfo" -AllowFailure
    $output = $systemInfo.Output
    $hasHypervisor = $output -match 'A hypervisor has been detected'
    $firmwareEnabled = $output -match 'Virtualization Enabled In Firmware:\s+Yes'
    $slatEnabled = $output -match 'Second Level Address Translation:\s+Yes'
    $vmMonitorEnabled = $output -match 'VM Monitor Mode Extensions:\s+Yes'

    [pscustomobject]@{
        Ready = ($hasHypervisor -or ($firmwareEnabled -and $slatEnabled -and $vmMonitorEnabled))
        Detail = if ($hasHypervisor) {
            "A hypervisor is already active on this machine."
        }
        elseif ($firmwareEnabled -and $slatEnabled -and $vmMonitorEnabled) {
            "Firmware virtualization and CPU virtualization features are enabled."
        }
        else {
            "Hardware virtualization is not confirmed. Enable Intel VT-x/VT-d or AMD SVM/AMD-V in BIOS/UEFI, then reboot."
        }
    }
}

function Get-DockerDesktopExePath {
    foreach ($path in @(
            "C:\Program Files\Docker\Docker\Docker Desktop.exe",
            (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
        )) {
        if ($path -and (Test-Path $path)) {
            return $path
        }
    }

    return $null
}

function Test-DockerReady {
    $result = Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure
    return $result.ExitCode -eq 0
}

function Start-DockerDesktopIfNeeded {
    param([int]$WaitSeconds = 240)

    if (Test-DockerReady) {
        return $true
    }

    $desktopExe = Get-DockerDesktopExePath
    if (-not $desktopExe) {
        return $false
    }

    Write-InfoLine "Starting Docker Desktop..."
    Start-Process -FilePath $desktopExe | Out-Null

    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    do {
        Start-Sleep -Seconds 3
        if (Test-DockerReady) {
            return $true
        }
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Get-OllamaAppPath {
    foreach ($path in @(
            (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"),
            (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe")
        )) {
        if ($path -and (Test-Path $path)) {
            return $path
        }
    }

    return $null
}

function Test-OllamaReady {
    $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "http://127.0.0.1:11434/api/tags") -AllowFailure
    return $result.ExitCode -eq 0 -and $result.Output -match '"models"'
}

function Start-OllamaIfNeeded {
    param([int]$WaitSeconds = 60)

    if (Test-OllamaReady) {
        return $true
    }

    $ollamaApp = Get-OllamaAppPath
    if (-not $ollamaApp) {
        return $false
    }

    Write-InfoLine "Starting Ollama..."
    Start-Process -FilePath $ollamaApp | Out-Null

    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    do {
        Start-Sleep -Seconds 2
        if (Test-OllamaReady) {
            return $true
        }
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Install-WingetPackage {
    param([Parameter(Mandatory = $true)][string]$PackageId)

    return Invoke-External -FilePath "winget" -Arguments @(
        "install",
        "--exact",
        "--id", $PackageId,
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--silent",
        "--disable-interactivity"
    ) -AllowFailure
}

function Install-WslCore {
    $outputs = New-Object System.Collections.Generic.List[string]

    if (Test-CommandExists "wsl") {
        foreach ($args in @(
                @("--install", "--no-distribution"),
                @("--set-default-version", "2"),
                @("--update")
            )) {
            $result = Invoke-External -FilePath "wsl" -Arguments $args -AllowFailure
            if ($result.Output) {
                $outputs.Add($result.Output)
            }
        }
    }
    else {
        foreach ($featureName in @("Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform")) {
            $result = Invoke-External -FilePath "dism.exe" -Arguments @(
                "/online",
                "/enable-feature",
                "/featurename:$featureName",
                "/all",
                "/norestart"
            ) -AllowFailure
            if ($result.Output) {
                $outputs.Add($result.Output)
            }
        }
    }

    return ($outputs -join [Environment]::NewLine)
}

function Get-TailscaleStatus {
    $result = Invoke-External -FilePath "tailscale" -Arguments @("status", "--json") -AllowFailure
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return $null
    }

    try {
        return ($result.Output | ConvertFrom-Json -Depth 50)
    }
    catch {
        return $null
    }
}

function Add-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$State,
        [Parameter(Mandatory = $true)][string]$Detail
    )

    $script:Checks.Add([pscustomobject]@{
            Name   = $Name
            State  = $State
            Detail = $Detail
        })
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

$Checks = New-Object System.Collections.Generic.List[object]
$BlockingIssues = New-Object System.Collections.Generic.List[string]
$restartRequired = $false
$autoInstall = -not $CheckOnly
$isAdmin = Test-IsAdministrator
$hasWinget = Test-CommandExists "winget"
$requiresTailscale = [bool]($config.tailscale -and $config.tailscale.enableServe)
$requiresOllama = [bool]($config.ollama -and $config.ollama.enabled)

Write-Step "Checking Windows prerequisites"
Write-InfoLine "Auto-install missing prerequisites: $autoInstall"
Write-InfoLine "Running as administrator: $isAdmin"
Write-InfoLine "winget available: $hasWinget"

$virt = Get-VirtualizationStatus
if ($virt.Ready) {
    Add-Check -Name "Virtualization" -State "PASS" -Detail $virt.Detail
}
else {
    Add-Check -Name "Virtualization" -State "FAIL" -Detail $virt.Detail
    $BlockingIssues.Add($virt.Detail)
}

$wslInfo = Get-WslVersionInfo
$wslReady = ($wslInfo.DefaultVersion -eq 2) -and (Test-VersionAtLeast -VersionText $wslInfo.VersionText -Minimum ([version]"2.1.5"))
if (-not $wslReady -and $autoInstall -and $isAdmin -and $virt.Ready) {
    Write-Step "Installing or updating WSL"
    $wslInstallOutput = Install-WslCore
    if ($wslInstallOutput -match '(?i)restart|reboot') {
        $restartRequired = $true
    }
    $wslInfo = Get-WslVersionInfo
    $wslReady = ($wslInfo.DefaultVersion -eq 2) -and (Test-VersionAtLeast -VersionText $wslInfo.VersionText -Minimum ([version]"2.1.5"))
}

if ($wslReady) {
    Add-Check -Name "WSL 2" -State "PASS" -Detail "WSL $($wslInfo.VersionText), default version $($wslInfo.DefaultVersion)"
}
else {
    $detail = "WSL 2.1.5+ with default version 2 is required. Run 'wsl --install --no-distribution', then 'wsl --set-default-version 2', then reboot if prompted."
    Add-Check -Name "WSL 2" -State "FAIL" -Detail $detail
    $BlockingIssues.Add($detail)
}

$featureStates = @(
    "Microsoft-Windows-Subsystem-Linux=$((Get-FeatureState -FeatureName 'Microsoft-Windows-Subsystem-Linux'))",
    "VirtualMachinePlatform=$((Get-FeatureState -FeatureName 'VirtualMachinePlatform'))"
) -join ", "
Add-Check -Name "Windows features" -State "INFO" -Detail $featureStates

$packageChecks = @(
    [pscustomobject]@{ Name = "Git"; Required = $true; Command = "git"; WingetId = "Git.Git"; Manual = "Install Git for Windows." },
    [pscustomobject]@{ Name = "Docker Desktop"; Required = $true; Command = "docker"; WingetId = "Docker.DockerDesktop"; Manual = "Install Docker Desktop for Windows with the WSL 2 backend." },
    [pscustomobject]@{ Name = "Ollama"; Required = $requiresOllama; Command = "ollama"; WingetId = "Ollama.Ollama"; Manual = "Install Ollama for Windows." },
    [pscustomobject]@{ Name = "Tailscale"; Required = $requiresTailscale; Command = "tailscale"; WingetId = "Tailscale.Tailscale"; Manual = "Install Tailscale for Windows and sign in." }
)

foreach ($package in $packageChecks) {
    if (-not $package.Required) {
        continue
    }

    $installed = Test-CommandExists $package.Command
    if (-not $installed -and $autoInstall -and $hasWinget -and $isAdmin) {
        Write-Step "Installing $($package.Name)"
        $installResult = Install-WingetPackage -PackageId $package.WingetId
        if ($installResult.Output -match '(?i)restart|reboot') {
            $restartRequired = $true
        }
        $installed = Test-CommandExists $package.Command
    }

    if ($installed) {
        Add-Check -Name $package.Name -State "PASS" -Detail "$($package.Name) is installed."
    }
    else {
        $detail = if (-not $hasWinget) {
            "$($package.Name) is missing and winget is not available. $($package.Manual)"
        }
        elseif (-not $isAdmin -and $autoInstall) {
            "$($package.Name) is missing. Re-run bootstrap from an elevated PowerShell window so it can be installed automatically, or install it manually. $($package.Manual)"
        }
        else {
            "$($package.Name) is missing. $($package.Manual)"
        }
        Add-Check -Name $package.Name -State "FAIL" -Detail $detail
        $BlockingIssues.Add($detail)
    }
}

if (Test-CommandExists "docker") {
    if (Start-DockerDesktopIfNeeded) {
        Add-Check -Name "Docker engine" -State "PASS" -Detail "Docker engine is ready."
    }
    else {
        $detail = "Docker Desktop is installed but the Docker engine is not ready. Start Docker Desktop and wait for it to finish initializing."
        Add-Check -Name "Docker engine" -State "FAIL" -Detail $detail
        $BlockingIssues.Add($detail)
    }
}

if ($requiresOllama -and (Test-CommandExists "ollama")) {
    if (Start-OllamaIfNeeded) {
        Add-Check -Name "Ollama API" -State "PASS" -Detail "Ollama is reachable on http://127.0.0.1:11434."
    }
    else {
        $detail = "Ollama is installed but its local API is not ready on http://127.0.0.1:11434. Start Ollama and rerun bootstrap."
        Add-Check -Name "Ollama API" -State "FAIL" -Detail $detail
        $BlockingIssues.Add($detail)
    }
}

if ($requiresTailscale -and (Test-CommandExists "tailscale")) {
    $tailscaleStatus = Get-TailscaleStatus
    if ($tailscaleStatus -and $tailscaleStatus.BackendState -eq "Running" -and $tailscaleStatus.Self) {
        Add-Check -Name "Tailscale auth" -State "PASS" -Detail "Signed in as $($tailscaleStatus.CurrentTailnet.Name) on $($tailscaleStatus.Self.DNSName.TrimEnd('.'))."
    }
    else {
        $detail = "Tailscale is installed but not signed in or not running. Open the Tailscale app, sign in, and join this PC to your tailnet before rerunning bootstrap."
        Add-Check -Name "Tailscale auth" -State "FAIL" -Detail $detail
        $BlockingIssues.Add($detail)
    }
}

Write-Host ""
Write-Host "Windows prerequisite summary" -ForegroundColor Cyan
foreach ($check in $Checks) {
    $color = switch ($check.State) {
        "PASS" { "Green" }
        "INFO" { "DarkGray" }
        default { "Yellow" }
    }
    Write-Host ("[{0}] {1}: {2}" -f $check.State, $check.Name, $check.Detail) -ForegroundColor $color
}

if ($restartRequired) {
    $BlockingIssues.Add("A Windows restart is required before bootstrap can continue safely.")
    Write-WarnLine "A Windows restart is required before bootstrap can continue safely."
}

if ($BlockingIssues.Count -gt 0) {
    Write-Host ""
    Write-Host "Bootstrap is stopping because some machine prerequisites still need attention:" -ForegroundColor Yellow
    foreach ($issue in $BlockingIssues | Select-Object -Unique) {
        Write-Host "- $issue" -ForegroundColor Yellow
    }
    throw "Windows prerequisites are not fully ready."
}

Write-Host ""
Write-Host "All Windows prerequisites are ready." -ForegroundColor Green
