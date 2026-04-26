[CmdletBinding()]
param(
    [int]$EveryMinutes = 5,
    [switch]$RestartOnFailure = $true,
    [switch]$AlertOnFailure = $true,
    [switch]$SkipInternetCheck
)

$ErrorActionPreference = "Stop"

if ($EveryMinutes -lt 1) {
    throw "EveryMinutes must be at least 1."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchdogScript = Join-Path $scriptDir "watchdog-openclaw.ps1"
$taskName = "OpenClaw Watchdog"

if (-not (Test-Path $watchdogScript)) {
    throw "Watchdog script not found: $watchdogScript"
}

$pwshCommand = (Get-Command pwsh -ErrorAction SilentlyContinue)
$shell = if ($null -ne $pwshCommand) { $pwshCommand.Source } else { "powershell.exe" }

$args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$watchdogScript`"")
if ($RestartOnFailure) {
    $args += "-RestartOnFailure"
}
if ($AlertOnFailure) {
    $args += "-AlertOnFailure"
}
if ($SkipInternetCheck) {
    $args += "-SkipInternetCheck"
}

$action = New-ScheduledTaskAction -Execute $shell -Argument ($args -join " ")
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "OpenClaw watchdog health check and optional self-heal" -Force | Out-Null

Write-Host "Scheduled task installed:" -ForegroundColor Green
Write-Host $taskName
