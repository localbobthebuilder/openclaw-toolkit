[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$StrongModelRef,
    [string]$ResearchModelRef,
    [string]$LocalChatModelRef,
    [string]$HostedTelegramModelRef,
    [string]$LocalReviewModelRef,
    [string]$LocalCoderModelRef,
    [string]$RemoteReviewModelRef,
    [string]$RemoteCoderModelRef,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
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

function Set-OpenClawConfigJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [switch]$AsArray
    )

    if (($AsArray -or $Value -is [System.Array]) -and @($Value).Count -eq 0) {
        $json = "[]"
    }
    else {
        if ($AsArray -or $Value -is [System.Array]) {
            $json = @($Value) | ConvertTo-Json -AsArray -Depth 50 -Compress
        }
        else {
            $json = $Value | ConvertTo-Json -Depth 50 -Compress
        }
    }

    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "config", "set", $Path, $json, "--strict-json"
    )
}

function Remove-OpenClawConfigJson {
    param([Parameter(Mandatory = $true)][string]$Path)

    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "config", "unset", $Path
    ) -AllowFailure
}

function Get-OpenClawConfigJsonValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "config", "get", $Path
    ) -AllowFailure

    if ($result.ExitCode -ne 0) {
        return $null
    }

    $raw = $result.Output.Trim()
    if (-not $raw) {
        return $null
    }

    try {
        return $raw | ConvertFrom-Json -Depth 50
    }
    catch {
        return $null
    }
}

function Add-UniqueString {
    param(
        [string[]]$List = @(),
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @($List)
    }

    if ($Value -notin @($List)) {
        return @(@($List) + $Value)
    }

    return @($List)
}

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-HostWorkspaceDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostWorkspaceDir" -and $Config.hostWorkspaceDir) {
        return [string]$Config.hostWorkspaceDir
    }

    return (Join-Path (Get-HostConfigDir -Config $Config) "workspace")
}

function Resolve-HostWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$WorkspacePath
    )

    $hostConfigDir = Get-HostConfigDir -Config $Config
    $hostWorkspaceDir = Get-HostWorkspaceDir -Config $Config
    $defaultContainerWorkspace = "/home/node/.openclaw/workspace"
    $containerHomeRoot = "/home/node/.openclaw"

    if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or $WorkspacePath -eq $defaultContainerWorkspace) {
        return $hostWorkspaceDir
    }

    if ($WorkspacePath.StartsWith($containerHomeRoot + "/")) {
        $relative = $WorkspacePath.Substring(($containerHomeRoot + "/").Length) -replace '/', '\'
        return (Join-Path $hostConfigDir $relative)
    }

    return $hostWorkspaceDir
}

function Get-RolePolicyLines {
    param(
        [Parameter(Mandatory = $true)]$RolePolicies,
        [string]$Key
    )

    if ($null -eq $RolePolicies -or [string]::IsNullOrWhiteSpace($Key)) {
        return @()
    }

    $value = $RolePolicies.$Key
    if ($null -eq $value) {
        return @()
    }

    return @($value | ForEach-Object { [string]$_ })
}

function Get-AgentRolePolicyKey {
    param(
        $AgentConfig,
        [string]$DefaultKey
    )

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "rolePolicyKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.rolePolicyKey)) {
        return [string]$AgentConfig.rolePolicyKey
    }

    return $DefaultKey
}

function Ensure-WorkspaceAgentsFile {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$WorkspacePath,
        [string[]]$ContentLines
    )

    if (@($ContentLines).Count -eq 0) {
        return $null
    }

    $hostWorkspacePath = Resolve-HostWorkspacePath -Config $Config -WorkspacePath $WorkspacePath
    if (-not (Test-Path $hostWorkspacePath)) {
        New-Item -ItemType Directory -Force -Path $hostWorkspacePath | Out-Null
    }

    $agentsPath = Join-Path $hostWorkspacePath "AGENTS.md"
    $content = (@($ContentLines) -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine
    $current = if (Test-Path $agentsPath) { Get-Content -Raw $agentsPath } else { $null }
    if ($current -ne $content) {
        Set-Content -Path $agentsPath -Value $content -Encoding UTF8
    }

    return $agentsPath
}

function Ensure-ManagedTextFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$ContentLines
    )

    if (@($ContentLines).Count -eq 0) {
        return $null
    }

    $parentDir = Split-Path -Parent $Path
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    $content = (@($ContentLines) -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine
    $current = if (Test-Path $Path) { Get-Content -Raw $Path } else { $null }
    if ($current -ne $content) {
        Set-Content -Path $Path -Value $content -Encoding UTF8
    }

    return $Path
}

function Remove-ManagedTextFileIfPresent {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Remove-Item -LiteralPath $Path -Force
}

function Get-AgentBootstrapOverlayDir {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [string]$OverlayDirName = "bootstrap"
    )

    return (Join-Path (Join-Path (Join-Path (Get-HostConfigDir -Config $Config) "agents") $AgentId) $OverlayDirName)
}

function Ensure-AgentBootstrapOverlayFile {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$FileName,
        [string[]]$ContentLines,
        [string]$OverlayDirName = "bootstrap"
    )

    $overlayDir = Get-AgentBootstrapOverlayDir -Config $Config -AgentId $AgentId -OverlayDirName $OverlayDirName
    return (Ensure-ManagedTextFile -Path (Join-Path $overlayDir $FileName) -ContentLines $ContentLines)
}

