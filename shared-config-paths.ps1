function Resolve-ConfigPathValue {
    param(
        [string]$Value,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ($Value -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return $Value
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $Value))
}

function ConvertTo-ToolkitBooleanValue {
    param(
        $Value,
        [bool]$DefaultValue = $false
    )

    if ($null -eq $Value) {
        return $DefaultValue
    }

    if ($Value -is [bool]) {
        return $Value
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $DefaultValue
    }

    switch ($text.Trim().ToLowerInvariant()) {
        "true" { return $true }
        "1" { return $true }
        "yes" { return $true }
        "on" { return $true }
        "false" { return $false }
        "0" { return $false }
        "no" { return $false }
        "off" { return $false }
        default { return [bool]$Value }
    }
}

function Set-ToolkitBooleanDefaultProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$PropertyName,
        [Parameter(Mandatory = $true)][bool]$DefaultValue
    )

    if ($Object.PSObject.Properties.Name -contains $PropertyName) {
        $Object.$PropertyName = ConvertTo-ToolkitBooleanValue -Value $Object.$PropertyName -DefaultValue $DefaultValue
    }
    else {
        Add-Member -InputObject $Object -NotePropertyName $PropertyName -NotePropertyValue $DefaultValue -Force
    }
}

function Set-ToolkitArrayDefaultProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )

    if ($Object.PSObject.Properties.Name -contains $PropertyName) {
        if ($null -eq $Object.$PropertyName) {
            $Object.$PropertyName = @()
        }
        else {
            $Object.$PropertyName = @($Object.$PropertyName)
        }
    }
    else {
        Add-Member -InputObject $Object -NotePropertyName $PropertyName -NotePropertyValue @() -Force
    }
}

function Normalize-ToolkitAgentConfig {
    param([Parameter(Mandatory = $true)]$AgentConfig)

    if ($null -eq $AgentConfig) {
        return $null
    }

    Set-ToolkitBooleanDefaultProperty -Object $AgentConfig -PropertyName "enabled" -DefaultValue $true

    if (-not ($AgentConfig.PSObject.Properties.Name -contains "subagents") -or $null -eq $AgentConfig.subagents) {
        Add-Member -InputObject $AgentConfig -NotePropertyName "subagents" -NotePropertyValue ([pscustomobject][ordered]@{
                enabled        = $true
                requireAgentId = $true
                allowAgents    = @()
            }) -Force
    }
    else {
        Set-ToolkitBooleanDefaultProperty -Object $AgentConfig.subagents -PropertyName "enabled" -DefaultValue $true
        Set-ToolkitBooleanDefaultProperty -Object $AgentConfig.subagents -PropertyName "requireAgentId" -DefaultValue $true
        Set-ToolkitArrayDefaultProperty -Object $AgentConfig.subagents -PropertyName "allowAgents"
    }

    return $AgentConfig
}

