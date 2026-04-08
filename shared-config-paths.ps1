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

function Ensure-ToolkitMarkdownTemplateKeysProperty {
    param(
        [Parameter(Mandatory = $true)]$Object
    )

    if (-not ($Object.PSObject.Properties.Name -contains "markdownTemplateKeys") -or $null -eq $Object.markdownTemplateKeys) {
        Add-Member -InputObject $Object -NotePropertyName "markdownTemplateKeys" -NotePropertyValue ([pscustomobject][ordered]@{}) -Force
    }
    elseif ($Object.markdownTemplateKeys -is [hashtable]) {
        $Object.markdownTemplateKeys = [pscustomobject]$Object.markdownTemplateKeys
    }

    return $Object.markdownTemplateKeys
}

function Set-ToolkitMarkdownTemplateSelection {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$FileName,
        [string]$TemplateKey
    )

    if ([string]::IsNullOrWhiteSpace($TemplateKey)) {
        return
    }

    $selectionRoot = Ensure-ToolkitMarkdownTemplateKeysProperty -Object $Object
    if ($selectionRoot.PSObject.Properties.Name -contains $FileName) {
        $selectionRoot.$FileName = [string]$TemplateKey
    }
    else {
        Add-Member -InputObject $selectionRoot -NotePropertyName $FileName -NotePropertyValue ([string]$TemplateKey) -Force
    }
}

function Get-ToolkitDerivedToolProfile {
    param([string]$LegacyRolePolicyKey)

    switch (([string]$LegacyRolePolicyKey).Trim().ToLowerInvariant()) {
        "research" { return "research" }
        "review" { return "review" }
        "codingdelegate" { return "codingDelegate" }
        default { return $null }
    }
}

function Get-ToolkitNormalizedFallbackModelIds {
    param($ModelEntry)

    $fallbackIds = New-Object System.Collections.Generic.List[string]
    if ($null -eq $ModelEntry) {
        return @()
    }

    if ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelIds" -and $null -ne $ModelEntry.fallbackModelIds) {
        foreach ($rawFallbackId in @($ModelEntry.fallbackModelIds)) {
            $fallbackId = [string]$rawFallbackId
            if ([string]::IsNullOrWhiteSpace($fallbackId) -or $fallbackId -in @($fallbackIds)) {
                continue
            }

            $fallbackIds.Add($fallbackId)
        }
    }
    elseif ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelId" -and
        -not [string]::IsNullOrWhiteSpace([string]$ModelEntry.fallbackModelId)) {
        $fallbackIds.Add([string]$ModelEntry.fallbackModelId)
    }

    return @($fallbackIds.ToArray())
}

function Normalize-ToolkitModelEntry {
    param(
        $ModelEntry,
        [switch]$AllowFallbacks
    )

    if ($null -eq $ModelEntry) {
        return $null
    }

    if ($AllowFallbacks) {
        $fallbackIds = @(Get-ToolkitNormalizedFallbackModelIds -ModelEntry $ModelEntry)
        if (@($fallbackIds).Count -gt 0) {
            if ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelIds") {
                $ModelEntry.fallbackModelIds = @($fallbackIds)
            }
            else {
                Add-Member -InputObject $ModelEntry -NotePropertyName "fallbackModelIds" -NotePropertyValue @($fallbackIds) -Force
            }
        }
        elseif ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelIds") {
            $ModelEntry.PSObject.Properties.Remove("fallbackModelIds")
        }
    }
    elseif ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelIds") {
        $ModelEntry.PSObject.Properties.Remove("fallbackModelIds")
    }

    if ($ModelEntry.PSObject.Properties.Name -contains "fallbackModelId") {
        $ModelEntry.PSObject.Properties.Remove("fallbackModelId")
    }

    return $ModelEntry
}

