[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [switch]$PromptForOtherPending,
    [switch]$OpenDashboard,
    [int]$PollSeconds = 8
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

function Get-DeviceList {
    Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "devices", "list", "--json"
    ) -AllowFailure
}

function Parse-DeviceList {
    param(
        [Parameter(Mandatory = $true)][string]$JsonText,
        [int]$ExitCode = 0
    )
    try {
        return $JsonText | ConvertFrom-Json -Depth 20
    }
    catch {
        if ($ExitCode -ne 0) {
            throw "Could not parse device list JSON. devices list failed with exit code $ExitCode.`n$JsonText"
        }
        throw "Could not parse device list JSON.`n$JsonText"
    }
}

$safeScopes = @(
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing"
)

function Get-ApprovalBuckets {
    param([object[]]$Pending)
    $autoApprove = @($Pending | Where-Object {
            $_.clientId -eq "openclaw-control-ui" -and
            $_.clientMode -eq "webchat" -and
            $_.role -eq "operator" -and
            $_.remoteIp -eq "172.18.0.1" -and
            (@($_.scopes | Sort-Object) -join ",") -eq (@($safeScopes | Sort-Object) -join ",")
        })
    $otherPending = @($Pending | Where-Object { $_.requestId -notin @($autoApprove | ForEach-Object { $_.requestId }) })
    return [pscustomobject]@{
        Auto  = $autoApprove
        Other = $otherPending
    }
}

function Approve-Requests {
    param([object[]]$Requests)
    foreach ($request in $Requests) {
        $requestId = [string]$request.requestId
        $approve = Invoke-External -FilePath "docker" -Arguments @(
            "exec", $ContainerName,
            "node", "dist/index.js",
            "devices", "approve", $requestId
        ) -AllowFailure
        if ($approve.Output) {
            Write-Host $approve.Output
        }
    }
}

function Invoke-RepairPass {
    $list = Get-DeviceList
    if (-not $list.Output) {
        Write-Host "No device list output was returned." -ForegroundColor Yellow
        return [pscustomobject]@{ Pending = @(); Auto = @(); Other = @() }
    }

    $devices = Parse-DeviceList -JsonText $list.Output -ExitCode $list.ExitCode
    $pending = @($devices.pending)
    if ($pending.Count -eq 0) {
        return [pscustomobject]@{ Pending = @(); Auto = @(); Other = @() }
    }

    $buckets = Get-ApprovalBuckets -Pending $pending
    Write-Host "Pending requests:" -ForegroundColor Cyan
    foreach ($request in $pending) {
        $marker = if ($request.requestId -in @($buckets.Auto | ForEach-Object { $_.requestId })) { "[auto]" } else { "[manual]" }
        Write-Host "- $marker $($request.requestId) client=$($request.clientId) mode=$($request.clientMode) role=$($request.role) ip=$($request.remoteIp)"
    }
    if ($buckets.Auto.Count -gt 0) {
        Approve-Requests -Requests $buckets.Auto
    }
    return [pscustomobject]@{
        Pending = $pending
        Auto    = $buckets.Auto
        Other   = $buckets.Other
    }
}

if ($OpenDashboard) {
    & (Join-Path $PSScriptRoot "open-dashboard.ps1")
}

$result = Invoke-RepairPass
$approvedAuto = $result.Auto.Count -gt 0
if ($result.Pending.Count -eq 0 -and $OpenDashboard) {
    $deadline = (Get-Date).AddSeconds([Math]::Max(0, $PollSeconds))
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 750
        $result = Invoke-RepairPass
        if ($result.Auto.Count -gt 0) {
            $approvedAuto = $true
        }
        if ($result.Pending.Count -gt 0) {
            break
        }
    }
}

if ($result.Pending.Count -eq 0) {
    Write-Host "No pending pairing requests were found." -ForegroundColor Green
    exit 0
}

if ($result.Other.Count -gt 0) {
    Write-Host ""
    Write-Host "Some pending requests were not auto-approved." -ForegroundColor Yellow

    if ($PromptForOtherPending) {
        $answer = Read-Host "Approve the remaining pending request IDs too? (y/n)"
        if ($answer -in @("y", "Y", "yes", "YES")) {
            Approve-Requests -Requests $result.Other
        }
    }
}

Write-Host ""
Write-Host "Pairing repair complete. Reopen the dashboard now:" -ForegroundColor Green
Write-Host "D:\openclaw\openclaw-toolkit\run-dashboard.cmd"
if ($OpenDashboard -and $approvedAuto) {
    Start-Sleep -Milliseconds 750
    Write-Host ""
    Write-Host "Opening a fresh dashboard tab now that pairing is approved..." -ForegroundColor Green
    & (Join-Path $PSScriptRoot "open-dashboard.ps1")
}