function Normalize-ToolkitConfigDefaults {
    param([Parameter(Mandatory = $true)]$Config)

    if ($null -eq $Config) {
        return $Config
    }

    if ($Config.PSObject.Properties.Name -contains "skills" -and $null -ne $Config.skills) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.skills -PropertyName "enableAll" -DefaultValue $true
    }

    if ($Config.PSObject.Properties.Name -contains "voiceNotes" -and $null -ne $Config.voiceNotes) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.voiceNotes -PropertyName "enabled" -DefaultValue $true
    }

    if ($Config.PSObject.Properties.Name -contains "ollama" -and $null -ne $Config.ollama) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.ollama -PropertyName "enabled" -DefaultValue $true
    }

    if ($Config.PSObject.Properties.Name -contains "sandbox" -and $null -ne $Config.sandbox) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.sandbox -PropertyName "enabled" -DefaultValue $true
    }

    if ($Config.PSObject.Properties.Name -contains "managedHooks" -and
        $null -ne $Config.managedHooks -and
        $Config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
        $null -ne $Config.managedHooks.agentBootstrapOverlays) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.managedHooks.agentBootstrapOverlays -PropertyName "enabled" -DefaultValue $true
    }

    if ($Config.PSObject.Properties.Name -contains "telegram" -and $null -ne $Config.telegram) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.telegram -PropertyName "enabled" -DefaultValue $true
        if ($Config.telegram.PSObject.Properties.Name -contains "execApprovals" -and $null -ne $Config.telegram.execApprovals) {
            Set-ToolkitBooleanDefaultProperty -Object $Config.telegram.execApprovals -PropertyName "enabled" -DefaultValue $false
            Set-ToolkitArrayDefaultProperty -Object $Config.telegram.execApprovals -PropertyName "approvers"
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "groups" -and $null -ne $Config.telegram.groups) {
            foreach ($group in @($Config.telegram.groups)) {
                if ($null -eq $group) {
                    continue
                }

                Set-ToolkitBooleanDefaultProperty -Object $group -PropertyName "enabled" -DefaultValue $true
                Set-ToolkitBooleanDefaultProperty -Object $group -PropertyName "requireMention" -DefaultValue $true
                Set-ToolkitArrayDefaultProperty -Object $group -PropertyName "allowFrom"
            }
        }
    }

    if ($Config.PSObject.Properties.Name -contains "endpoints" -and $null -ne $Config.endpoints) {
        foreach ($endpoint in @($Config.endpoints)) {
            if ($null -eq $endpoint) {
                continue
            }

            Set-ToolkitBooleanDefaultProperty -Object $endpoint -PropertyName "default" -DefaultValue $false
            $hasRuntime = ($endpoint.PSObject.Properties.Name -contains "ollama" -and $null -ne $endpoint.ollama) -or
                ($endpoint.PSObject.Properties.Name -contains "baseUrl" -and $endpoint.baseUrl) -or
                ($endpoint.PSObject.Properties.Name -contains "hostBaseUrl" -and $endpoint.hostBaseUrl) -or
                ($endpoint.PSObject.Properties.Name -contains "providerId" -and $endpoint.providerId) -or
                ($endpoint.PSObject.Properties.Name -contains "models" -and $null -ne $endpoint.models) -or
                ($endpoint.PSObject.Properties.Name -contains "modelOverrides" -and $null -ne $endpoint.modelOverrides) -or
                ($endpoint.PSObject.Properties.Name -contains "desiredModelIds" -and $null -ne $endpoint.desiredModelIds)
            if ($hasRuntime) {
                $runtime = if ($endpoint.PSObject.Properties.Name -contains "ollama" -and $null -ne $endpoint.ollama) {
                    $endpoint.ollama
                }
                else {
                    $endpoint
                }

                Set-ToolkitBooleanDefaultProperty -Object $runtime -PropertyName "enabled" -DefaultValue $true
                Set-ToolkitBooleanDefaultProperty -Object $runtime -PropertyName "autoPullMissingModels" -DefaultValue $true
            }
        }
    }

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent) {
            continue
        }

        Normalize-ToolkitAgentConfig -AgentConfig $agent | Out-Null
    }

    if ($Config.PSObject.Properties.Name -contains "workspaces" -and $null -ne $Config.workspaces) {
        foreach ($workspace in @($Config.workspaces)) {
            if ($null -eq $workspace) {
                continue
            }

            Set-ToolkitBooleanDefaultProperty -Object $workspace -PropertyName "enableAgentToAgent" -DefaultValue $false
            Set-ToolkitBooleanDefaultProperty -Object $workspace -PropertyName "manageWorkspaceAgentsMd" -DefaultValue $false
            Set-ToolkitArrayDefaultProperty -Object $workspace -PropertyName "agents"
            if ([string]$workspace.mode -eq "private") {
                Set-ToolkitBooleanDefaultProperty -Object $workspace -PropertyName "allowSharedWorkspaceAccess" -DefaultValue $false
            }
        }
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and $null -ne $Config.multiAgent) {
        Set-ToolkitBooleanDefaultProperty -Object $Config.multiAgent -PropertyName "enableAgentToAgent" -DefaultValue $false
        Set-ToolkitBooleanDefaultProperty -Object $Config.multiAgent -PropertyName "manageWorkspaceAgentsMd" -DefaultValue $false
        if ($Config.multiAgent.PSObject.Properties.Name -contains "sharedWorkspace" -and $null -ne $Config.multiAgent.sharedWorkspace) {
            Set-ToolkitBooleanDefaultProperty -Object $Config.multiAgent.sharedWorkspace -PropertyName "enabled" -DefaultValue $true
        }
        foreach ($legacyKey in @("strongAgent", "researchAgent", "localChatAgent", "hostedTelegramAgent", "localReviewAgent", "localCoderAgent", "remoteReviewAgent", "remoteCoderAgent")) {
            if ($Config.multiAgent.PSObject.Properties.Name -contains $legacyKey -and $null -ne $Config.multiAgent.$legacyKey) {
                Normalize-ToolkitAgentConfig -AgentConfig $Config.multiAgent.$legacyKey | Out-Null
            }
        }
        foreach ($extraAgent in @($Config.multiAgent.extraAgents)) {
            if ($null -ne $extraAgent) {
                Normalize-ToolkitAgentConfig -AgentConfig $extraAgent | Out-Null
            }
        }
    }

    return $Config
}

