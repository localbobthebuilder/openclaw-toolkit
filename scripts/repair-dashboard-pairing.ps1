[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [switch]$PromptForOtherPending,
    [switch]$OpenDashboard,
    [int]$PollSeconds = 30
)

$ErrorActionPreference = "Stop"

# Resolve host config dir from bootstrap config (portable, no hardcoded paths).
$_scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$_toolkitDir   = Split-Path -Parent $_scriptDir
$_configFile   = Join-Path $_toolkitDir "openclaw-bootstrap.config.json"
$_hostConfigDir = Join-Path $env:USERPROFILE ".openclaw"
$_gatewayPort = 18789
if (Test-Path $_configFile) {
    . (Join-Path $_scriptDir "shared-config-paths.ps1")
    $_cfg2 = Get-Content -Raw $_configFile | ConvertFrom-Json
    $_cfg2 = Resolve-PortableConfigPaths -Config $_cfg2 -BaseDir $_toolkitDir
    if ($_cfg2.hostConfigDir) { $_hostConfigDir = [string]$_cfg2.hostConfigDir }
    if ($_cfg2.gatewayPort)   { $_gatewayPort   = [int]$_cfg2.gatewayPort }
}
$_devicesDir = Join-Path $_hostConfigDir "devices"
$_approverScript = Join-Path $_scriptDir "approve-pairing.mjs"

function Write-LogLine {
    param(
        [AllowEmptyString()][string]$Message = "",
        [string]$Color = "Gray"
    )

    $stamp = (Get-Date).ToString("HH:mm:ss.fff")
    if ([string]::IsNullOrEmpty($Message)) {
        Write-Host "[$stamp]"
        return
    }

    Write-Host "[$stamp] $Message" -ForegroundColor $Color
}

function Write-LogBlock {
    param(
        [AllowEmptyString()][string]$Text = "",
        [string]$Color = "Gray"
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return
    }

    foreach ($line in ($Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            Write-LogLine -Message $line -Color $Color
        }
    }
}

function Get-JsonEntryValues {
    param(
        $InputObject,
        [Parameter(Mandatory = $true)][string]$KeyName
    )

    if ($null -eq $InputObject) {
        return @()
    }

    $values = @($InputObject.PSObject.Properties.Value)
    if ($values.Count -eq 0 -and $InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
        $values = @($InputObject)
    }

    return @($values | Where-Object {
            $null -ne $_ -and
            $_.PSObject.Properties.Name -contains $KeyName -and
            -not [string]::IsNullOrWhiteSpace([string]$_.$KeyName)
        })
}

# Read paired/pending device data directly from the on-disk JSON files.
# This is instant (no docker exec) and is safe because the gateway writes atomically.
function Read-DeviceFiles {
    $paired  = @()
    $pending = @()
    $pairedPath  = Join-Path $_devicesDir "paired.json"
    $pendingPath = Join-Path $_devicesDir "pending.json"
    try {
        if (Test-Path $pairedPath) {
            $obj = Get-Content -Raw $pairedPath -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($obj) { $paired = Get-JsonEntryValues -InputObject $obj -KeyName "deviceId" }
        }
    } catch {}
    try {
        if (Test-Path $pendingPath) {
            $obj = Get-Content -Raw $pendingPath -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($obj) { $pending = Get-JsonEntryValues -InputObject $obj -KeyName "requestId" }
        }
    } catch {}
    return [pscustomobject]@{ Paired = $paired; Pending = $pending }
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
    $stdout = $stdout -replace [char]0, ''
    $stderr = $stderr -replace [char]0, ''
    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        StdOut   = $stdout
        StdErr   = $stderr
        Output   = $text
    }
}


$safeScopes = @(
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing"
)

# Resolve the Docker network gateway IP dynamically so this works on any machine.
# The browser connects from the host; Docker forwards it through the bridge gateway.
function Get-DockerNetworkGatewayIps {
    $networkNames = @("openclaw_default", "bridge")
    $ips = @("172.18.0.1", "172.17.0.1")  # safe fallbacks
    foreach ($net in $networkNames) {
        $gateway = & docker network inspect $net --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>$null
        if ($gateway -and $gateway.Trim()) {
            $ips = @($gateway.Trim()) + $ips
        }
    }
    return @($ips | Select-Object -Unique)
}

$_localGatewayIps = Get-DockerNetworkGatewayIps

function Get-ApprovalBuckets {
    param([object[]]$Pending)
    $autoApprove = @($Pending | Where-Object {
            $_.clientId -eq "openclaw-control-ui" -and
            $_.clientMode -eq "webchat" -and
            $_.role -eq "operator" -and
            ($_localGatewayIps -contains $_.remoteIp) -and
            (@($_.scopes | Sort-Object) -join ",") -eq (@($safeScopes | Sort-Object) -join ",")
        })
    $otherPending = @($Pending | Where-Object { $_.requestId -notin @($autoApprove | ForEach-Object { $_.requestId }) })
    return [pscustomobject]@{
        Auto  = $autoApprove
        Other = $otherPending
    }
}