function New-AgentEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Workspace,
        [string]$ModelRef,
        [string[]]$FallbackRefs = @(),
        [bool]$IsDefault = $false,
        $Tools,
        $Sandbox,
        $Subagents
    )

    $entry = [ordered]@{
        id   = $Id
        name = $Name
    }

    if ($Workspace) {
        $entry.workspace = $Workspace
    }
    if ($ModelRef) {
        $entry.model = [ordered]@{
            primary   = $ModelRef
            fallbacks = @(
                foreach ($fallbackRef in @($FallbackRefs)) {
                    if (-not [string]::IsNullOrWhiteSpace([string]$fallbackRef) -and [string]$fallbackRef -ne $ModelRef) {
                        [string]$fallbackRef
                    }
                }
            )
        }
    }
    if ($IsDefault) {
        $entry.default = $true
    }
    if ($null -ne $Tools) {
        $entry.tools = $Tools
    }
    if ($null -ne $Sandbox) {
        $entry.sandbox = $Sandbox
    }
    if ($null -ne $Subagents) {
        $entry.subagents = $Subagents
    }

    return $entry
}

function Get-AgentSubagentPolicy {
    param($AgentConfig)

    if ($null -eq $AgentConfig) {
        return $null
    }
    if (-not ($AgentConfig.PSObject.Properties.Name -contains "subagents")) {
        return $null
    }

    $subagents = $AgentConfig.subagents
    if ($null -eq $subagents) {
        return $null
    }

    if ($subagents.PSObject.Properties.Name -contains "enabled" -and -not [bool]$subagents.enabled) {
        return $null
    }

    $entry = [ordered]@{}
    if ($subagents.PSObject.Properties.Name -contains "requireAgentId") {
        $entry.requireAgentId = [bool]$subagents.requireAgentId
    }
    if ($subagents.PSObject.Properties.Name -contains "allowAgents") {
        $entry.allowAgents = @($subagents.allowAgents | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    if ($entry.Count -eq 0) {
        return $null
    }

    return $entry
}

function Get-SharedWorkspacePath {
    param([Parameter(Mandatory = $true)]$MultiConfig)

    if ($MultiConfig.sharedWorkspace -and $MultiConfig.sharedWorkspace.enabled) {
        if ($MultiConfig.sharedWorkspace.path) {
            return [string]$MultiConfig.sharedWorkspace.path
        }
        return "/home/node/.openclaw/workspace"
    }

    return $null
}

function Get-DefaultPrivateWorkspacePath {
    param(
        [string]$AgentId
    )

    if ([string]::IsNullOrWhiteSpace($AgentId) -or $AgentId -eq "main") {
        return "/home/node/.openclaw/workspace"
    }

    return "/home/node/.openclaw/workspace-$AgentId"
}

function Get-AgentWorkspaceMode {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        $AgentConfig
    )

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "workspaceMode" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.workspaceMode)) {
        $mode = ([string]$AgentConfig.workspaceMode).ToLowerInvariant()
        if ($mode -in @("shared", "private")) {
            return $mode
        }
    }

    if (Get-SharedWorkspacePath -MultiConfig $MultiConfig) {
        return "shared"
    }

    return "private"
}

function Test-AgentUsesSharedWorkspace {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        $AgentConfig
    )

    return ((Get-AgentWorkspaceMode -MultiConfig $MultiConfig -AgentConfig $AgentConfig) -eq "shared")
}

function Get-AgentWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        $AgentConfig
    )

    $sharedWorkspacePath = Get-SharedWorkspacePath -MultiConfig $MultiConfig
    if ($sharedWorkspacePath -and (Test-AgentUsesSharedWorkspace -MultiConfig $MultiConfig -AgentConfig $AgentConfig)) {
        return $sharedWorkspacePath
    }

    if ($null -ne $AgentConfig -and $AgentConfig.PSObject.Properties.Name -contains "workspace" -and $AgentConfig.workspace) {
        return [string]$AgentConfig.workspace
    }

    if ($null -ne $AgentConfig -and $AgentConfig.PSObject.Properties.Name -contains "id" -and $AgentConfig.id) {
        return (Get-DefaultPrivateWorkspacePath -AgentId ([string]$AgentConfig.id))
    }

    return (Get-DefaultPrivateWorkspacePath -AgentId $null)
}

function Test-AgentCanAccessSharedWorkspace {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        $AgentConfig
    )

    if (-not (Get-SharedWorkspacePath -MultiConfig $MultiConfig)) {
        return $false
    }

    if (Test-AgentUsesSharedWorkspace -MultiConfig $MultiConfig -AgentConfig $AgentConfig) {
        return $false
    }

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "sharedWorkspaceAccess" -and
        $null -ne $AgentConfig.sharedWorkspaceAccess) {
        return [bool]$AgentConfig.sharedWorkspaceAccess
    }

    return $false
}

function Expand-PolicyTemplateLines {
    param(
        [string[]]$Lines,
        [string]$WorkspacePath,
        [string]$SharedWorkspacePath
    )

    return @(
        foreach ($line in @($Lines)) {
            $expanded = [string]$line
            $expanded = $expanded.Replace("{{WORKSPACE_PATH}}", [string]$WorkspacePath)
            $expanded = $expanded.Replace("{{SHARED_WORKSPACE_PATH}}", [string]$SharedWorkspacePath)
            $expanded
        }
    )
}

function Get-SharedWorkspaceAccessLines {
    param(
        [string]$WorkspacePath,
        [string]$SharedWorkspacePath
    )

    if ([string]::IsNullOrWhiteSpace($SharedWorkspacePath)) {
        return @()
    }

    $resolvedWorkspacePath = if ($WorkspacePath) { [string]$WorkspacePath } else { "/home/node/.openclaw/workspace" }

    return @(
        "",
        "## Shared Project Access",
        "- Your private home workspace is ``$resolvedWorkspacePath``.",
        "- A shared collaboration workspace also exists at ``$SharedWorkspacePath``.",
        "- Use your private workspace for agent-specific notes, drafts, and scratch files.",
        "- Use the shared workspace for collaborative repos, code, durable project notes, and handoff artifacts.",
        "- When you need to work in the shared project area, use exact absolute paths there and set exec ``workdir`` to ``$SharedWorkspacePath`` explicitly."
    )
}

