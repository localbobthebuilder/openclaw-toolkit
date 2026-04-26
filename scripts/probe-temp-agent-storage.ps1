[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$StateRoot,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$AgentIdPrefix = "api-probe",
    [string]$ModelRef = "ollama/gemma4:latest",
    [switch]$SkipSessionCreate,
    [switch]$KeepAgent,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

# Derive defaults from bootstrap config so paths are portable across machines/users
$_scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$_configFile = Join-Path $_scriptDir "openclaw-bootstrap.config.json"
if (-not $RepoPath -or -not $StateRoot) {
    if (Test-Path $_configFile) {
        . (Join-Path $_scriptDir "shared-config-paths.ps1")
        $_bsCfg = Get-Content -Raw $_configFile | ConvertFrom-Json
        $_bsCfg = Resolve-PortableConfigPaths -Config $_bsCfg -BaseDir $_scriptDir
        if (-not $RepoPath   -and $_bsCfg.repoPath)      { $RepoPath   = [string]$_bsCfg.repoPath }
        if (-not $StateRoot  -and $_bsCfg.hostConfigDir)  { $StateRoot  = [string]$_bsCfg.hostConfigDir }
    }
    if (-not $RepoPath)  { $RepoPath  = [System.IO.Path]::GetFullPath((Join-Path $_scriptDir "..\openclaw")) }
    if (-not $StateRoot) { $StateRoot = Join-Path $env:USERPROFILE ".openclaw" }
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

function Invoke-DockerExec {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    Invoke-External -FilePath "docker" -Arguments (@("exec", $ContainerName) + $Arguments) -AllowFailure:$AllowFailure
}

function Invoke-GatewayCall {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [object]$Params = @{}
    )

    $paramsJson = $Params | ConvertTo-Json -Depth 50 -Compress
    $result = Invoke-DockerExec -Arguments @("openclaw", "gateway", "call", $Method, "--params", $paramsJson)
    $text = $result.Output
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "Gateway call returned no output for method '$Method'."
    }

    $jsonText = $text -replace '^Gateway call:.*?(\r?\n)', ''
    return $jsonText | ConvertFrom-Json -Depth 100
}

function Wait-GatewayReady {
    param([int]$TimeoutSeconds = 45)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $null = Invoke-GatewayCall -Method "agents.list"
            return
        }
        catch {
            Start-Sleep -Seconds 2
        }
    } while ((Get-Date) -lt $deadline)

    throw "Gateway did not become ready within $TimeoutSeconds seconds."
}

function Remove-ManagedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ($resolved -notlike "$StateRoot*") {
        throw "Refusing to remove path outside state root: $resolved"
    }

    Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Write-Info {
    param([string]$Message)

    if (-not $Json) {
        Write-Host $Message -ForegroundColor Cyan
    }
}

Write-Info "==> Temporary agent storage probe"

$containerProbe = Invoke-External -FilePath "docker" -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0 -or -not (($containerProbe.Output -split '\r?\n') -contains $ContainerName)) {
    throw "Gateway container '$ContainerName' is not running."
}

$configPath = Join-Path $StateRoot "openclaw.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "OpenClaw config was not found at $configPath"
}

$configBefore = Invoke-GatewayCall -Method "config.get"
$beforeHash = [string]$configBefore.hash
$beforeAgents = @($configBefore.config.agents.list)

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$agentId = "$AgentIdPrefix-$suffix"
$workspaceUnix = "/home/node/.openclaw/workspace-$agentId"
$workspaceWindows = Join-Path $StateRoot "workspace-$agentId"
$agentRoot = Join-Path $StateRoot (Join-Path "agents" $agentId)
$agentSessionsRoot = Join-Path $agentRoot "sessions"
$agentsDirectoryPath = Join-Path $StateRoot "agents"
$probeStartedUtc = (Get-Date).ToUniversalTime()
$configLastWriteBefore = (Get-Item -LiteralPath $configPath).LastWriteTimeUtc
$agentsDirectoryLastWriteBefore = if (Test-Path -LiteralPath $agentsDirectoryPath) {
    (Get-Item -LiteralPath $agentsDirectoryPath).LastWriteTimeUtc
}
else {
    $null
}
$backupFilesBefore = @(
    Get-ChildItem -Path (Join-Path $StateRoot "openclaw.json.bak*") -Force -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
)

$agentEntry = [ordered]@{
    id        = $agentId
    name      = "API Probe $suffix"
    workspace = $workspaceUnix
    model     = [ordered]@{
        primary   = $ModelRef
        fallbacks = @()
    }
    sandbox   = [ordered]@{
        mode = "off"
    }
}

