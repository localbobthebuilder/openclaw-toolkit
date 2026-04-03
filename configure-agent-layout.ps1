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
            fallbacks = @()
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

function Get-AgentWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$MultiConfig,
        $AgentConfig
    )

    $sharedWorkspacePath = Get-SharedWorkspacePath -MultiConfig $MultiConfig
    if ($sharedWorkspacePath) {
        return $sharedWorkspacePath
    }

    if ($null -ne $AgentConfig -and $AgentConfig.PSObject.Properties.Name -contains "workspace" -and $AgentConfig.workspace) {
        return [string]$AgentConfig.workspace
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
        $url = ([string]$endpoint.baseUrl).TrimEnd("/") + "/api/tags"
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
        $env:OLLAMA_HOST = [string]$Endpoint.baseUrl
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
$strongWorkspace = Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.strongAgent
$strongSandbox = $null
$strongSubagents = Get-AgentSubagentPolicy -AgentConfig $multi.strongAgent
if ($multi.strongAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.strongAgent.sandboxMode) {
    $strongSandbox = [ordered]@{
        mode = [string]$multi.strongAgent.sandboxMode
    }
}
$desiredAgents += (New-AgentEntry -Id $strongId -Name $strongName -Workspace $strongWorkspace -ModelRef $resolvedStrongModelRef -IsDefault ([bool]$multi.strongAgent.default) -Sandbox $strongSandbox -Subagents $strongSubagents)

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

    $desiredAgents += (New-AgentEntry -Id ([string]$multi.researchAgent.id) -Name ([string]$multi.researchAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.researchAgent) -ModelRef $resolvedResearchModelRef -Tools $researchTools -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.researchAgent))
}

$chatAgentId = $null
if ($multi.localChatAgent.enabled) {
    $chatAgentId = [string]$multi.localChatAgent.id
    $resolvedChatModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $LocalChatModelRef -AgentConfig $multi.localChatAgent -Config $config -Purpose ([string]$multi.localChatAgent.id)
    $chatSandbox = $null
    if ($multi.localChatAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localChatAgent.sandboxMode) {
        $chatSandbox = [ordered]@{
            mode = [string]$multi.localChatAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id $chatAgentId -Name ([string]$multi.localChatAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localChatAgent) -ModelRef $resolvedChatModelRef -Sandbox $chatSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localChatAgent))
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
    $reviewSandbox = $null
    if ($multi.localReviewAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localReviewAgent.sandboxMode) {
        $reviewSandbox = [ordered]@{
            mode = [string]$multi.localReviewAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.localReviewAgent.id) -Name ([string]$multi.localReviewAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localReviewAgent) -ModelRef $resolvedReviewModelRef -Tools $reviewTools -Sandbox $reviewSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localReviewAgent))
}

