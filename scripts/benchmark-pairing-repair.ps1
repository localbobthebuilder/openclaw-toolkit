[CmdletBinding()]
param(
    [int]$WatchSeconds = 60,
    [int]$PollMs = 500
)

$ErrorActionPreference = "Stop"
$_start = [System.Diagnostics.Stopwatch]::StartNew()

function T { "+{0,6}ms" -f $_start.ElapsedMilliseconds }
function Log {
    param([string]$Msg, [string]$Color = "White")
    Write-Host "$(T)  $Msg" -ForegroundColor $Color
}

Log "=== Pairing Repair Benchmark ===" "Cyan"
Log "Watch=$($WatchSeconds)s  Poll=$($PollMs)ms"
Log ""

# -- Bootstrap config ---------------------------------------------------------
Log "[1] Resolving host config dir..." "Yellow"
$_scriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$_toolkitDir    = Split-Path -Parent $_scriptDir
$_configFile    = Join-Path $_toolkitDir "openclaw-bootstrap.config.json"
$_hostConfigDir = Join-Path $env:USERPROFILE ".openclaw"
if (Test-Path $_configFile) {
    . (Join-Path $_scriptDir "shared-config-paths.ps1")
    $_cfg = Get-Content -Raw $_configFile | ConvertFrom-Json
    $_cfg = Resolve-PortableConfigPaths -Config $_cfg -BaseDir $_toolkitDir
    if ($_cfg.hostConfigDir) { $_hostConfigDir = [string]$_cfg.hostConfigDir }
}
$_devicesDir = Join-Path $_hostConfigDir "devices"
Log "    hostConfigDir = $_hostConfigDir" "Gray"
Log "    devicesDir    = $_devicesDir" "Gray"
Log "    paired.json   exists=$(Test-Path (Join-Path $_devicesDir 'paired.json'))" "Gray"
Log "    pending.json  exists=$(Test-Path (Join-Path $_devicesDir 'pending.json'))" "Gray"

# -- Docker gateway IPs --------------------------------------------------------
Log ""
Log "[2] Resolving Docker gateway IPs..." "Yellow"
$t0 = $_start.ElapsedMilliseconds
$networkNames = @("openclaw_default", "bridge")
$ips = @("172.18.0.1", "172.17.0.1")
foreach ($net in $networkNames) {
    $tNet = $_start.ElapsedMilliseconds
    $gw = & docker network inspect $net --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>$null
    $elapsed = $_start.ElapsedMilliseconds - $tNet
    if ($gw -and $gw.Trim()) {
        $ips = @($gw.Trim()) + $ips
        Log "    network '$net' => $($gw.Trim()) ($($elapsed)ms)" "Gray"
    } else {
        Log "    network '$net' => not found ($($elapsed)ms)" "DarkGray"
    }
}
$ips = @($ips | Select-Object -Unique)
$elapsed = $_start.ElapsedMilliseconds - $t0
Log "    gateway IPs: $($ips -join ', ') (total: $($elapsed)ms)" "Gray"

# -- Helper --------------------------------------------------------------------
$safeScopes = @("operator.admin","operator.read","operator.write","operator.approvals","operator.pairing")

function Read-DeviceFiles {
    $paired  = @()
    $pending = @()
    try {
        $p = Join-Path $_devicesDir "paired.json"
        if (Test-Path $p) {
            $obj = Get-Content -Raw $p -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($obj) { $paired = @($obj.PSObject.Properties.Value) }
        }
    } catch {}
    try {
        $p = Join-Path $_devicesDir "pending.json"
        if (Test-Path $p) {
            $obj = Get-Content -Raw $p -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($obj) { $pending = @($obj.PSObject.Properties.Value) }
        }
    } catch {}
    return [pscustomobject]@{ Paired = $paired; Pending = $pending }
}

function Show-Paired {
    param([object[]]$Paired)
    if ($Paired.Count -eq 0) {
        Log "    (none)" "DarkGray"
        return
    }
    foreach ($d in $Paired) {
        Log "    [ok] $($d.deviceId)  client=$($d.clientId)  mode=$($d.clientMode)  role=$($d.role)  ip=$($d.remoteIp)" "Green"
    }
}