$patch = [ordered]@{
    agents = [ordered]@{
        list = @($beforeAgents) + $agentEntry
    }
}

Write-Info "Creating temporary agent '$agentId' through gateway config.patch"
$addResult = Invoke-GatewayCall -Method "config.patch" -Params @{
    raw      = ($patch | ConvertTo-Json -Depth 50 -Compress)
    baseHash = $beforeHash
}

Start-Sleep -Seconds 3
$agentsAfterAdd = Invoke-GatewayCall -Method "agents.list"

$sessionResult = $null
if (-not $SkipSessionCreate) {
    Write-Info "Creating one session through gateway sessions.create"
    $sessionResult = Invoke-GatewayCall -Method "sessions.create" -Params @{
        key     = "main"
        agentId = $agentId
        label   = "API probe session"
    }
}

$agentTree = @()
if (Test-Path -LiteralPath $agentRoot) {
    $agentTree = @(
        Get-ChildItem -LiteralPath $agentRoot -Recurse -Force |
            Select-Object FullName, LastWriteTimeUtc, Length, @{Name = "IsDirectory"; Expression = { $_.PSIsContainer } }
    )
}

$workspaceTree = @()
if (Test-Path -LiteralPath $workspaceWindows) {
    $workspaceTree = @(
        Get-ChildItem -LiteralPath $workspaceWindows -Recurse -Force |
            Select-Object FullName, LastWriteTimeUtc, Length, @{Name = "IsDirectory"; Expression = { $_.PSIsContainer } }
    )
}

$relevantChanged = @()
$configAfterItem = Get-Item -LiteralPath $configPath
if ($configAfterItem.LastWriteTimeUtc -gt $configLastWriteBefore) {
    $relevantChanged += [pscustomobject]@{
        FullName         = $configAfterItem.FullName
        LastWriteTimeUtc = $configAfterItem.LastWriteTimeUtc
        Length           = $configAfterItem.Length
        IsDirectory      = $false
    }
}

$backupFilesAfter = @(
    Get-ChildItem -Path (Join-Path $StateRoot "openclaw.json.bak*") -Force -ErrorAction SilentlyContinue
)
foreach ($backupFile in $backupFilesAfter) {
    if ($backupFile.FullName -notin $backupFilesBefore -or $backupFile.LastWriteTimeUtc -ge $probeStartedUtc.AddSeconds(-1)) {
        $relevantChanged += [pscustomobject]@{
            FullName         = $backupFile.FullName
            LastWriteTimeUtc = $backupFile.LastWriteTimeUtc
            Length           = $backupFile.Length
            IsDirectory      = $false
        }
    }
}

if (Test-Path -LiteralPath $agentsDirectoryPath) {
    $agentsDirectoryAfterItem = Get-Item -LiteralPath $agentsDirectoryPath
    if (-not $agentsDirectoryLastWriteBefore -or $agentsDirectoryAfterItem.LastWriteTimeUtc -gt $agentsDirectoryLastWriteBefore) {
        $relevantChanged += [pscustomobject]@{
            FullName         = $agentsDirectoryAfterItem.FullName
            LastWriteTimeUtc = $agentsDirectoryAfterItem.LastWriteTimeUtc
            Length           = $null
            IsDirectory      = $true
        }
    }
}

$relevantAdded = @()
if (Test-Path -LiteralPath $agentRoot) {
    $agentRootItem = Get-Item -LiteralPath $agentRoot
    $relevantAdded += [pscustomobject]@{
        FullName         = $agentRootItem.FullName
        LastWriteTimeUtc = $agentRootItem.LastWriteTimeUtc
        Length           = $null
        IsDirectory      = $true
    }
}

if (Test-Path -LiteralPath $agentSessionsRoot) {
    $agentSessionsItem = Get-Item -LiteralPath $agentSessionsRoot
    $relevantAdded += [pscustomobject]@{
        FullName         = $agentSessionsItem.FullName
        LastWriteTimeUtc = $agentSessionsItem.LastWriteTimeUtc
        Length           = $null
        IsDirectory      = $true
    }
}

$relevantAdded += $agentTree

if (Test-Path -LiteralPath $workspaceWindows) {
    $workspaceRootItem = Get-Item -LiteralPath $workspaceWindows
    $relevantAdded += [pscustomobject]@{
        FullName         = $workspaceRootItem.FullName
        LastWriteTimeUtc = $workspaceRootItem.LastWriteTimeUtc
        Length           = $null
        IsDirectory      = $true
    }
}