if ($multi.hostedTelegramAgent -and $multi.hostedTelegramAgent.enabled) {
    $resolvedHostedChatModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $HostedTelegramModelRef -AgentConfig $multi.hostedTelegramAgent -Config $config -Purpose ([string]$multi.hostedTelegramAgent.id)
    $hostedTelegramSandbox = $null
    if ($multi.hostedTelegramAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.hostedTelegramAgent.sandboxMode) {
        $hostedTelegramSandbox = [ordered]@{
            mode = [string]$multi.hostedTelegramAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.hostedTelegramAgent.id) -Name ([string]$multi.hostedTelegramAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.hostedTelegramAgent) -ModelRef $resolvedHostedChatModelRef -Sandbox $hostedTelegramSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.hostedTelegramAgent))
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
    $coderSandbox = $null
    if ($multi.localCoderAgent.PSObject.Properties.Name -contains "sandboxMode" -and $multi.localCoderAgent.sandboxMode) {
        $coderSandbox = [ordered]@{
            mode = [string]$multi.localCoderAgent.sandboxMode
        }
    }
    $desiredAgents += (New-AgentEntry -Id ([string]$multi.localCoderAgent.id) -Name ([string]$multi.localCoderAgent.name) -Workspace (Get-AgentWorkspacePath -MultiConfig $multi -AgentConfig $multi.localCoderAgent) -ModelRef $resolvedCoderModelRef -Tools $coderTools -Sandbox $coderSandbox -Subagents (Get-AgentSubagentPolicy -AgentConfig $multi.localCoderAgent))
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

        $sharedAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath $sharedWorkspacePath -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key $sharedPolicyKey)
        if ($sharedAgentsPath) { $managedAgentsFiles += $sharedAgentsPath }

        foreach ($desiredAgent in @($desiredAgents)) {
            $agentConfig = $null
            switch ([string]$desiredAgent.id) {
                $strongId { $agentConfig = $multi.strongAgent; break }
                { $_ -eq [string]$multi.researchAgent.id } { $agentConfig = $multi.researchAgent; break }
                { $multi.localChatAgent -and $_ -eq [string]$multi.localChatAgent.id } { $agentConfig = $multi.localChatAgent; break }
                { $multi.hostedTelegramAgent -and $_ -eq [string]$multi.hostedTelegramAgent.id } { $agentConfig = $multi.hostedTelegramAgent; break }
                { $multi.localReviewAgent -and $_ -eq [string]$multi.localReviewAgent.id } { $agentConfig = $multi.localReviewAgent; break }
                { $multi.localCoderAgent -and $_ -eq [string]$multi.localCoderAgent.id } { $agentConfig = $multi.localCoderAgent; break }
            }

            if ($null -eq $agentConfig) {
                continue
            }

            $overlayAgentsPath = Ensure-AgentBootstrapOverlayFile -Config $config -AgentId ([string]$desiredAgent.id) -FileName "AGENTS.md" -OverlayDirName $overlayDirName -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $agentConfig -DefaultKey ([string]$desiredAgent.id)))
            if ($overlayAgentsPath) { $managedAgentsFiles += $overlayAgentsPath }
        }
    }
    else {
        $mainAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath $null -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.strongAgent -DefaultKey "strongAgent"))
        if ($mainAgentsPath) { $managedAgentsFiles += $mainAgentsPath }

        if ($multi.researchAgent -and $multi.researchAgent.enabled) {
            $researchAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath ([string]$multi.researchAgent.workspace) -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.researchAgent -DefaultKey "researchAgent"))
            if ($researchAgentsPath) { $managedAgentsFiles += $researchAgentsPath }
        }

        if ($multi.localChatAgent -and $multi.localChatAgent.enabled) {
            $chatAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath ([string]$multi.localChatAgent.workspace) -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.localChatAgent -DefaultKey "localChatAgent"))
            if ($chatAgentsPath) { $managedAgentsFiles += $chatAgentsPath }
        }

        if ($multi.hostedTelegramAgent -and $multi.hostedTelegramAgent.enabled) {
            $hostedChatAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath ([string]$multi.hostedTelegramAgent.workspace) -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.hostedTelegramAgent -DefaultKey "hostedTelegramAgent"))
            if ($hostedChatAgentsPath) { $managedAgentsFiles += $hostedChatAgentsPath }
        }

        if ($multi.localReviewAgent -and $multi.localReviewAgent.enabled) {
            $reviewAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath ([string]$multi.localReviewAgent.workspace) -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.localReviewAgent -DefaultKey "localReviewAgent"))
            if ($reviewAgentsPath) { $managedAgentsFiles += $reviewAgentsPath }
        }

        if ($multi.localCoderAgent -and $multi.localCoderAgent.enabled) {
            $coderAgentsPath = Ensure-WorkspaceAgentsFile -Config $config -WorkspacePath ([string]$multi.localCoderAgent.workspace) -ContentLines (Get-RolePolicyLines -RolePolicies $rolePolicies -Key (Get-AgentRolePolicyKey -AgentConfig $multi.localCoderAgent -DefaultKey "localCoderAgent"))
            if ($coderAgentsPath) { $managedAgentsFiles += $coderAgentsPath }
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