function Get-EffectiveRolePolicyLines {
    param(
        $RolePolicies,
        [string]$PolicyKey,
        [string]$WorkspacePath,
        [string]$SharedWorkspacePath,
        [switch]$IncludeSharedWorkspaceAccess
    )

    $lines = @(Get-RolePolicyLines -RolePolicies $RolePolicies -Key $PolicyKey)
    $lines = @(Expand-PolicyTemplateLines -Lines $lines -WorkspacePath $WorkspacePath -SharedWorkspacePath $SharedWorkspacePath)

    if ($IncludeSharedWorkspaceAccess) {
        $lines += @(Get-SharedWorkspaceAccessLines -WorkspacePath $WorkspacePath -SharedWorkspacePath $SharedWorkspacePath)
    }

    return @($lines)
}

function Get-ManagedAgentConfigRecord {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        [Parameter(Mandatory = $true)][string]$StrongAgentId,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    switch ($AgentId) {
        $StrongAgentId {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.strongAgent
                DefaultPolicyKey  = "strongAgent"
            }
        }
        { $MultiConfig.researchAgent -and $_ -eq [string]$MultiConfig.researchAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.researchAgent
                DefaultPolicyKey  = "researchAgent"
            }
        }
        { $MultiConfig.localChatAgent -and $_ -eq [string]$MultiConfig.localChatAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.localChatAgent
                DefaultPolicyKey  = "localChatAgent"
            }
        }
        { $MultiConfig.hostedTelegramAgent -and $_ -eq [string]$MultiConfig.hostedTelegramAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.hostedTelegramAgent
                DefaultPolicyKey  = "hostedTelegramAgent"
            }
        }
        { $MultiConfig.localReviewAgent -and $_ -eq [string]$MultiConfig.localReviewAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.localReviewAgent
                DefaultPolicyKey  = "localReviewAgent"
            }
        }
        { $MultiConfig.localCoderAgent -and $_ -eq [string]$MultiConfig.localCoderAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.localCoderAgent
                DefaultPolicyKey  = "localCoderAgent"
            }
        }
        { $MultiConfig.remoteReviewAgent -and $_ -eq [string]$MultiConfig.remoteReviewAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.remoteReviewAgent
                DefaultPolicyKey  = "remoteReviewAgent"
            }
        }
        { $MultiConfig.remoteCoderAgent -and $_ -eq [string]$MultiConfig.remoteCoderAgent.id } {
            return [pscustomobject]@{
                AgentConfig       = $MultiConfig.remoteCoderAgent
                DefaultPolicyKey  = "remoteCoderAgent"
            }
        }
    }

    return $null
}

function Merge-AgentEntry {
    param(
        [Parameter(Mandatory = $true)]$Existing,
        [Parameter(Mandatory = $true)]$Desired
    )

    $merged = [ordered]@{}

    foreach ($prop in $Existing.PSObject.Properties.Name) {
        $merged[$prop] = $Existing.$prop
    }

    foreach ($prop in $Desired.Keys) {
        $merged[$prop] = $Desired[$prop]
    }

    # Managed agent fields should be removable when the desired entry omits them.
    # This lets config toggles like subagents.enabled=false clear stale live state.
    $managedOptionalProps = @(
        "model",
        "tools",
        "sandbox",
        "subagents"
    )
    foreach ($prop in $managedOptionalProps) {
        if (($Existing.PSObject.Properties.Name -contains $prop) -and -not ($Desired.Keys -contains $prop)) {
            $merged.Remove($prop) | Out-Null
        }
    }

    return $merged
}

function Add-BindingIfMissing {
    param(
        [object[]]$Bindings = @(),
        [Parameter(Mandatory = $true)]$Binding
    )

    $items = @(@($Bindings) | Where-Object { $null -ne $_ })
    $targetJson = $Binding | ConvertTo-Json -Depth 50 -Compress
    foreach ($existing in $items) {
        if (($existing | ConvertTo-Json -Depth 50 -Compress) -eq $targetJson) {
            return $items
        }
    }

    $result = @($items)
    $result += ,$Binding
    return $result
}

function Remove-TelegramTrustedBindings {
    param(
        [object[]]$Bindings = @(),
        [string[]]$TrustedGroupIds = @(),
        [string[]]$TrustedDirectIds = @()
    )

    $result = @()
    foreach ($binding in @($Bindings)) {
        if ($null -eq $binding) {
            continue
        }

        $isManagedTelegramBinding = $false
        if ($binding.match.channel -eq "telegram" -and $null -ne $binding.match.peer) {
            if ($binding.match.peer.kind -eq "group" -and ([string]$binding.match.peer.id) -in @($TrustedGroupIds)) {
                $isManagedTelegramBinding = $true
            }
            elseif ($binding.match.peer.kind -eq "direct" -and ([string]$binding.match.peer.id) -in @($TrustedDirectIds)) {
                $isManagedTelegramBinding = $true
            }
        }

        if (-not $isManagedTelegramBinding) {
            $result += ,$binding
        }
    }

    return $result
}

function Get-OllamaAvailableModelRefs {
    param([Parameter(Mandatory = $true)]$Config)

    $refs = @()
    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        $url = (Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint).TrimEnd("/") + "/api/tags"
        $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $url) -AllowFailure
        if ($result.ExitCode -ne 0 -or -not $result.Output) {
            continue
        }

        try {
            $parsed = $result.Output | ConvertFrom-Json -Depth 20
        }
        catch {
            continue
        }

        foreach ($model in @($parsed.models)) {
            if ($model.model) {
                $refs = Add-UniqueString -List $refs -Value (Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.model) -EndpointKey ([string]$endpoint.key))
            }
        }
    }

    return @($refs)
}