function Resolve-PortableConfigPaths {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    $Config = Normalize-ToolkitConfigDefaults -Config $Config

    foreach ($propertyName in @("repoPath", "composeFilePath", "envFilePath", "envTemplatePath", "hostConfigDir", "hostWorkspaceDir")) {
        if ($Config.PSObject.Properties.Name -contains $propertyName -and $Config.$propertyName) {
            $Config.$propertyName = Resolve-ConfigPathValue -Value ([string]$Config.$propertyName) -BaseDir $BaseDir
        }
    }

    if ($Config.verification -and $Config.verification.PSObject.Properties.Name -contains "reportPath" -and $Config.verification.reportPath) {
        $Config.verification.reportPath = Resolve-ConfigPathValue -Value ([string]$Config.verification.reportPath) -BaseDir $BaseDir
    }

    return $Config
}

function Get-ToolkitAgentsContainer {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "agents" -and $null -ne $Config.agents) {
        return $Config.agents
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and $null -ne $Config.multiAgent) {
        return [pscustomobject]@{
            list            = @(Get-ToolkitAgentList -Config $Config)
            rolePolicies    = if ($Config.multiAgent.PSObject.Properties.Name -contains "rolePolicies") { $Config.multiAgent.rolePolicies } else { $null }
            telegramRouting = if ($Config.multiAgent.PSObject.Properties.Name -contains "telegramRouting") { $Config.multiAgent.telegramRouting } else { $null }
        }
    }

    return $null
}

function Get-ToolkitAgentList {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "agents" -and
        $null -ne $Config.agents -and
        $Config.agents.PSObject.Properties.Name -contains "list" -and
        $null -ne $Config.agents.list) {
        return @($Config.agents.list)
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and $null -ne $Config.multiAgent) {
        $agents = New-Object System.Collections.Generic.List[object]
        foreach ($legacyKey in @("strongAgent", "researchAgent", "localChatAgent", "hostedTelegramAgent", "localReviewAgent", "localCoderAgent", "remoteReviewAgent", "remoteCoderAgent")) {
            if ($Config.multiAgent.PSObject.Properties.Name -contains $legacyKey -and $null -ne $Config.multiAgent.$legacyKey) {
                $agent = $Config.multiAgent.$legacyKey
                if (-not ($agent.PSObject.Properties.Name -contains "key")) {
                    Add-Member -InputObject $agent -NotePropertyName "key" -NotePropertyValue $legacyKey -Force
                }
                if ($legacyKey -eq "strongAgent" -and -not ($agent.PSObject.Properties.Name -contains "isMain")) {
                    Add-Member -InputObject $agent -NotePropertyName "isMain" -NotePropertyValue $true -Force
                }
                $agents.Add($agent)
            }
        }
        foreach ($extraAgent in @($Config.multiAgent.extraAgents)) {
            if ($null -ne $extraAgent) {
                $agents.Add($extraAgent)
            }
        }
        return @($agents)
    }

    return @()
}