function Find-NodeExe {
    # Try PATH first, then the well-known Windows installer location.
    $inPath = Get-Command node -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    $fallback = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Approve-Requests {
    # Returns the number of requests the gateway CONFIRMED approved (exit 0).
    # Stale entries (unknown requestId) exit 1 and are NOT counted.
    param([object[]]$Requests)
    $confirmed = 0

    $nodeExe = Find-NodeExe
    if (-not $nodeExe) {
        Write-Warning "node not found in PATH; falling back to docker exec for approval."
        foreach ($request in $Requests) {
            $requestId = [string]$request.requestId
            $approve = Invoke-External -FilePath "docker" -Arguments @(
                "exec", $ContainerName,
                "openclaw",
                "devices", "approve", $requestId
            ) -AllowFailure
            if ($approve.Output) { Write-LogBlock -Text $approve.Output }
            if ($approve.ExitCode -eq 0) { $confirmed++ }
        }
        return $confirmed
    }

    foreach ($request in $Requests) {
        $requestId = [string]$request.requestId
        $approve = Invoke-External -FilePath $nodeExe -Arguments @(
            $_approverScript,
            $requestId,
            "--port", [string]$_gatewayPort,
            "--host-config-dir", $_hostConfigDir
        ) -AllowFailure
        if ($approve.Output) { Write-LogBlock -Text $approve.Output }
        if ($approve.ExitCode -eq 0) {
            $confirmed++
        } else {
            if ($approve.Output -match "unknown requestId") {
                Write-LogLine -Message "  (requestId $requestId not in gateway memory - likely stale)" -Color DarkGray
            }
        }
    }
    return $confirmed
}

function Invoke-RepairPass {
    $data = Read-DeviceFiles
    $pending = @($data.Pending)
    $paired  = @($data.Paired)

    if ($pending.Count -eq 0) {
        return [pscustomobject]@{ Pending = @(); Paired = $paired; Auto = @(); Other = @(); ApprovedCount = 0 }
    }

    $buckets = Get-ApprovalBuckets -Pending $pending
    Write-LogLine -Message "Pending requests:" -Color Cyan
    foreach ($request in $pending) {
        $marker = if ($request.requestId -in @($buckets.Auto | ForEach-Object { $_.requestId })) { "[auto]" } else { "[manual]" }
        Write-LogLine -Message "- $marker $($request.requestId) client=$($request.clientId) mode=$($request.clientMode) role=$($request.role) ip=$($request.remoteIp)"
    }
    $approvedCount = 0
    if ($buckets.Auto.Count -gt 0) {
        $approvedCount = Approve-Requests -Requests $buckets.Auto
    }
    return [pscustomobject]@{
        Pending       = $pending
        Paired        = $paired
        Auto          = $buckets.Auto
        Other         = $buckets.Other
        ApprovedCount = $approvedCount
    }
}

if ($OpenDashboard) {
    & (Join-Path $PSScriptRoot "open-dashboard.ps1")
}

$result = Invoke-RepairPass
$approvedAuto = $result.ApprovedCount -gt 0

if ($OpenDashboard) {
    # The browser needs a few seconds to load the SPA and send its WebSocket request.
    # Even if we already have paired Control UI devices in the file, this browser session
    # might not have a stored device token (new profile, cleared storage, new machine) and
    # will need to pair. We always poll for at least a grace period so we don't miss that.
    $hasPairedControlUi = @($result.Paired | Where-Object { $_.clientId -eq "openclaw-control-ui" }).Count -gt 0
    # Short grace period if already paired (browser likely reconnects in <5s).
    # Full PollSeconds if no paired devices (fresh install needs more time to load and pair).
    $waitSecs = if ($hasPairedControlUi) { [Math]::Min(10, $PollSeconds) } else { $PollSeconds }
    $deadline = (Get-Date).AddSeconds($waitSecs)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 750
        $result = Invoke-RepairPass
        # Only count CONFIRMED approvals (exit 0). Stale entries fail fast and are ignored.
        if ($result.ApprovedCount -gt 0) {
            $approvedAuto = $true
        }
        if ($approvedAuto -and $result.Pending.Count -eq 0) {
            break
        }
        # Do not break on stale failures alone. We only stop early once a real approval
        # happened and no valid pending requests remain; otherwise keep polling so a
        # browser request that arrives 1-3s after open is still caught.
    }
}

if ($result.Pending.Count -eq 0) {
    Write-LogLine -Message "No pending pairing requests remain." -Color Green
}

if ($result.Other.Count -gt 0) {
    Write-Host ""
    Write-LogLine -Message "Some pending requests were not auto-approved." -Color Yellow

    if ($PromptForOtherPending) {
        $answer = Read-Host "Approve the remaining pending request IDs too? (y/n)"
        if ($answer -in @("y", "Y", "yes", "YES")) {
            Approve-Requests -Requests $result.Other
        }
    }
}

Write-Host ""
Write-LogLine -Message "Pairing repair complete. Reopen the dashboard now:" -Color Green
Write-LogLine -Message (Join-Path (Split-Path $PSScriptRoot -Parent) "cmd\run-dashboard.cmd")
if ($OpenDashboard -and $approvedAuto) {
    Start-Sleep -Milliseconds 750
    Write-Host ""
    Write-LogLine -Message "Opening a fresh dashboard tab now that pairing is approved..." -Color Green
    & (Join-Path $PSScriptRoot "open-dashboard.ps1")
}