function Try-PullOllamaModel {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        return $false
    }

    Write-Host "Ollama model missing on endpoint $($Endpoint.key), pulling: $ModelId" -ForegroundColor Yellow
    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        $pull = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("pull", $ModelId) -AllowFailure
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }
    return $pull.ExitCode -eq 0
}

function Get-AgentOllamaEndpointKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "endpointKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.endpointKey)) {
        return [string]$AgentConfig.endpointKey
    }

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    if ($null -ne $defaultEndpoint) {
        return [string]$defaultEndpoint.key
    }

    return "local"
}

function Resolve-OllamaModelRef {
    param(
        [string]$DesiredRef,
        [Parameter(Mandatory = $true)]$Config,
        [string]$Purpose,
        [string]$EndpointKey
    )

    if ([string]::IsNullOrWhiteSpace($DesiredRef) -or (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $DesiredRef) -and -not $DesiredRef.StartsWith("ollama/"))) {
        return $DesiredRef
    }

    $endpoint = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey $EndpointKey
    $desiredResolvedRef = Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $DesiredRef -EndpointKey $EndpointKey
    $availableRefs = Get-OllamaAvailableModelRefs -Config $Config
    if ($desiredResolvedRef -in $availableRefs) {
        return $desiredResolvedRef
    }

    $desiredModelId = Get-ToolkitModelIdFromRef -ModelRef $DesiredRef
    $pulled = Try-PullOllamaModel -Endpoint $endpoint -ModelId $desiredModelId
    if ($pulled) {
        $availableRefs = Get-OllamaAvailableModelRefs -Config $Config
        if ($desiredResolvedRef -in $availableRefs) {
            return $desiredResolvedRef
        }
    }

    foreach ($model in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
        if ($model.id) {
            $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $EndpointKey
            if ($candidate -in $availableRefs) {
                Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $candidate." -ForegroundColor Yellow
                return $candidate
            }
        }
    }

    if ($availableRefs.Count -gt 0) {
        Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $($availableRefs[0])." -ForegroundColor Yellow
        return [string]$availableRefs[0]
    }

    Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable and no local Ollama fallback is present." -ForegroundColor Yellow
    return $desiredResolvedRef
}

function Get-AuthReadyHostedProviders {
    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "models", "status", "--json"
    ) -AllowFailure

    $providers = @()
    if ($result.ExitCode -eq 0 -and $result.Output) {
        try {
            $parsed = $result.Output | ConvertFrom-Json -Depth 50
            foreach ($providerEntry in @($parsed.auth.providers)) {
                if ($providerEntry.provider -and $providerEntry.provider -ne "ollama" -and $providerEntry.effective.kind -and $providerEntry.effective.kind -ne "missing") {
                    if ([string]$providerEntry.provider -notin $providers) {
                        $providers += [string]$providerEntry.provider
                    }
                }
            }
        }
        catch {
        }
    }

    return @($providers)
}

function Resolve-PreferredAgentModelRef {
    param(
        [string]$ExplicitRef,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Purpose
    )

    $modelSource = if ($AgentConfig.PSObject.Properties.Name -contains "modelSource" -and $AgentConfig.modelSource) {
        ([string]$AgentConfig.modelSource).ToLowerInvariant()
    }
    else {
        "static"
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitRef)) {
        if ($modelSource -eq "local" -and ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $ExplicitRef) -or $ExplicitRef.StartsWith("ollama/"))) {
            return (Resolve-OllamaModelRef -DesiredRef $ExplicitRef -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig))
        }
        return $ExplicitRef
    }

    $candidateRefs = @()
    foreach ($candidate in @($AgentConfig.candidateModelRefs)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
            $candidateRefs += [string]$candidate
        }
    }
    if ($AgentConfig.modelRef -and ([string]$AgentConfig.modelRef -notin $candidateRefs)) {
        $candidateRefs += [string]$AgentConfig.modelRef
    }

    if ($modelSource -eq "hosted") {
        $authReadyProviders = Get-AuthReadyHostedProviders
        foreach ($candidateRef in @($candidateRefs)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef.StartsWith("ollama/")) {
                continue
            }

            $providerId = ($candidateRef -split "/", 2)[0]
            if ($providerId -in @($authReadyProviders)) {
                return $candidateRef
            }
        }

        foreach ($candidateRef in @($candidateRefs)) {
            if (-not $candidateRef.StartsWith("ollama/")) {
                return $candidateRef
            }
        }
    }

    if ($modelSource -eq "local") {
        foreach ($candidateRef in @($candidateRefs)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef.StartsWith("ollama/")) {
                return (Resolve-OllamaModelRef -DesiredRef $candidateRef -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig))
            }
        }
    }

    foreach ($candidateRef in @($candidateRefs)) {
        return $candidateRef
    }

    return $null
}

function Get-PreferredLocalFallbackRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AvailableRefs = @()
    )

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    $defaultEndpointKey = if ($null -ne $defaultEndpoint) { [string]$defaultEndpoint.key } else { "local" }
    foreach ($model in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
        if (-not $model.id) {
            continue
        }

        $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $defaultEndpointKey
        if ($candidate -in @($AvailableRefs)) {
            return $candidate
        }
    }

    if (@($AvailableRefs).Count -gt 0) {
        return [string]$AvailableRefs[0]
    }

    return $null
}