$relevantAdded += $workspaceTree

$cleanup = [ordered]@{
    Performed       = $false
    GatewayRestarted = $false
    RemovedAgentConfig = $false
    RemovedAgentPath = $false
    RemovedWorkspacePath = $false
}

if (-not $KeepAgent) {
    $fileConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -Depth 100
    $agentIndex = -1
    for ($i = 0; $i -lt @($fileConfig.agents.list).Count; $i++) {
        if ([string]$fileConfig.agents.list[$i].id -eq $agentId) {
            $agentIndex = $i
            break
        }
    }

    if ($agentIndex -ge 0) {
        Write-Info "Removing temporary agent config entry"
        $null = Invoke-DockerExec -Arguments @("openclaw", "config", "unset", "agents.list[$agentIndex]")
        $cleanup.RemovedAgentConfig = $true
    }

    Write-Info "Restarting gateway so live agent state matches disk"
    $null = Invoke-External -FilePath "docker" -Arguments @("restart", $ContainerName)
    $cleanup.GatewayRestarted = $true
    Wait-GatewayReady

    if (Test-Path -LiteralPath $agentRoot) {
        Write-Info "Removing temporary agent session directory"
        Remove-ManagedPath -Path $agentRoot
        $cleanup.RemovedAgentPath = $true
    }

    if (Test-Path -LiteralPath $workspaceWindows) {
        Write-Info "Removing temporary workspace directory"
        Remove-ManagedPath -Path $workspaceWindows
        $cleanup.RemovedWorkspacePath = $true
    }

    $cleanup.Performed = $true
}

$agentsAfterCleanup = Invoke-GatewayCall -Method "agents.list"

$createdVia = @("gateway config.patch")
if (-not $SkipSessionCreate) {
    $createdVia += "gateway sessions.create"
}

$result = [ordered]@{
    agentId            = $agentId
    modelRef           = $ModelRef
    workspaceUnix      = $workspaceUnix
    workspaceWindows   = $workspaceWindows
    stateRoot          = $StateRoot
    gatewayContainer   = $ContainerName
    createdVia         = $createdVia
    addResultOk        = [bool]$addResult.ok
    sessionCreate      = $sessionResult
    liveAgentsAfterAdd = @($agentsAfterAdd.agents)
    relevantAdded      = $relevantAdded
    relevantChanged    = $relevantChanged
    agentTree          = $agentTree
    workspaceTree      = $workspaceTree
    cleanup            = $cleanup
    liveAgentsAfterCleanup = @($agentsAfterCleanup.agents)
}

if ($Json) {
    $result | ConvertTo-Json -Depth 100
    exit 0
}

Write-Host ""
Write-Host "Temporary agent:" -ForegroundColor Green
Write-Host "  Id: $agentId"
Write-Host "  Model: $ModelRef"
Write-Host "  Workspace: $workspaceUnix"

Write-Host ""
Write-Host "Persistent writes observed under ${StateRoot}:" -ForegroundColor Green
if (@($relevantChanged).Count -eq 0 -and @($relevantAdded).Count -eq 0) {
    Write-Host "  No state changes detected."
}
else {
    foreach ($entry in @($relevantChanged)) {
        Write-Host "  CHANGED $($entry.FullName)"
    }
    foreach ($entry in @($relevantAdded)) {
        Write-Host "  ADDED   $($entry.FullName)"
    }
}

Write-Host ""
Write-Host "Agent-specific tree created:" -ForegroundColor Green
if (@($agentTree).Count -eq 0) {
    Write-Host "  No agent-specific files were materialized."
}
else {
    foreach ($entry in @($agentTree)) {
        Write-Host "  $($entry.FullName)"
    }
}

Write-Host ""
Write-Host "Workspace tree created:" -ForegroundColor Green
if (@($workspaceTree).Count -eq 0) {
    Write-Host "  No separate workspace directory was created by this minimal probe."
}
else {
    foreach ($entry in @($workspaceTree)) {
        Write-Host "  $($entry.FullName)"
    }
}

Write-Host ""
Write-Host "Cleanup:" -ForegroundColor Green
if ($cleanup.Performed) {
    Write-Host "  Temporary agent was removed from config."
    Write-Host "  Gateway restart was performed to flush live agent state."
    if ($cleanup.RemovedAgentPath) {
        Write-Host "  Temporary session files were deleted."
    }
    if ($cleanup.RemovedWorkspacePath) {
        Write-Host "  Temporary workspace directory was deleted."
    }
}
else {
    Write-Host "  KeepAgent was set, so the temporary agent and any session files were left in place."
}