function Get-ToolkitAgentById {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -ne $agent -and [string]$agent.id -eq $AgentId) {
            return $agent
        }
    }

    return $null
}

function Get-ToolkitAgentByKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Key
    )

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent) {
            continue
        }

        if ($agent.PSObject.Properties.Name -contains "key" -and [string]$agent.key -eq $Key) {
            return $agent
        }
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and
        $null -ne $Config.multiAgent -and
        $Config.multiAgent.PSObject.Properties.Name -contains $Key) {
        return $Config.multiAgent.$Key
    }

    return $null
}

function Get-ToolkitRolePolicies {
    param([Parameter(Mandatory = $true)]$Config)

    $agentsContainer = Get-ToolkitAgentsContainer -Config $Config
    if ($null -ne $agentsContainer -and
        $agentsContainer.PSObject.Properties.Name -contains "rolePolicies" -and
        $null -ne $agentsContainer.rolePolicies) {
        return $agentsContainer.rolePolicies
    }

    return $null
}

function Get-ToolkitTelegramRouting {
    param([Parameter(Mandatory = $true)]$Config)

    $agentsContainer = Get-ToolkitAgentsContainer -Config $Config
    if ($null -ne $agentsContainer -and
        $agentsContainer.PSObject.Properties.Name -contains "telegramRouting" -and
        $null -ne $agentsContainer.telegramRouting) {
        return $agentsContainer.telegramRouting
    }

    return $null
}

function Get-ToolkitWorkspaceList {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "workspaces" -and $null -ne $Config.workspaces) {
        return @($Config.workspaces)
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and $null -ne $Config.multiAgent) {
        $workspaces = New-Object System.Collections.Generic.List[object]
        if ($Config.multiAgent.sharedWorkspace -and $Config.multiAgent.sharedWorkspace.enabled) {
            $sharedAgents = @()
            foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
                if ($null -eq $agent -or -not $agent.id) {
                    continue
                }

                $usesShared = $true
                if ($agent.PSObject.Properties.Name -contains "workspaceMode" -and $agent.workspaceMode) {
                    $usesShared = ([string]$agent.workspaceMode).ToLowerInvariant() -eq "shared"
                }
                if ($usesShared) {
                    $sharedAgents += [string]$agent.id
                }
            }

            $workspaces.Add([pscustomobject]@{
                    id                   = "shared"
                    name                 = "Shared Workspace"
                    mode                 = "shared"
                    path                 = if ($Config.multiAgent.sharedWorkspace.path) { [string]$Config.multiAgent.sharedWorkspace.path } else { "/home/node/.openclaw/workspace" }
                    rolePolicyKey        = if ($Config.multiAgent.sharedWorkspace.rolePolicyKey) { [string]$Config.multiAgent.sharedWorkspace.rolePolicyKey } else { "sharedWorkspace" }
                    enableAgentToAgent   = [bool]$Config.multiAgent.enableAgentToAgent
                    manageWorkspaceAgentsMd = [bool]$Config.multiAgent.manageWorkspaceAgentsMd
                    agents               = @($sharedAgents)
                })
        }

        foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
            if ($null -eq $agent -or -not $agent.id) {
                continue
            }

            $mode = if ($agent.PSObject.Properties.Name -contains "workspaceMode" -and $agent.workspaceMode) { [string]$agent.workspaceMode } else { "shared" }
            if ($mode -ne "private") {
                continue
            }

            $workspaceId = [string]$agent.id
            $workspaces.Add([pscustomobject]@{
                    id                     = $workspaceId
                    name                   = if ($agent.name) { "$([string]$agent.name) Workspace" } else { "$workspaceId Workspace" }
                    mode                   = "private"
                    path                   = if ($agent.workspace) { [string]$agent.workspace } else { "/home/node/.openclaw/workspace-$workspaceId" }
                    allowSharedWorkspaceAccess = [bool]$agent.sharedWorkspaceAccess
                    enableAgentToAgent     = [bool]$Config.multiAgent.enableAgentToAgent
                    manageWorkspaceAgentsMd = [bool]$Config.multiAgent.manageWorkspaceAgentsMd
                    agents                 = @([string]$agent.id)
                })
        }

        return @($workspaces)
    }

    return @()
}