function Resolve-AgentFallbackModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [string]$PrimaryModelRef,
        [Parameter(Mandatory = $true)][string]$Purpose
    )

    if ([string]::IsNullOrWhiteSpace($PrimaryModelRef)) {
        return @()
    }

    $availableOllamaRefs = @(Get-OllamaAvailableModelRefs -Config $Config)
    $candidateRefs = @()
    foreach ($candidateRef in @($AgentConfig.candidateModelRefs)) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$candidateRef)
    }
    if ($AgentConfig.modelRef) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$AgentConfig.modelRef)
    }

    $modelSource = if ($AgentConfig.PSObject.Properties.Name -contains "modelSource" -and $AgentConfig.modelSource) {
        ([string]$AgentConfig.modelSource).ToLowerInvariant()
    }
    else {
        "static"
    }

    $fallbacks = @()
    if ($modelSource -eq "hosted") {
        $authReadyProviders = Get-AuthReadyHostedProviders
        foreach ($candidateRef in @($candidateRefs)) {
            $candidateRefText = [string]$candidateRef
            if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                continue
            }

            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                continue
            }

            $providerId = ($candidateRefText -split "/", 2)[0]
            if ($providerId -in @($authReadyProviders) -and $candidateRefText -ne $PrimaryModelRef) {
                $fallbacks = Add-UniqueString -List $fallbacks -Value $candidateRefText
            }
        }

        if ($AgentConfig.PSObject.Properties.Name -contains "allowLocalFallback" -and [bool]$AgentConfig.allowLocalFallback) {
            foreach ($candidateRef in @($candidateRefs)) {
                $candidateRefText = [string]$candidateRef
                if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                    continue
                }

                if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                    $resolvedLocalFallback = Resolve-OllamaModelRef -DesiredRef $candidateRefText -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig)
                    if (-not [string]::IsNullOrWhiteSpace($resolvedLocalFallback) -and $resolvedLocalFallback -ne $PrimaryModelRef) {
                        $fallbacks = Add-UniqueString -List $fallbacks -Value $resolvedLocalFallback
                    }
                }
            }

            if (@($fallbacks).Count -eq 0 -or -not (@($fallbacks) | Where-Object { $_ -like "ollama*" })) {
                $preferredLocalFallback = Get-PreferredLocalFallbackRef -Config $Config -AvailableRefs $availableOllamaRefs
                if (-not [string]::IsNullOrWhiteSpace($preferredLocalFallback) -and $preferredLocalFallback -ne $PrimaryModelRef) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value $preferredLocalFallback
                }
            }
        }
    }
    elseif ($modelSource -eq "local") {
        foreach ($candidateRef in @($candidateRefs)) {
            $candidateRefText = [string]$candidateRef
            if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                continue
            }

            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                $resolvedLocalFallback = Resolve-OllamaModelRef -DesiredRef $candidateRefText -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig)
                if (-not [string]::IsNullOrWhiteSpace($resolvedLocalFallback) -and $resolvedLocalFallback -ne $PrimaryModelRef) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value $resolvedLocalFallback
                }
            }
        }
    }

    return @($fallbacks)
}

function Wait-ForGateway {
    param([string]$HealthUrl = "http://127.0.0.1:18789/healthz")

    for ($i = 0; $i -lt 20; $i++) {
        $health = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $HealthUrl) -AllowFailure
        if ($health.ExitCode -eq 0 -and $health.Output -match '"ok"\s*:\s*true') {
            return
        }
        Start-Sleep -Seconds 2
    }

    throw "Gateway did not become healthy after restart."
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$multi = $config.multiAgent
$rolePolicies = if ($multi -and $multi.PSObject.Properties.Name -contains "rolePolicies") { $multi.rolePolicies } else { $null }

if ($null -eq $multi -or -not $multi.enabled) {
    Write-Host "Multi-agent starter layout is disabled in openclaw-bootstrap.config.json." -ForegroundColor Yellow
    exit 0
}

Write-Step "Configuring starter multi-agent layout"

$currentAgents = @()
$existingAgentsRaw = Get-OpenClawConfigJsonValue -Path "agents.list"
if ($existingAgentsRaw) {
    $currentAgents = @($existingAgentsRaw)
}

$currentBindings = @()
$existingBindingsRaw = Get-OpenClawConfigJsonValue -Path "bindings"
if ($existingBindingsRaw) {
    $currentBindings = @($existingBindingsRaw)
}

$desiredAgents = @()
$strongId = [string]$multi.strongAgent.id
$strongName = if ($multi.strongAgent.name) { [string]$multi.strongAgent.name } else { "Strong Coder" }
$resolvedStrongModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $StrongModelRef -AgentConfig $multi.strongAgent -Config $config -Purpose $strongId
$resolvedStrongFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.strongAgent -PrimaryModelRef $resolvedStrongModelRef -Purpose $strongId
$strongWorkspace = Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.strongAgent
$strongSandbox = $null
$strongSubagents = Get-AgentSubagentPolicy -AgentConfig $multi.strongAgent
if ($multi.strongAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.strongAgent.sandboxMode) {
    $strongSandbox = [ordered]@{
        mode = [string]$multi.strongAgent.sandboxMode
    }
}
$desiredAgents += (New-AgentEntry -Id $strongId -Name $strongName -Workspace $strongWorkspace -ModelRef $resolvedStrongModelRef -FallbackRefs $resolvedStrongFallbackRefs -IsDefault ([bool]$multi.strongAgent.default) -Sandbox $strongSandbox -Subagents $strongSubagents)