function Get-ToolkitMutableEndpointsCollection {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "endpoints" -and $null -ne $Config.endpoints) {
        return @($Config.endpoints)
    }

    if ($Config.PSObject.Properties.Name -contains "ollama" -and
        $null -ne $Config.ollama -and
        $Config.ollama.PSObject.Properties.Name -contains "endpoints" -and
        $null -ne $Config.ollama.endpoints) {
        return @($Config.ollama.endpoints)
    }

    return @()
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

    $legacyRolePolicyKey = if ($AgentConfig.PSObject.Properties.Name -contains "rolePolicyKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.rolePolicyKey)) {
        [string]$AgentConfig.rolePolicyKey
    }
    else {
        $null
    }

    if (-not [string]::IsNullOrWhiteSpace($legacyRolePolicyKey)) {
        $selectionRoot = Ensure-ToolkitMarkdownTemplateKeysProperty -Object $AgentConfig
        if (-not ($selectionRoot.PSObject.Properties.Name -contains "AGENTS.md") -or
            [string]::IsNullOrWhiteSpace([string]$selectionRoot.'AGENTS.md')) {
            Set-ToolkitMarkdownTemplateSelection -Object $AgentConfig -FileName "AGENTS.md" -TemplateKey $legacyRolePolicyKey
        }

        if ((-not ($AgentConfig.PSObject.Properties.Name -contains "toolProfile")) -or
            [string]::IsNullOrWhiteSpace([string]$AgentConfig.toolProfile)) {
            $derivedToolProfile = Get-ToolkitDerivedToolProfile -LegacyRolePolicyKey $legacyRolePolicyKey
            if (-not [string]::IsNullOrWhiteSpace([string]$derivedToolProfile)) {
                Add-Member -InputObject $AgentConfig -NotePropertyName "toolProfile" -NotePropertyValue ([string]$derivedToolProfile) -Force
            }
        }
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "rolePolicyKey") {
        $AgentConfig.PSObject.Properties.Remove("rolePolicyKey")
    }

    return $AgentConfig
}

