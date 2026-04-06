[CmdletBinding()]
param(
    [int]$Lines = 200
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-gateway-cli-startup.ps1")

$json = & docker @(Get-ToolkitGatewayOpenClawDockerExecArgs -ContainerName "openclaw-openclaw-gateway-1" -Arguments @("channels", "logs", "--json", "--channel", "telegram", "--lines", [string]$Lines))
if ($LASTEXITCODE -ne 0) {
    throw "Failed to read Telegram channel logs from the gateway."
}

$payload = $json | ConvertFrom-Json
$userRows = @()
$groupRows = @()

foreach ($line in @($payload.lines)) {
    $message = [string]$line.message

    if ($message -match '"senderUserId":"(?<user>\d+)".*?"username":"(?<username>[^"]*)".*?"firstName":"(?<first>[^"]*)".*?"lastName":"(?<last>[^"]*)"') {
        $userRows += [pscustomobject]@{
            Time      = $line.time
            UserId    = $Matches.user
            Username  = $Matches.username
            Name      = ((@($Matches.first, $Matches.last) | Where-Object { $_ }) -join " ").Trim()
            Source    = "pairing-request"
        }
    }

    if ($message -match 'Group migrated: "(?<title>[^"]+)" (?<old>-?\d+)\s+\S+\s+(?<new>-?\d+)') {
        $groupRows += [pscustomobject]@{
            Time       = $line.time
            Title      = $Matches.title
            OldGroupId = $Matches.old
            NewGroupId = $Matches.new
            Source     = "migration"
        }
    }
}

$userRows = @(
    $userRows |
        Sort-Object Time -Descending |
        Group-Object UserId |
        ForEach-Object { $_.Group | Select-Object -First 1 }
)
$groupRows = @(
    $groupRows |
        Sort-Object Time -Descending |
        Group-Object NewGroupId |
        ForEach-Object { $_.Group | Select-Object -First 1 }
)

Write-Host ""
Write-Host "Telegram users seen in logs" -ForegroundColor Cyan
if ($userRows) {
    $userRows | Format-Table -AutoSize
}
else {
    Write-Host "No Telegram user IDs found in recent logs." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Telegram groups seen in logs" -ForegroundColor Cyan
if ($groupRows) {
    $groupRows | Format-Table -AutoSize
}
else {
    Write-Host "No Telegram group IDs found in recent logs." -ForegroundColor Yellow
}