if ($multi.researchAgent -and $multi.researchAgent.enabled) {
    $researchTools = $null
    if ($config.toolPolicy -and (($config.toolPolicy.PSObject.Properties.Name -contains "researchAllow") -or ($config.toolPolicy.PSObject.Properties.Name -contains "researchAlsoAllow") -or ($config.toolPolicy.PSObject.Properties.Name -contains "researchDeny"))) {
        $researchTools = [ordered]@{}
        if ($config.toolPolicy.PSObject.Properties.Name -contains "researchAlsoAllow") {
            $researchTools.alsoAllow = @($config.toolPolicy.researchAlsoAllow)
        }
        if ($config.toolPolicy.PSObject.Properties.Name -contains "researchAllow") {
            $researchTools.alsoAllow = @($config.toolPolicy.researchAllow)
        }
        if ($config.toolPolicy.PSObject.Properties.Name -contains "researchDeny") {
            $researchTools.deny = @($config.toolPolicy.researchDeny)
        }
    }

    $resolvedResearchModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $ResearchModelRef -AgentConfig $multi.researchAgent -Config $config -Purpose ([string]$multi.researchAgent.id)
    $resolvedResearchFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.researchAgent -PrimaryModelRef $resolvedResearchModelRef -Purpose ([string]$multi.researchAgent.id)

    $desiredAgents += (New-AgentEntry -Id ([string]$multi.researchAgent.id) -Name ([string]$multi.researchAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.researchAgent) -ModelRef $resolvedResearchModelRef -FallbackRefs $resolvedResearchFallbackRefs -Tools $researchTools -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.researchAgent))
}

$chatAgentId = $null
if ($multi.localChatAgent.enabled) {
    $chatAgentId = [string]$multi.localChatAgent.id
    $resolvedChatModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $LocalChatModelRef -AgentConfig $multi.localChatAgent -Config $config -Purpose ([string]$multi.localChatAgent.id)
    $resolvedChatFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.localChatAgent -PrimaryModelRef $resolvedChatModelRef -Purpose ([string]$multi.localChatAgent.id)
    $chatSandbox = $null
    if ($multi.localChatAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localChatAgent.sandboxMode) {
        $chatSandbox = [ordered]@{
            mode = [string]$multi.localChatAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id $chatAgentId -Name ([string]$multi.localChatAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localChatAgent) -ModelRef $resolvedChatModelRef -FallbackRefs $resolvedChatFallbackRefs -Sandbox $chatSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localChatAgent))
}

if ($multi.localReviewAgent.enabled) {
    $reviewTools = [ordered]@{
        alsoAllow = @(
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status"
        )
        deny  = @(
            "exec",
            "write",
            "edit",
            "browser",
            "canvas",
            "nodes",
            "cron"
        )
    }

    $resolvedReviewModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $LocalReviewModelRef -AgentConfig $multi.localReviewAgent -Config $config -Purpose ([string]$multi.localReviewAgent.id)
    $resolvedReviewFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.localReviewAgent -PrimaryModelRef $resolvedReviewModelRef -Purpose ([string]$multi.localReviewAgent.id)
    $reviewSandbox = $null
    if ($multi.localReviewAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localReviewAgent.sandboxMode) {
        $reviewSandbox = [ordered]@{
            mode = [string]$multi.localReviewAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.localReviewAgent.id) -Name ([string]$multi.localReviewAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localReviewAgent) -ModelRef $resolvedReviewModelRef -FallbackRefs $resolvedReviewFallbackRefs -Tools $reviewTools -Sandbox $reviewSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localReviewAgent))
}

if ($multi.hostedTelegramAgent -and $multi.hostedTelegramAgent.enabled) {
    $resolvedHostedChatModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $HostedTelegramModelRef -AgentConfig $multi.hostedTelegramAgent -Config $config -Purpose ([string]$multi.hostedTelegramAgent.id)
    $resolvedHostedChatFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.hostedTelegramAgent -PrimaryModelRef $resolvedHostedChatModelRef -Purpose ([string]$multi.hostedTelegramAgent.id)
    $hostedTelegramSandbox = $null
    if ($multi.hostedTelegramAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.hostedTelegramAgent.sandboxMode) {
        $hostedTelegramSandbox = [ordered]@{
            mode = [string]$multi.hostedTelegramAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.hostedTelegramAgent.id) -Name ([string]$multi.hostedTelegramAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.hostedTelegramAgent) -ModelRef $resolvedHostedChatModelRef -FallbackRefs $resolvedHostedChatFallbackRefs -Sandbox $hostedTelegramSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.hostedTelegramAgent))
}

if ($multi.localCoderAgent -and $multi.localCoderAgent.enabled) {
    $coderTools = [ordered]@{
        alsoAllow = @(
            "read",
            "write",
            "edit",
            "exec",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status"
        )
        deny  = @(
            "browser",
            "canvas",
            "nodes",
            "cron"
        )
    }

    $resolvedCoderModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $LocalCoderModelRef -AgentConfig $multi.localCoderAgent -Config $config -Purpose ([string]$multi.localCoderAgent.id)
    $resolvedCoderFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.localCoderAgent -PrimaryModelRef $resolvedCoderModelRef -Purpose ([string]$multi.localCoderAgent.id)
    $coderSandbox = $null
    if ($multi.localCoderAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localCoderAgent.sandboxMode) {
        $coderSandbox = [ordered]@{
            mode = [string]$multi.localCoderAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.localCoderAgent.id) -Name ([string]$multi.localCoderAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localCoderAgent) -ModelRef $resolvedCoderModelRef -FallbackRefs $resolvedCoderFallbackRefs -Tools $coderTools -Sandbox $coderSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localCoderAgent))
}