function Show-Pending {
    param([object[]]$Pending, [string[]]$LocalIps)
    if ($Pending.Count -eq 0) {
        Log "    (none)" "DarkGray"
        return
    }
    foreach ($r in $Pending) {
        $autoOk = (
            $r.clientId -eq "openclaw-control-ui" -and
            $r.clientMode -eq "webchat" -and
            $r.role -eq "operator" -and
            ($LocalIps -contains $r.remoteIp) -and
            (@($r.scopes | Sort-Object) -join ",") -eq (@($safeScopes | Sort-Object) -join ",")
        )
        $tag = if ($autoOk) { "(AUTO-APPROVE)" } else { "(MANUAL-NEEDED)" }
        $color = if ($autoOk) { "Yellow" } else { "Red" }
        Log "    $tag $($r.requestId)  client=$($r.clientId)  mode=$($r.clientMode)  role=$($r.role)  ip=$($r.remoteIp)" $color
        if (-not $autoOk) {
            $scopeMatch = (@($r.scopes | Sort-Object) -join ",") -eq (@($safeScopes | Sort-Object) -join ",")
            $ipMatch    = $LocalIps -contains $r.remoteIp
            Log "      scopeMatch=$scopeMatch  ipMatch=$ipMatch  localIps=[$($LocalIps -join ', ')]" "DarkGray"
        }
    }
}

# -- Initial snapshot ----------------------------------------------------------
Log ""
Log "[3] Initial device file snapshot..." "Yellow"
$t0 = $_start.ElapsedMilliseconds
$data = Read-DeviceFiles
$elapsed = $_start.ElapsedMilliseconds - $t0
Log "    Read in $($elapsed)ms - paired=$($data.Paired.Count)  pending=$($data.Pending.Count)" "Gray"

Log "    --- PAIRED ($($data.Paired.Count)) ---" "Cyan"
Show-Paired -Paired $data.Paired

Log "    --- PENDING ($($data.Pending.Count)) ---" "Cyan"
Show-Pending -Pending $data.Pending -LocalIps $ips

$hasPairedControlUi = @($data.Paired | Where-Object { $_.clientId -eq "openclaw-control-ui" }).Count -gt 0
Log ""
Log "    hasPairedControlUi = $hasPairedControlUi" "Gray"
Log "    DECISION: $(if ($hasPairedControlUi) { 'existing paired devices found - but will still poll for grace period' } else { 'no paired devices - will poll full $WatchSeconds s' })" "Cyan"

# -- Live watch loop -----------------------------------------------------------
Log ""
Log "[4] Watching device files for $($WatchSeconds)s (Ctrl+C to stop)..." "Yellow"

$deadline      = (Get-Date).AddSeconds($WatchSeconds)
$lastPaired    = $data.Paired.Count
$lastPending   = $data.Pending.Count
$pollCount     = 0
$changeCount   = 0

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $PollMs
    $t0 = $_start.ElapsedMilliseconds
    $data = Read-DeviceFiles
    $readMs = $_start.ElapsedMilliseconds - $t0
    $pollCount++

    $pairedNow  = $data.Paired.Count
    $pendingNow = $data.Pending.Count

    if ($pairedNow -ne $lastPaired -or $pendingNow -ne $lastPending) {
        $changeCount++
        Log "" "Gray"
        Log "*** CHANGE DETECTED (poll #$pollCount, read=$($readMs)ms) ***" "Magenta"
        Log "    paired: $lastPaired → $pairedNow   pending: $lastPending → $pendingNow" "Magenta"

        if ($pendingNow -gt $lastPending) {
            Log "    NEW PENDING REQUESTS:" "Yellow"
            $newPending = @($data.Pending | Where-Object {
                $old = $data.Pending  # just show all on change
                $true
            })
            Show-Pending -Pending $data.Pending -LocalIps $ips
        }
        if ($pairedNow -gt $lastPaired) {
            Log "    NEW PAIRED DEVICES:" "Green"
            Show-Paired -Paired $data.Paired
        }

        $lastPaired  = $pairedNow
        $lastPending = $pendingNow
    } else {
        # Show a dot every 10 polls so user knows it's still running
        if ($pollCount % 10 -eq 0) {
            Write-Host "." -NoNewline -ForegroundColor DarkGray
        }
    }
}

Log ""
Log ""
Log "=== Summary ===" "Cyan"
Log "  Duration:     $([int]$_start.ElapsedMilliseconds)ms"
Log "  Total polls:  $pollCount"
Log "  File changes: $changeCount"
Log "  Final paired: $lastPaired"
Log "  Final pending:$lastPending"
$finalData = Read-DeviceFiles
Log ""
Log "  Final PAIRED:" "Cyan"
Show-Paired -Paired $finalData.Paired
Log "  Final PENDING:" "Cyan"
Show-Pending -Pending $finalData.Pending -LocalIps $ips

