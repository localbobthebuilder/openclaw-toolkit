[CmdletBinding(PositionalBinding = $false)]
param(
    [switch]$Remove,
    [switch]$IncludeRunningSandboxes,
    [string]$ComposeProject = "openclaw"
)

$ErrorActionPreference = "Stop"

function Write-CleanupLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    Write-Host "[cleanup-containers] $Message" -ForegroundColor $Color
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' '). $text"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Get-DockerContainerIds {
    param([string[]]$Filters = @())

    $args = @("ps", "-a")
    foreach ($filter in @($Filters)) {
        $args += @("--filter", $filter)
    }
    $args += @("--format", "{{.ID}}")

    $result = Invoke-External -FilePath "docker" -Arguments $args -AllowFailure
    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Output)) {
        return @()
    }

    return @($result.Output -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-LabelValue {
    param(
        $Labels,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Labels) {
        return $null
    }

    $property = $Labels.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Get-ContainerInspection {
    param([Parameter(Mandatory = $true)][string]$ContainerId)

    $result = Invoke-External -FilePath "docker" -Arguments @("inspect", $ContainerId) -AllowFailure
    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Output)) {
        return $null
    }

    $items = $result.Output | ConvertFrom-Json -Depth 100
    return @($items)[0]
}

function ConvertTo-CleanupCandidate {
    param(
        [Parameter(Mandatory = $true)]$Inspection,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $name = [string]$Inspection.Name
    if ($name.StartsWith("/")) {
        $name = $name.Substring(1)
    }

    return [pscustomobject]@{
        Id      = ([string]$Inspection.Id).Substring(0, 12)
        Name    = $name
        Image   = [string]$Inspection.Config.Image
        Status  = [string]$Inspection.State.Status
        Running = [bool]$Inspection.State.Running
        Reason  = $Reason
    }
}

$dockerReady = (Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure).ExitCode -eq 0
if (-not $dockerReady) {
    throw "Docker engine is not running. Start Docker Desktop before cleaning OpenClaw containers."
}

$candidateMap = [ordered]@{}

$sandboxIds = @(
    Get-DockerContainerIds -Filters @("label=openclaw.sandbox=1")
    Get-DockerContainerIds -Filters @("name=openclaw-sbx-")
) | Select-Object -Unique

foreach ($id in @($sandboxIds)) {
    $inspection = Get-ContainerInspection -ContainerId $id
    if ($null -eq $inspection) {
        continue
    }

    $candidate = ConvertTo-CleanupCandidate -Inspection $inspection -Reason "OpenClaw sandbox worker"
    if ($candidate.Running -and -not $IncludeRunningSandboxes) {
        Write-CleanupLine "Skipping running sandbox $($candidate.Name). Re-run with -IncludeRunningSandboxes if it is stale." Yellow
        continue
    }

    $candidateMap[$candidate.Id] = $candidate
}

$composeIds = Get-DockerContainerIds -Filters @("label=com.docker.compose.project=$ComposeProject")
foreach ($id in @($composeIds)) {
    $inspection = Get-ContainerInspection -ContainerId $id
    if ($null -eq $inspection) {
        continue
    }

    $candidate = ConvertTo-CleanupCandidate -Inspection $inspection -Reason "Stopped Docker Compose project '$ComposeProject'"
    if ($candidate.Running) {
        continue
    }

    $candidateMap[$candidate.Id] = $candidate
}

$candidates = @($candidateMap.Values)

Write-CleanupLine "Container cleanup mode: $(if ($Remove) { 'remove' } else { 'preview' })" Cyan
Write-CleanupLine "Compose project filter: $ComposeProject" Cyan

if (@($candidates).Count -eq 0) {
    Write-CleanupLine "No stale OpenClaw containers were found." Green
    return
}

Write-Host ""
$candidates |
    Sort-Object Reason, Name |
    Format-Table Id, Name, Status, Image, Reason -AutoSize

if (-not $Remove) {
    Write-Host ""
    Write-CleanupLine "Preview only. Re-run with -Remove to delete these containers." Yellow
    Write-CleanupLine "Example: .\run-openclaw.cmd cleanup-containers -Remove" Yellow
    return
}

Write-Host ""
Write-CleanupLine "Removing $(@($candidates).Count) stale OpenClaw container(s)..." Cyan

$runningCandidates = @($candidates | Where-Object { $_.Running })
$stoppedCandidates = @($candidates | Where-Object { -not $_.Running })

if (@($stoppedCandidates).Count -gt 0) {
    $null = Invoke-External -FilePath "docker" -Arguments (@("rm") + @($stoppedCandidates | ForEach-Object { $_.Id }))
}

if (@($runningCandidates).Count -gt 0) {
    $null = Invoke-External -FilePath "docker" -Arguments (@("rm", "-f") + @($runningCandidates | ForEach-Object { $_.Id }))
}

Write-CleanupLine "Removed $(@($candidates).Count) stale OpenClaw container(s)." Green