if ($multi.remoteReviewAgent -and $multi.remoteReviewAgent.enabled) {
    $remoteReviewTools = [ordered]@{
        alsoAllow = @(
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status"
        )
        deny  = @(
            "exec",
            "write",
            "edit",
            "browser",
            "canvas",
            "nodes",
            "cron"
        )
    }

    $resolvedRemoteReviewModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $RemoteReviewModelRef -AgentConfig $multi.remoteReviewAgent -Config $config -Purpose ([string]$multi.remoteReviewAgent.id)
    $resolvedRemoteReviewFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.remoteReviewAgent -PrimaryModelRef $resolvedRemoteReviewModelRef -Purpose ([string]$multi.remoteReviewAgent.id)
    $remoteReviewSandbox = $null
    if ($multi.remoteReviewAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.remoteReviewAgent.sandboxMode) {
        $remoteReviewSandbox = [ordered]@{
            mode = [string]$multi.remoteReviewAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.remoteReviewAgent.id) -Name ([string]$multi.remoteReviewAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.remoteReviewAgent) -ModelRef $resolvedRemoteReviewModelRef -FallbackRefs $resolvedRemoteReviewFallbackRefs -Tools $remoteReviewTools -Sandbox $remoteReviewSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.remoteReviewAgent))
}

if ($multi.remoteCoderAgent -and $multi.remoteCoderAgent.enabled) {
    $remoteCoderTools = [ordered]@{
        alsoAllow = @(
            "read",
            "write",
            "edit",
            "exec",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status"
        )
        deny  = @(
            "browser",
            "canvas",
            "nodes",
            "cron"
        )
    }

    $resolvedRemoteCoderModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $RemoteCoderModelRef -AgentConfig $multi.remoteCoderAgent -Config $config -Purpose ([string]$multi.remoteCoderAgent.id)
    $resolvedRemoteCoderFallbackRefs = Resolve-AgentFallbackModelRefs -Config $config -AgentConfig $multi.remoteCoderAgent -PrimaryModelRef $resolvedRemoteCoderModelRef -Purpose ([string]$multi.remoteCoderAgent.id)
    $remoteCoderSandbox = $null
    if ($multi.remoteCoderAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.remoteCoderAgent.sandboxMode) {
        $remoteCoderSandbox = [ordered]@{
            mode = [string]$multi.remoteCoderAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.remoteCoderAgent.id) -Name ([string]$multi.remoteCoderAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.remoteCoderAgent) -ModelRef $resolvedRemoteCoderModelRef -FallbackRefs $resolvedRemoteCoderFallbackRefs -Tools $remoteCoderTools -Sandbox $remoteCoderSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.remoteCoderAgent))
}

$mergedAgents = @()
foreach ($desired in $desiredAgents) {
    $existing = $currentAgents | Where-Object { $_.id -eq $desired.id } | Select-Object -First 1
    if ($null -ne $existing) {
        $mergedAgents += (Merge-AgentEntry -Existing $existing -Desired $desired)
    }
    else {
        $mergedAgents += $desired
    }
}

foreach ($existing in $currentAgents) {
    if (-not (@($mergedAgents) | Where-Object { $_.id -eq $existing.id })) {
        $mergedAgents += $existing
    }
}

$telegramRouteTargetAgentId = $null
$routeTrustedTelegramGroups = $false
$routeTrustedTelegramDms = $false
if ($multi.telegramRouting) {
    if ($multi.telegramRouting.targetAgentId) {
        $telegramRouteTargetAgentId = [string]$multi.telegramRouting.targetAgentId
    }
    if ($null -ne $multi.telegramRouting.routeTrustedTelegramGroups) {
        $routeTrustedTelegramGroups = [bool]$multi.telegramRouting.routeTrustedTelegramGroups
    }
    if ($null -ne $multi.telegramRouting.routeTrustedTelegramDms) {
        $routeTrustedTelegramDms = [bool]$multi.telegramRouting.routeTrustedTelegramDms
    }
}
elseif ($chatAgentId) {
    $telegramRouteTargetAgentId = $chatAgentId
    $routeTrustedTelegramGroups = [bool]$multi.localChatAgent.routeTrustedTelegramGroups
    $routeTrustedTelegramDms = [bool]$multi.localChatAgent.routeTrustedTelegramDms
}

if ($telegramRouteTargetAgentId) {
    $telegramConfig = Get-OpenClawConfigJsonValue -Path "channels.telegram"
    if ($null -ne $telegramConfig) {
        $trustedGroupIds = @($telegramConfig.groups.PSObject.Properties.Name | ForEach-Object { [string]$_ })
        $trustedDirectIds = @($telegramConfig.allowFrom | ForEach-Object { [string]$_ })

        $currentBindings = @(Remove-TelegramTrustedBindings -Bindings $currentBindings -TrustedGroupIds $trustedGroupIds -TrustedDirectIds $trustedDirectIds)

        if ($routeTrustedTelegramGroups) {
            foreach ($groupId in @($telegramConfig.groups.PSObject.Properties.Name)) {
                $binding = [ordered]@{
                    agentId = $telegramRouteTargetAgentId
                    match   = [ordered]@{
                        channel = "telegram"
                        peer    = [ordered]@{
                            kind = "group"
                            id   = [string]$groupId
                        }
                    }
                }
                $currentBindings = Add-BindingIfMissing -Bindings $currentBindings -Binding $binding
            }
        }

        if ($routeTrustedTelegramDms) {
            foreach ($senderId in @($telegramConfig.allowFrom)) {
                $binding = [ordered]@{
                    agentId = $telegramRouteTargetAgentId
                    match   = [ordered]@{
                        channel = "telegram"
                        peer    = [ordered]@{
                            kind = "direct"
                            id   = [string]$senderId
                        }
                    }
                }
                $currentBindings = Add-BindingIfMissing -Bindings $currentBindings -Binding $binding
            }
        }
    }
}

Set-OpenClawConfigJson -Path "agents.list" -Value @($mergedAgents) -AsArray

$managedOptionalAgentProps = @(
    "model",
    "tools",
    "sandbox",
    "subagents"
)

