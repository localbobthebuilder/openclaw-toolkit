[CmdletBinding()]
param(
    [string]$AgentId,
    [switch]$All,
    [switch]$Json,
    [switch]$SkipGatewayRestart
)

$ErrorActionPreference = 'Stop'

function Write-InfoLine {
    param([string]$Message)
    if (-not $Json) {
        Write-Host $Message -ForegroundColor Cyan
    }
}

function Get-ToolkitRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-ToolkitConfigPath {
    return Join-Path (Get-ToolkitRoot) 'openclaw-bootstrap.config.json'
}

function Get-ToolkitConfig {
    return Get-Content -LiteralPath (Get-ToolkitConfigPath) -Raw | ConvertFrom-Json -Depth 100
}

function Resolve-ToolkitPath {
    param(
        [string]$Value,
        [string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($Value)
    if ([System.IO.Path]::IsPathRooted($expanded)) {
        return [System.IO.Path]::GetFullPath($expanded)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $expanded))
}

function Get-HostConfigDir {
    param([pscustomobject]$Config)

    $toolkitRoot = Get-ToolkitRoot
    $configured = if ($Config.PSObject.Properties.Name -contains 'hostConfigDir') { [string]$Config.hostConfigDir } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        return Resolve-ToolkitPath -Value $configured -BaseDir $toolkitRoot
    }

    return Join-Path $HOME '.openclaw'
}

function Test-ValidAgentId {
    param([string]$Value)

    return $Value -match '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
}

function Get-AgentRootDirectories {
    param([string]$HostConfigDir)

    $agentsRoot = Join-Path $HostConfigDir 'agents'
    if (-not (Test-Path -LiteralPath $agentsRoot)) {
        return @()
    }

    return @(Get-ChildItem -LiteralPath $agentsRoot -Directory -Force -ErrorAction SilentlyContinue)
}

function Get-KnownAgentIds {
    param([string]$HostConfigDir)

    $ids = New-Object 'System.Collections.Generic.List[string]'
    foreach ($directory in (Get-AgentRootDirectories -HostConfigDir $HostConfigDir)) {
        $id = [string]$directory.Name
        if ((-not [string]::IsNullOrWhiteSpace($id)) -and (Test-ValidAgentId -Value $id)) {
            [void]$ids.Add($id.Trim())
        }
    }

    return @($ids | Sort-Object -Unique)
}

function Get-AgentSessionsStore {
    param(
        [string]$HostConfigDir,
        [string]$AgentId
    )

    return Join-Path (Join-Path (Join-Path $HostConfigDir 'agents') $AgentId) 'sessions'
}

function Clear-AgentSessionsCore {
    param(
        [string]$HostConfigDir,
        [string]$AgentId
    )

    $sessionsDir = Get-AgentSessionsStore -HostConfigDir $HostConfigDir -AgentId $AgentId
    if (-not (Test-Path -LiteralPath $sessionsDir)) {
        New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
        $removedEntries = 0
    } else {
        $entries = @(Get-ChildItem -LiteralPath $sessionsDir -Force -ErrorAction SilentlyContinue)
        foreach ($entry in $entries) {
            Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
        $removedEntries = @($entries).Count
    }

    return [pscustomobject]@{
        agentId        = $AgentId
        deletedSessions = 0
        removedEntries = $removedEntries
        gatewayErrors  = @()
    }
}

function Test-GatewayContainerRunning {
    $names = (& docker ps --format '{{.Names}}' 2>$null)
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    return @($names) -contains 'openclaw-openclaw-gateway-1'
}

function Restart-GatewayContainer {
    if (-not (Test-GatewayContainerRunning)) {
        return [pscustomobject]@{
            attempted = $false
            restarted = $false
            warning   = 'Gateway container is not running, so no restart was attempted.'
        }
    }

    Write-InfoLine 'Restarting gateway once after session cleanup...'
    $output = (& docker restart openclaw-openclaw-gateway-1 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw ($output ? $output : 'Failed to restart openclaw-openclaw-gateway-1.')
    }

    return [pscustomobject]@{
        attempted = $true
        restarted = $true
        warning   = ''
    }
}

$toolkitConfig = Get-ToolkitConfig
$hostConfigDir = Get-HostConfigDir -Config $toolkitConfig

if (-not $All) {
    $AgentId = [string]$AgentId
    if ([string]::IsNullOrWhiteSpace($AgentId)) {
        throw 'Provide -AgentId <id> or use -All.'
    }
    if (-not (Test-ValidAgentId -Value $AgentId)) {
        throw "Invalid agent id '$AgentId'."
    }
}

$targetAgentIds = if ($All) {
    @(Get-KnownAgentIds -HostConfigDir $hostConfigDir)
} else {
    @($AgentId.Trim())
}

if (@($targetAgentIds).Count -eq 0) {
    throw 'No known agents were found to clear.'
}

$results = foreach ($targetAgentId in $targetAgentIds) {
    Write-InfoLine "Clearing sessions for $targetAgentId..."
    Clear-AgentSessionsCore -HostConfigDir $hostConfigDir -AgentId $targetAgentId
}

$restartInfo = if ($SkipGatewayRestart) {
    [pscustomobject]@{
        attempted = $false
        restarted = $false
        warning   = 'Gateway restart skipped by request.'
    }
} else {
    Restart-GatewayContainer
}

$payload = [pscustomobject]@{
    ok         = $true
    clearedAll = [bool]$All
    agentIds   = @($targetAgentIds)
    results    = @($results)
    gatewayRestart = $restartInfo
}

if ($Json) {
    $payload | ConvertTo-Json -Depth 20
    return
}

foreach ($result in $results) {
    Write-Host ("[{0}] removed {1} stored entry(ies)" -f $result.agentId, $result.removedEntries) -ForegroundColor Green
}

if (-not [string]::IsNullOrWhiteSpace([string]$restartInfo.warning)) {
    Write-Warning ([string]$restartInfo.warning)
}