function Sync-ToolkitEndpointAssignments {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [switch]$PreferAgentAssignments
    )

    $rawEndpoints = @(Get-ToolkitMutableEndpointsCollection -Config $Config)
    if (@($rawEndpoints).Count -eq 0) {
        return $Config
    }

    $validAgentIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent -or -not ($agent.PSObject.Properties.Name -contains "id")) {
            continue
        }

        $agentId = [string]$agent.id
        if (-not [string]::IsNullOrWhiteSpace($agentId)) {
            [void]$validAgentIds.Add($agentId)
        }
    }

    $endpointByKey = @{}
    $assignedAgentIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($endpoint in @($rawEndpoints)) {
        if ($null -eq $endpoint) {
            continue
        }

        Set-ToolkitArrayDefaultProperty -Object $endpoint -PropertyName "agents"

        $endpointKey = if ($endpoint.PSObject.Properties.Name -contains "key" -and $endpoint.key) {
            [string]$endpoint.key
        }
        else {
            ""
        }
        if (-not [string]::IsNullOrWhiteSpace($endpointKey)) {
            $endpointByKey[$endpointKey] = $endpoint
        }

        if ($PreferAgentAssignments) {
            $endpoint.agents = @()
            continue
        }

        $cleanedAgentIds = New-Object System.Collections.Generic.List[string]
        foreach ($rawAgentId in @($endpoint.agents)) {
            $agentId = [string]$rawAgentId
            if ([string]::IsNullOrWhiteSpace($agentId)) {
                continue
            }
            if (-not $validAgentIds.Contains($agentId)) {
                continue
            }
            if ($assignedAgentIds.Contains($agentId)) {
                continue
            }

            $cleanedAgentIds.Add($agentId)
            [void]$assignedAgentIds.Add($agentId)
        }

        $endpoint.agents = @($cleanedAgentIds.ToArray())
    }

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent -or -not ($agent.PSObject.Properties.Name -contains "id")) {
            continue
        }

        $agentId = [string]$agent.id
        if ([string]::IsNullOrWhiteSpace($agentId) -or $assignedAgentIds.Contains($agentId)) {
            continue
        }

        if ($agent.PSObject.Properties.Name -contains "endpointKey" -and
            -not [string]::IsNullOrWhiteSpace([string]$agent.endpointKey)) {
            $endpointKey = [string]$agent.endpointKey
            if ($endpointByKey.ContainsKey($endpointKey)) {
                $endpoint = $endpointByKey[$endpointKey]
                $endpoint.agents = @(@($endpoint.agents) + $agentId)
                [void]$assignedAgentIds.Add($agentId)
            }
        }
    }

    return $Config
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
        if ($Config.ollama.PSObject.Properties.Name -contains "models" -and $null -ne $Config.ollama.models) {
            foreach ($modelEntry in @($Config.ollama.models)) {
                Normalize-ToolkitModelEntry -ModelEntry $modelEntry -AllowFallbacks | Out-Null
            }
        }
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

    foreach ($endpoint in @(Get-ToolkitMutableEndpointsCollection -Config $Config)) {
            if ($null -eq $endpoint) {
                continue
            }

            Set-ToolkitBooleanDefaultProperty -Object $endpoint -PropertyName "default" -DefaultValue $false
            Set-ToolkitArrayDefaultProperty -Object $endpoint -PropertyName "agents"
            if ($endpoint.PSObject.Properties.Name -contains "hostedModels" -and $null -ne $endpoint.hostedModels) {
                foreach ($modelEntry in @($endpoint.hostedModels)) {
                    Normalize-ToolkitModelEntry -ModelEntry $modelEntry -AllowFallbacks | Out-Null
                }
            }
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
                if ($runtime.PSObject.Properties.Name -contains "models" -and $null -ne $runtime.models) {
                    foreach ($modelEntry in @($runtime.models)) {
                        Normalize-ToolkitModelEntry -ModelEntry $modelEntry -AllowFallbacks | Out-Null
                    }
                }
                if ($runtime.PSObject.Properties.Name -contains "modelOverrides" -and $null -ne $runtime.modelOverrides) {
                    foreach ($modelEntry in @($runtime.modelOverrides)) {
                        Normalize-ToolkitModelEntry -ModelEntry $modelEntry -AllowFallbacks | Out-Null
                    }
                }
            }
    }

    if ($Config.PSObject.Properties.Name -contains "modelCatalog" -and $null -ne $Config.modelCatalog) {
        foreach ($modelEntry in @($Config.modelCatalog)) {
            Normalize-ToolkitModelEntry -ModelEntry $modelEntry | Out-Null
        }
    }

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent) {
            continue
        }

        Normalize-ToolkitAgentConfig -AgentConfig $agent | Out-Null
    }

    Sync-ToolkitEndpointAssignments -Config $Config | Out-Null

    if ($Config.PSObject.Properties.Name -contains "workspaces" -and $null -ne $Config.workspaces) {
        $validAgentIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
            if ($null -eq $agent -or -not ($agent.PSObject.Properties.Name -contains "id")) {
                continue
            }

            $agentId = [string]$agent.id
            if (-not [string]::IsNullOrWhiteSpace($agentId)) {
                [void]$validAgentIds.Add($agentId)
            }
        }

        foreach ($workspace in @($Config.workspaces)) {
            if ($null -eq $workspace) {
                continue
            }

            if (-not ($workspace.PSObject.Properties.Name -contains "mode") -or [string]::IsNullOrWhiteSpace([string]$workspace.mode)) {
                Add-Member -InputObject $workspace -NotePropertyName "mode" -NotePropertyValue "shared" -Force
            }
            else {
                $normalizedMode = ([string]$workspace.mode).Trim().ToLowerInvariant()
                if ($normalizedMode -notin @("shared", "private")) {
                    $normalizedMode = "shared"
                }
                $workspace.mode = $normalizedMode
            }

            Set-ToolkitBooleanDefaultProperty -Object $workspace -PropertyName "enableAgentToAgent" -DefaultValue $false
            Set-ToolkitBooleanDefaultProperty -Object $workspace -PropertyName "manageWorkspaceAgentsMd" -DefaultValue $false
            Set-ToolkitArrayDefaultProperty -Object $workspace -PropertyName "agents"
            $legacyWorkspaceRolePolicyKey = if ($workspace.PSObject.Properties.Name -contains "rolePolicyKey" -and
                -not [string]::IsNullOrWhiteSpace([string]$workspace.rolePolicyKey)) {
                [string]$workspace.rolePolicyKey
            }
            else {
                $null
            }
            if (-not [string]::IsNullOrWhiteSpace($legacyWorkspaceRolePolicyKey)) {
                $workspaceSelectionRoot = Ensure-ToolkitMarkdownTemplateKeysProperty -Object $workspace
                if (-not ($workspaceSelectionRoot.PSObject.Properties.Name -contains "AGENTS.md") -or
                    [string]::IsNullOrWhiteSpace([string]$workspaceSelectionRoot.'AGENTS.md')) {
                    Set-ToolkitMarkdownTemplateSelection -Object $workspace -FileName "AGENTS.md" -TemplateKey $legacyWorkspaceRolePolicyKey
                }
            }
            if ($workspace.PSObject.Properties.Name -contains "rolePolicyKey") {
                $workspace.PSObject.Properties.Remove("rolePolicyKey")
            }
            if ([string]$workspace.mode -eq "private") {
                Set-ToolkitArrayDefaultProperty -Object $workspace -PropertyName "sharedWorkspaceIds"
            }
        }

        $sharedWorkspaceIds = New-Object System.Collections.Generic.List[string]
        foreach ($workspace in @($Config.workspaces)) {
            if ($null -eq $workspace -or [string]$workspace.mode -ne "shared") {
                continue
            }

            $workspaceId = if ($workspace.PSObject.Properties.Name -contains "id" -and $workspace.id) { [string]$workspace.id } else { "" }
            if (-not [string]::IsNullOrWhiteSpace($workspaceId) -and ($workspaceId -notin @($sharedWorkspaceIds))) {
                $sharedWorkspaceIds.Add($workspaceId)
            }
        }

        $assignedAgentIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        foreach ($workspace in @($Config.workspaces)) {
            if ($null -eq $workspace) {
                continue
            }

            $cleanedAgentIds = New-Object System.Collections.Generic.List[string]
            foreach ($rawAgentId in @($workspace.agents)) {
                $agentId = [string]$rawAgentId
                if ([string]::IsNullOrWhiteSpace($agentId)) {
                    continue
                }
                if (-not $validAgentIds.Contains($agentId)) {
                    continue
                }
                if ($assignedAgentIds.Contains($agentId)) {
                    continue
                }
                if ([string]$workspace.mode -eq "private" -and $cleanedAgentIds.Count -ge 1) {
                    continue
                }

                $cleanedAgentIds.Add($agentId)
                [void]$assignedAgentIds.Add($agentId)
            }
            $workspace.agents = @($cleanedAgentIds.ToArray())

            if ([string]$workspace.mode -eq "private") {
                $cleanedSharedWorkspaceIds = New-Object System.Collections.Generic.List[string]
                foreach ($rawWorkspaceId in @($workspace.sharedWorkspaceIds)) {
                    $workspaceId = [string]$rawWorkspaceId
                    if ([string]::IsNullOrWhiteSpace($workspaceId)) {
                        continue
                    }
                    if ($workspaceId -notin @($sharedWorkspaceIds)) {
                        continue
                    }
                    if ($workspaceId -notin @($cleanedSharedWorkspaceIds)) {
                        $cleanedSharedWorkspaceIds.Add($workspaceId)
                    }
                }

                $legacySharedAccess = $false
                if ($workspace.PSObject.Properties.Name -contains "allowSharedWorkspaceAccess") {
                    $legacySharedAccess = ConvertTo-ToolkitBooleanValue -Value $workspace.allowSharedWorkspaceAccess -DefaultValue $false
                }
                if ($legacySharedAccess -and $cleanedSharedWorkspaceIds.Count -eq 0 -and $sharedWorkspaceIds.Count -gt 0) {
                    $cleanedSharedWorkspaceIds.Add([string]$sharedWorkspaceIds[0])
                }

                $workspace.sharedWorkspaceIds = @($cleanedSharedWorkspaceIds.ToArray())
            }
            elseif ($workspace.PSObject.Properties.Name -contains "sharedWorkspaceIds") {
                $workspace.sharedWorkspaceIds = @()
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

function Get-ToolkitDefaultPrivateWorkspacePath {
    param([string]$AgentId)

    if ([string]::IsNullOrWhiteSpace($AgentId) -or $AgentId -eq "main") {
        return "/home/node/.openclaw/workspace"
    }

    return "/home/node/.openclaw/workspace-$AgentId"
}

function Get-ToolkitWorkspacePathValue {
    param(
        $Workspace,
        [string]$DefaultPath
    )

    if ($null -ne $Workspace -and
        $Workspace.PSObject.Properties.Name -contains "path" -and
        -not [string]::IsNullOrWhiteSpace([string]$Workspace.path)) {
        return [string]$Workspace.path
    }

    return $DefaultPath
}

function Get-ToolkitAgentWorkspaceMode {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $workspace = Get-ToolkitWorkspaceForAgent -Config $Config -AgentConfig $AgentConfig
    if ($null -ne $workspace -and
        $workspace.PSObject.Properties.Name -contains "mode" -and
        -not [string]::IsNullOrWhiteSpace([string]$workspace.mode)) {
        return ([string]$workspace.mode).ToLowerInvariant()
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "workspaceMode" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.workspaceMode)) {
        return ([string]$AgentConfig.workspaceMode).ToLowerInvariant()
    }

    return "private"
}

function Get-ToolkitAgentWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $agentId = if ($AgentConfig.PSObject.Properties.Name -contains "id" -and $AgentConfig.id) {
        [string]$AgentConfig.id
    }
    else {
        $null
    }

    $workspace = Get-ToolkitWorkspaceForAgent -Config $Config -AgentConfig $AgentConfig
    if ($null -ne $workspace) {
        if ([string]$workspace.mode -eq "shared") {
            return Get-ToolkitWorkspacePathValue -Workspace $workspace -DefaultPath "/home/node/.openclaw/workspace"
        }

        return Get-ToolkitWorkspacePathValue -Workspace $workspace -DefaultPath (Get-ToolkitDefaultPrivateWorkspacePath -AgentId $agentId)
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "workspace" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.workspace)) {
        return [string]$AgentConfig.workspace
    }

    return (Get-ToolkitDefaultPrivateWorkspacePath -AgentId $agentId)
}