for ($index = 0; $index -lt @($desiredAgents).Count; $index++) {
    $desiredAgent = $desiredAgents[$index]
    $existingAgent = $currentAgents | Where-Object { $_.id -eq $desiredAgent.id } | Select-Object -First 1
    if ($null -eq $existingAgent) {
        continue
    }

    foreach ($prop in $managedOptionalAgentProps) {
        $desiredHasProp = $desiredAgent.Keys -contains $prop
        $existingHasProp = $existingAgent.PSObject.Properties.Name -contains $prop
        if ($existingHasProp -and -not $desiredHasProp) {
            Remove-OpenClawConfigJson -Path ("agents.list.{0}.{1}" -f $index, $prop)
        }
    }
}

if (@($currentBindings).Count -gt 0) {
    Set-OpenClawConfigJson -Path "bindings" -Value @($currentBindings) -AsArray
}

if ($multi.enableAgentToAgent) {
    $allow = @()
    foreach ($agent in @($mergedAgents)) {
        $allow = Add-UniqueString -List $allow -Value ([string]$agent.id)
    }
    $agentToAgent = [ordered]@{
        enabled = $true
        allow   = @($allow)
    }
    Set-OpenClawConfigJson -Path "tools.agentToAgent" -Value $agentToAgent
}

$managedAgentsFiles = @()
if ($multi.manageWorkspaceAgentsMd) {
    $overlayDirName = "bootstrap"
    if ($config.PSObject.Properties.Name -contains "managedHooks" -and
        $config.managedHooks -and
        $config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
        $config.managedHooks.agentBootstrapOverlays -and
        $config.managedHooks.agentBootstrapOverlays.PSObject.Properties.Name -contains "overlayDirName" -and
        $config.managedHooks.agentBootstrapOverlays.overlayDirName) {
        $overlayDirName = [string]$config.managedHooks.agentBootstrapOverlays.overlayDirName
    }

    $sharedWorkspacePath = Get-SharedWorkspacePath -MultiConfig $multi
    if ($sharedWorkspacePath) {
        $sharedPolicyKey = "sharedWorkspace"
        if ($multi.sharedWorkspace -and
            $multi.sharedWorkspace.PSObject.Properties.Name -contains "rolePolicyKey" -and
            -not [string]::IsNullOrWhiteSpace([string]$multi.sharedWorkspace.rolePolicyKey)) {
            $sharedPolicyKey = [string]$multi.sharedWorkspace.rolePolicyKey
        }

        $sharedAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath $sharedWorkspacePath -ContentLines (Get-EffectiveRolePolicyLines -RolePolicies $rolePolicies -PolicyKey $sharedPolicyKey -WorkspacePath $sharedWorkspacePath -SharedWorkspacePath $sharedWorkspacePath)
        if ($sharedAgentsPath) { $managedAgentsFiles += $sharedAgentsPath }
    }

    foreach ($desiredAgent in @($desiredAgents)) {
        $agentRecord = Get-ManagedAgentConfigRecord -MultiConfig $multi -StrongAgentId $strongId -AgentId ([string]$desiredAgent.id)
        if ($null -eq $agentRecord -or $null -eq $agentRecord.AgentConfig) {
            continue
        }

        $agentConfig = $agentRecord.AgentConfig
        $effectiveWorkspacePath = if ($desiredAgent.PSObject.Properties.Name -contains "workspace" -and $desiredAgent.workspace) {
            [string]$desiredAgent.workspace
        }
        else {
            Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $agentConfig
        }
        $policyKey = Get-AgentRolePolicyKey -AgentConfig $agentConfig -DefaultKey ([string]$agentRecord.DefaultPolicyKey)
        $agentPolicyLines = Get-EffectiveRolePolicyLines -RolePolicies $rolePolicies -PolicyKey $policyKey -WorkspacePath $effectiveWorkspacePath -SharedWorkspacePath $sharedWorkspacePath -IncludeSharedWorkspaceAccess:(Test-AgentCanAccessSharedWorkspace -MultiConfig $multi -AgentConfig $agentConfig)

        if ($sharedWorkspacePath -and (Test-AgentUsesSharedWorkspace -MultiConfig $multi -AgentConfig $agentConfig)) {
            $overlayAgentsPath = Ensure-AgentBootstrapOverlayFile -Config $config -AgentId ([string]$desiredAgent.id) -FileName "AGENTS.md" -OverlayDirName $overlayDirName -ContentLines $agentPolicyLines
            if ($overlayAgentsPath) { $managedAgentsFiles += $overlayAgentsPath }
        }
        else {
            $staleOverlayPath = Join-Path (Get-AgentBootstrapOverlayDir -Config $config -AgentId ([string]$desiredAgent.id) -OverlayDirName $overlayDirName) "AGENTS.md"
            Remove-ManagedTextFileIfPresent -Path $staleOverlayPath
            $workspaceAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath $effectiveWorkspacePath -ContentLines $agentPolicyLines
            if ($workspaceAgentsPath) { $managedAgentsFiles += $workspaceAgentsPath }
        }
    }
}

Write-Host "Configured agents:" -ForegroundColor Green
@($mergedAgents) | ForEach-Object {
    $model = if ($_.model.primary) { [string]$_.model.primary } else { "(inherits default)" }
    Write-Host "- $($_.id): $model"
}
if (@($managedAgentsFiles).Count -gt 0) {
    Write-Host "Managed bootstrap prompt files:" -ForegroundColor Green
    foreach ($managedFile in @($managedAgentsFiles)) {
        Write-Host "- $managedFile"
    }
}

if (-not $NoRestart) {
    Write-Step "Restarting gateway for multi-agent changes"
    $null = Invoke-External -FilePath "docker" -Arguments @(
        "compose", "-f", (Join-Path $config.repoPath "docker-compose.yml"),
        "restart", "openclaw-gateway"
    )
    Wait-ForGateway
}