function Get-ToolkitWorkspaceById {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$WorkspaceId
    )

    foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $Config)) {
        if ($null -ne $workspace -and [string]$workspace.id -eq $WorkspaceId) {
            return $workspace
        }
    }

    return $null
}

function Get-ToolkitWorkspaceForAgent {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $agentId = [string]$AgentConfig.id
    if ([string]::IsNullOrWhiteSpace($agentId)) {
        return $null
    }

    foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $Config)) {
        if ($null -eq $workspace) {
            continue
        }

        foreach ($memberId in @($workspace.agents)) {
            if ([string]$memberId -eq $agentId) {
                return $workspace
            }
        }
    }

    return $null
}

function Get-ToolkitSharedWorkspaceList {
    param([Parameter(Mandatory = $true)]$Config)

    return @(
        foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $Config)) {
            if ($null -ne $workspace -and [string]$workspace.mode -eq "shared") {
                $workspace
            }
        }
    )
}

function Get-ToolkitPrimarySharedWorkspace {
    param([Parameter(Mandatory = $true)]$Config)

    return @(Get-ToolkitSharedWorkspaceList -Config $Config) | Select-Object -First 1
}

function Test-ToolkitWorkspaceAllowsAgentToAgent {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Workspace
    )

    if ($null -eq $Workspace) {
        return $false
    }

    if ($Workspace.PSObject.Properties.Name -contains "enableAgentToAgent") {
        return ConvertTo-ToolkitBooleanValue -Value $Workspace.enableAgentToAgent -DefaultValue $false
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and
        $null -ne $Config.multiAgent -and
        $Config.multiAgent.PSObject.Properties.Name -contains "enableAgentToAgent") {
        return ConvertTo-ToolkitBooleanValue -Value $Config.multiAgent.enableAgentToAgent -DefaultValue $false
    }

    return $false
}

function Test-ToolkitWorkspaceManagesAgentsMd {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Workspace
    )

    if ($null -eq $Workspace) {
        return $false
    }

    if ($Workspace.PSObject.Properties.Name -contains "manageWorkspaceAgentsMd") {
        return ConvertTo-ToolkitBooleanValue -Value $Workspace.manageWorkspaceAgentsMd -DefaultValue $false
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and
        $null -ne $Config.multiAgent -and
        $Config.multiAgent.PSObject.Properties.Name -contains "manageWorkspaceAgentsMd") {
        return ConvertTo-ToolkitBooleanValue -Value $Config.multiAgent.manageWorkspaceAgentsMd -DefaultValue $false
    }

    return $false
}

function Test-ToolkitAgentAssigned {
    param([Parameter(Mandatory = $true)]$AgentConfig)

    return $AgentConfig.PSObject.Properties.Name -contains "endpointKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.endpointKey)
}

function Test-ToolkitAgentEnabled {
    param([Parameter(Mandatory = $true)]$AgentConfig)

    if ($null -eq $AgentConfig) {
        return $false
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "enabled" -and $null -ne $AgentConfig.enabled) {
        return ConvertTo-ToolkitBooleanValue -Value $AgentConfig.enabled -DefaultValue $true
    }

    return $true
}

function Get-ToolkitConfiguredAgentIds {
    param([Parameter(Mandatory = $true)]$Config)

    return @(
        foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
            if ($null -eq $agent -or [string]::IsNullOrWhiteSpace([string]$agent.id)) {
                continue
            }

            [string]$agent.id
        }
    )
}