function Get-ToolkitAccessibleSharedWorkspaceList {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $workspace = Get-ToolkitWorkspaceForAgent -Config $Config -AgentConfig $AgentConfig
    if ($null -eq $workspace) {
        return @()
    }

    if ([string]$workspace.mode -eq "shared") {
        return @()
    }

    $sharedWorkspaceIds = @()
    if ($workspace.PSObject.Properties.Name -contains "sharedWorkspaceIds" -and $null -ne $workspace.sharedWorkspaceIds) {
        $sharedWorkspaceIds = @($workspace.sharedWorkspaceIds | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    elseif ($workspace.PSObject.Properties.Name -contains "allowSharedWorkspaceAccess" -and
        (ConvertTo-ToolkitBooleanValue -Value $workspace.allowSharedWorkspaceAccess -DefaultValue $false)) {
        $primarySharedWorkspace = Get-ToolkitPrimarySharedWorkspace -Config $Config
        if ($null -ne $primarySharedWorkspace -and $primarySharedWorkspace.id) {
            $sharedWorkspaceIds = @([string]$primarySharedWorkspace.id)
        }
    }

    return @(
        foreach ($workspaceId in @($sharedWorkspaceIds)) {
            $sharedWorkspace = Get-ToolkitWorkspaceById -Config $Config -WorkspaceId ([string]$workspaceId)
            if ($null -ne $sharedWorkspace -and [string]$sharedWorkspace.mode -eq "shared") {
                $sharedWorkspace
            }
        }
    )
}

function Get-ToolkitPrimaryAccessibleSharedWorkspace {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    return @(Get-ToolkitAccessibleSharedWorkspaceList -Config $Config -AgentConfig $AgentConfig) | Select-Object -First 1
}

function Test-ToolkitAgentHasSharedWorkspaceAccess {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    return @(Get-ToolkitAccessibleSharedWorkspaceList -Config $Config -AgentConfig $AgentConfig).Count -gt 0
}

function Get-ToolkitAgentEndpointKey {
    param(
        $Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    if ($null -eq $AgentConfig) {
        return $null
    }

    $agentId = if ($AgentConfig.PSObject.Properties.Name -contains "id" -and $AgentConfig.id) {
        [string]$AgentConfig.id
    }
    else {
        ""
    }

    if ($null -ne $Config -and -not [string]::IsNullOrWhiteSpace($agentId)) {
        foreach ($endpoint in @(Get-ToolkitMutableEndpointsCollection -Config $Config)) {
            if ($null -eq $endpoint) {
                continue
            }

            foreach ($memberId in @($endpoint.agents)) {
                if ([string]$memberId -eq $agentId) {
                    if ($endpoint.PSObject.Properties.Name -contains "key") {
                        return [string]$endpoint.key
                    }

                    return $null
                }
            }
        }
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "endpointKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.endpointKey)) {
        return [string]$AgentConfig.endpointKey
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

    return $false
}

function Test-ToolkitAgentAssigned {
    param(
        $Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    return -not [string]::IsNullOrWhiteSpace((Get-ToolkitAgentEndpointKey -Config $Config -AgentConfig $AgentConfig))
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

            if ((Test-ToolkitAgentEnabled -AgentConfig $agent) -and (Test-ToolkitAgentAssigned -Config $Config -AgentConfig $agent)) {
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