function Get-ToolkitAssignedAgentList {
    param([Parameter(Mandatory = $true)]$Config)

    return @(
        foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
            if ($null -eq $agent) {
                continue
            }

            if ((Test-ToolkitAgentEnabled -AgentConfig $agent) -and (Test-ToolkitAgentAssigned -AgentConfig $agent)) {
                $agent
            }
        }
    )
}

function Get-ToolkitAgentModelPreference {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $refs = New-Object System.Collections.Generic.List[string]
    if ($AgentConfig.PSObject.Properties.Name -contains "modelRef" -and -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.modelRef)) {
        $refs.Add([string]$AgentConfig.modelRef)
    }
    if ($AgentConfig.PSObject.Properties.Name -contains "candidateModelRefs" -and $null -ne $AgentConfig.candidateModelRefs) {
        foreach ($candidateRef in @($AgentConfig.candidateModelRefs)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$candidateRef) -and ([string]$candidateRef -notin @($refs))) {
                $refs.Add([string]$candidateRef)
            }
        }
    }

    foreach ($candidateRef in @($refs)) {
        if ([string]$candidateRef -like "ollama/*") {
            return "local"
        }
    }

    foreach ($candidateRef in @($refs)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidateRef)) {
            return "hosted"
        }
    }

    return "static"
}

function Get-ToolkitLegacyMultiAgentConfig {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "multiAgent" -and $null -ne $Config.multiAgent) {
        return $Config.multiAgent
    }

    $agentsContainer = Get-ToolkitAgentsContainer -Config $Config
    if ($null -eq $agentsContainer) {
        return $null
    }

    $workspaces = @(Get-ToolkitWorkspaceList -Config $Config)
    $primarySharedWorkspace = Get-ToolkitPrimarySharedWorkspace -Config $Config
    $legacy = [ordered]@{
        enabled              = $true
        enableAgentToAgent   = @(
            foreach ($workspace in $workspaces) {
                if (Test-ToolkitWorkspaceAllowsAgentToAgent -Config $Config -Workspace $workspace) {
                    $true
                }
            }
        ).Count -gt 0
        manageWorkspaceAgentsMd = @(
            foreach ($workspace in $workspaces) {
                if (Test-ToolkitWorkspaceManagesAgentsMd -Config $Config -Workspace $workspace) {
                    $true
                }
            }
        ).Count -gt 0
        rolePolicies         = Get-ToolkitRolePolicies -Config $Config
        telegramRouting      = Get-ToolkitTelegramRouting -Config $Config
        extraAgents          = @()
    }

    if ($null -ne $primarySharedWorkspace) {
        $legacy.sharedWorkspace = [ordered]@{
            enabled       = $true
            path          = [string]$primarySharedWorkspace.path
            rolePolicyKey = if ($primarySharedWorkspace.PSObject.Properties.Name -contains "rolePolicyKey" -and $primarySharedWorkspace.rolePolicyKey) { [string]$primarySharedWorkspace.rolePolicyKey } else { "sharedWorkspace" }
        }
    }
    else {
        $legacy.sharedWorkspace = [ordered]@{
            enabled = $false
        }
    }

    $knownKeys = @("strongAgent", "researchAgent", "localChatAgent", "hostedTelegramAgent", "localReviewAgent", "localCoderAgent", "remoteReviewAgent", "remoteCoderAgent")
    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent) {
            continue
        }

        $legacyAgent = $agent.PSObject.Copy()
        $workspace = Get-ToolkitWorkspaceForAgent -Config $Config -Agent $agent
        if ($null -ne $workspace) {
            $workspaceMode = if ($workspace.PSObject.Properties.Name -contains "mode" -and $workspace.mode) { [string]$workspace.mode } else { "shared" }
            Add-Member -InputObject $legacyAgent -NotePropertyName "workspaceMode" -NotePropertyValue $workspaceMode -Force
            if ($workspaceMode -eq "private") {
                if ($workspace.PSObject.Properties.Name -contains "path" -and $workspace.path) {
                    Add-Member -InputObject $legacyAgent -NotePropertyName "workspace" -NotePropertyValue ([string]$workspace.path) -Force
                }
                if ($workspace.PSObject.Properties.Name -contains "allowSharedWorkspaceAccess") {
                    Add-Member -InputObject $legacyAgent -NotePropertyName "sharedWorkspaceAccess" -NotePropertyValue ([bool]$workspace.allowSharedWorkspaceAccess) -Force
                }
            }
        }

        $agentKey = if ($legacyAgent.PSObject.Properties.Name -contains "key" -and $legacyAgent.key) { [string]$legacyAgent.key } else { $null }
        if ($agentKey -and $agentKey -in $knownKeys) {
            $legacy[$agentKey] = $legacyAgent
        }
        else {
            $legacy.extraAgents += $legacyAgent
        }
    }

    return [pscustomobject]$legacy
}

function Add-ToolkitLegacyMultiAgentView {
    param([Parameter(Mandatory = $true)]$Config)

    $legacy = Get-ToolkitLegacyMultiAgentConfig -Config $Config
    if ($null -eq $legacy) {
        return $Config
    }

    if ($Config.PSObject.Properties.Name -contains "multiAgent") {
        $Config.multiAgent = $legacy
    }
    else {
        Add-Member -InputObject $Config -NotePropertyName "multiAgent" -NotePropertyValue $legacy -Force
    }

    return $Config
}

function Convert-ToolkitConfigToPersistedSchema {
    param([Parameter(Mandatory = $true)]$Config)

    $Config = Normalize-ToolkitConfigDefaults -Config $Config

    if (-not ($Config.PSObject.Properties.Name -contains "multiAgent") -or $null -eq $Config.multiAgent) {
        return $Config
    }

    $multi = $Config.multiAgent
    $agentsList = New-Object System.Collections.Generic.List[object]
    $privateWorkspaces = New-Object System.Collections.Generic.List[object]
    $sharedAgentIds = New-Object System.Collections.Generic.List[string]

    function Add-PersistedAgent {
        param(
            [Parameter(Mandatory = $true)]$Agent,
            [string]$Key
        )

        if ($null -eq $Agent -or -not $Agent.id) {
            return
        }

        $clone = $Agent.PSObject.Copy()
        if ($clone.PSObject.Properties.Name -contains "enabled") {
            $clone.enabled = [bool]$clone.enabled
        }
        else {
            Add-Member -InputObject $clone -NotePropertyName "enabled" -NotePropertyValue (Test-ToolkitAgentEnabled -AgentConfig $Agent) -Force
        }
        if ($Key) {
            if ($clone.PSObject.Properties.Name -contains "key") {
                $clone.key = $Key
            }
            else {
                Add-Member -InputObject $clone -NotePropertyName "key" -NotePropertyValue $Key -Force
            }
        }
        if ($Key -eq "strongAgent") {
            if ($clone.PSObject.Properties.Name -contains "isMain") {
                $clone.isMain = $true
            }
            else {
                Add-Member -InputObject $clone -NotePropertyName "isMain" -NotePropertyValue $true -Force
            }
        }

        foreach ($propertyName in @("modelSource", "workspaceMode", "workspace", "sharedWorkspaceAccess")) {
            if ($clone.PSObject.Properties.Name -contains $propertyName) {
                $clone.PSObject.Properties.Remove($propertyName)
            }
        }

        if (($clone.PSObject.Properties.Name -contains "endpointKey") -and [string]::IsNullOrWhiteSpace([string]$clone.endpointKey)) {
            $clone.PSObject.Properties.Remove("endpointKey")
        }

        $agentsList.Add($clone)

        $wasPrivate = ($Agent.PSObject.Properties.Name -contains "workspaceMode" -and [string]$Agent.workspaceMode -eq "private") -or
            (($Agent.PSObject.Properties.Name -contains "workspace") -and -not [string]::IsNullOrWhiteSpace([string]$Agent.workspace))
        if ($wasPrivate) {
            $privateWorkspaces.Add([pscustomobject][ordered]@{
                    id                       = "workspace-$([string]$Agent.id)"
                    name                     = if ($Agent.name) { "$([string]$Agent.name) Workspace" } else { "$([string]$Agent.id) Workspace" }
                    mode                     = "private"
                    path                     = if ($Agent.PSObject.Properties.Name -contains "workspace" -and $Agent.workspace) { [string]$Agent.workspace } else { "/home/node/.openclaw/workspace-$([string]$Agent.id)" }
                    allowSharedWorkspaceAccess = [bool]($Agent.PSObject.Properties.Name -contains "sharedWorkspaceAccess" -and $Agent.sharedWorkspaceAccess)
                    enableAgentToAgent       = [bool]$multi.enableAgentToAgent
                    manageWorkspaceAgentsMd  = [bool]$multi.manageWorkspaceAgentsMd
                    agents                   = @([string]$Agent.id)
                })
        }
        else {
            $sharedAgentIds.Add([string]$Agent.id)
        }
    }

    foreach ($legacyKey in @("strongAgent", "researchAgent", "localChatAgent", "hostedTelegramAgent", "localReviewAgent", "localCoderAgent", "remoteReviewAgent", "remoteCoderAgent")) {
        if ($multi.PSObject.Properties.Name -contains $legacyKey -and $null -ne $multi.$legacyKey) {
            Add-PersistedAgent -Agent $multi.$legacyKey -Key $legacyKey
        }
    }
    foreach ($extraAgent in @($multi.extraAgents)) {
        if ($null -ne $extraAgent) {
            Add-PersistedAgent -Agent $extraAgent
        }
    }

    $workspaces = New-Object System.Collections.Generic.List[object]
    if (($multi.PSObject.Properties.Name -contains "sharedWorkspace" -and $null -ne $multi.sharedWorkspace -and ($multi.sharedWorkspace.enabled -or $sharedAgentIds.Count -gt 0))) {
        $workspaces.Add([pscustomobject][ordered]@{
                id                      = "shared-main"
                name                    = "Shared Workspace"
                mode                    = "shared"
                path                    = if ($multi.sharedWorkspace.path) { [string]$multi.sharedWorkspace.path } else { "/home/node/.openclaw/workspace" }
                rolePolicyKey           = if ($multi.sharedWorkspace.rolePolicyKey) { [string]$multi.sharedWorkspace.rolePolicyKey } else { "sharedWorkspace" }
                enableAgentToAgent      = [bool]$multi.enableAgentToAgent
                manageWorkspaceAgentsMd = [bool]$multi.manageWorkspaceAgentsMd
                agents                  = @($sharedAgentIds.ToArray())
            })
    }
    foreach ($workspace in $privateWorkspaces) {
        $workspaces.Add($workspace)
    }

    $agentsContainer = [pscustomobject][ordered]@{
        list            = @($agentsList.ToArray())
        rolePolicies    = if ($multi.PSObject.Properties.Name -contains "rolePolicies") { $multi.rolePolicies } else { @{} }
        telegramRouting = if ($multi.PSObject.Properties.Name -contains "telegramRouting") { $multi.telegramRouting } else { $null }
    }

    $workspacesArray = @($workspaces.ToArray())

    if ($Config.PSObject.Properties.Name -contains "agents") {
        $Config.agents = $agentsContainer
    }
    else {
        Add-Member -InputObject $Config -NotePropertyName "agents" -NotePropertyValue $agentsContainer -Force
    }

    if ($Config.PSObject.Properties.Name -contains "workspaces") {
        $Config.workspaces = $workspacesArray
    }
    else {
        Add-Member -InputObject $Config -NotePropertyName "workspaces" -NotePropertyValue $workspacesArray -Force
    }

    $Config.PSObject.Properties.Remove("multiAgent")
    return $Config
}
