function Resolve-ConfigPathValue {
    param(
        [string]$Value,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $expandedValue = [Environment]::ExpandEnvironmentVariables([string]$Value)

    if ($expandedValue -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return $expandedValue
    }

    if ([System.IO.Path]::IsPathRooted($expandedValue)) {
        return [System.IO.Path]::GetFullPath($expandedValue)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $expandedValue))
}

function ConvertTo-PortableRelativeConfigPathValue {
    param(
        [string]$Value,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $expandedValue = [Environment]::ExpandEnvironmentVariables([string]$Value)
    if ($expandedValue -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return [string]$Value
    }

    if (-not [System.IO.Path]::IsPathRooted($expandedValue)) {
        return ([string]$Value -replace '\\', '/')
    }

    $baseFullPath = [System.IO.Path]::GetFullPath($BaseDir)
    $fullPath = [System.IO.Path]::GetFullPath($expandedValue)
    $relativePath = [System.IO.Path]::GetRelativePath($baseFullPath, $fullPath)

    return ($relativePath -replace '\\', '/')
}

function ConvertTo-PortableUserProfileConfigPathValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $expandedValue = [Environment]::ExpandEnvironmentVariables([string]$Value)
    if ($expandedValue -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return [string]$Value
    }

    if (-not [System.IO.Path]::IsPathRooted($expandedValue)) {
        return ([string]$Value -replace '\\', '/')
    }

    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        return [string]$Value
    }

    $userProfileFullPath = [System.IO.Path]::GetFullPath($env:USERPROFILE)
    $targetFullPath = [System.IO.Path]::GetFullPath($expandedValue)
    if (-not $targetFullPath.StartsWith($userProfileFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return [string]$Value
    }

    $suffix = $targetFullPath.Substring($userProfileFullPath.Length).TrimStart('\', '/')
    if ([string]::IsNullOrWhiteSpace($suffix)) {
        return "%USERPROFILE%"
    }

    return ("%USERPROFILE%/" + ($suffix -replace '\\', '/'))
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

function Normalize-ToolkitOptionalStringArrayProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )

    if (-not ($Object.PSObject.Properties.Name -contains $PropertyName)) {
        return @()
    }

    if ($null -eq $Object.$PropertyName) {
        $Object.$PropertyName = @()
    }
    else {
        $Object.$PropertyName = @($Object.$PropertyName | ForEach-Object { [string]$_ })
    }

    return @($Object.$PropertyName)
}

function Normalize-ToolkitTelegramExecApprovals {
    param($ExecApprovals)

    if ($null -eq $ExecApprovals) {
        return $null
    }

    Set-ToolkitBooleanDefaultProperty -Object $ExecApprovals -PropertyName "enabled" -DefaultValue $false
    Normalize-ToolkitOptionalStringArrayProperty -Object $ExecApprovals -PropertyName "approvers" | Out-Null

    foreach ($propertyName in @("agentFilter", "sessionFilter")) {
        if ($ExecApprovals.PSObject.Properties.Name -contains $propertyName) {
            Normalize-ToolkitOptionalStringArrayProperty -Object $ExecApprovals -PropertyName $propertyName | Out-Null
        }
    }

    if (-not ($ExecApprovals.PSObject.Properties.Name -contains "target") -or [string]::IsNullOrWhiteSpace([string]$ExecApprovals.target)) {
        Add-Member -InputObject $ExecApprovals -NotePropertyName "target" -NotePropertyValue "dm" -Force
    }
    else {
        $ExecApprovals.target = [string]$ExecApprovals.target
    }

    return $ExecApprovals
}

function Normalize-ToolkitTelegramGroupRecord {
    param($GroupRecord)

    if ($null -eq $GroupRecord) {
        return $null
    }

    Set-ToolkitBooleanDefaultProperty -Object $GroupRecord -PropertyName "enabled" -DefaultValue $true
    Set-ToolkitBooleanDefaultProperty -Object $GroupRecord -PropertyName "requireMention" -DefaultValue $true
    Normalize-ToolkitOptionalStringArrayProperty -Object $GroupRecord -PropertyName "allowFrom" | Out-Null
    return $GroupRecord
}

function ConvertTo-ToolkitTelegramAccountList {
    param($Accounts)

    $results = New-Object System.Collections.Generic.List[object]
    if ($null -eq $Accounts) {
        return @()
    }

    if ($Accounts -is [System.Collections.IList]) {
        foreach ($account in @($Accounts)) {
            if ($null -ne $account) {
                $results.Add($account)
            }
        }
        return @($results.ToArray())
    }

    $properties = @()
    if ($Accounts.PSObject) {
        $properties = @($Accounts.PSObject.Properties)
    }

    if ($properties.Count -gt 0) {
        foreach ($property in $properties) {
            $account = $property.Value
            if ($null -eq $account) {
                $account = [pscustomobject][ordered]@{}
            }
            elseif ($account -is [hashtable]) {
                $account = [pscustomobject]$account
            }

            if (-not ($account.PSObject.Properties.Name -contains "id") -or [string]::IsNullOrWhiteSpace([string]$account.id)) {
                Add-Member -InputObject $account -NotePropertyName "id" -NotePropertyValue ([string]$property.Name) -Force
            }

            $results.Add($account)
        }

        return @($results.ToArray())
    }

    return @($Accounts)
}

function Get-ToolkitTelegramDefaultAccountId {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "telegram" -and
        $null -ne $Config.telegram -and
        $Config.telegram.PSObject.Properties.Name -contains "defaultAccount" -and
        -not [string]::IsNullOrWhiteSpace([string]$Config.telegram.defaultAccount)) {
        return ([string]$Config.telegram.defaultAccount).Trim()
    }

    return "default"
}

function Normalize-ToolkitTelegramAccountRecord {
    param($AccountRecord)

    if ($null -eq $AccountRecord) {
        return $null
    }

    if ($AccountRecord -is [hashtable]) {
        $AccountRecord = [pscustomobject]$AccountRecord
    }

    if ($AccountRecord.PSObject.Properties.Name -contains "id") {
        $AccountRecord.id = [string]$AccountRecord.id
    }

    Set-ToolkitBooleanDefaultProperty -Object $AccountRecord -PropertyName "enabled" -DefaultValue $true

    foreach ($propertyName in @("allowFrom", "groupAllowFrom")) {
        if ($AccountRecord.PSObject.Properties.Name -contains $propertyName) {
            Normalize-ToolkitOptionalStringArrayProperty -Object $AccountRecord -PropertyName $propertyName | Out-Null
        }
    }

    if ($AccountRecord.PSObject.Properties.Name -contains "execApprovals" -and $null -ne $AccountRecord.execApprovals) {
        Normalize-ToolkitTelegramExecApprovals -ExecApprovals $AccountRecord.execApprovals | Out-Null
    }

    if ($AccountRecord.PSObject.Properties.Name -contains "groups" -and $null -ne $AccountRecord.groups) {
        $normalizedGroups = New-Object System.Collections.Generic.List[object]
        foreach ($group in @($AccountRecord.groups)) {
            if ($null -eq $group) {
                continue
            }

            $normalizedGroup = Normalize-ToolkitTelegramGroupRecord -GroupRecord $group
            if ($null -ne $normalizedGroup) {
                $normalizedGroups.Add($normalizedGroup)
            }
        }
        $AccountRecord.groups = @($normalizedGroups.ToArray())
    }

    return $AccountRecord
}

function Normalize-ToolkitTelegramRouteRecord {
    param(
        $RouteRecord,
        [string]$DefaultAccountId = "default"
    )

    if ($null -eq $RouteRecord) {
        return $null
    }

    if ($RouteRecord -is [hashtable]) {
        $RouteRecord = [pscustomobject]$RouteRecord
    }

    $accountId = if ($RouteRecord.PSObject.Properties.Name -contains "accountId" -and -not [string]::IsNullOrWhiteSpace([string]$RouteRecord.accountId)) {
        ([string]$RouteRecord.accountId).Trim()
    }
    else {
        $DefaultAccountId
    }

    if ($RouteRecord.PSObject.Properties.Name -contains "accountId") {
        $RouteRecord.accountId = $accountId
    }
    else {
        Add-Member -InputObject $RouteRecord -NotePropertyName "accountId" -NotePropertyValue $accountId -Force
    }

    $targetAgentId = if ($RouteRecord.PSObject.Properties.Name -contains "targetAgentId" -and -not [string]::IsNullOrWhiteSpace([string]$RouteRecord.targetAgentId)) {
        ([string]$RouteRecord.targetAgentId).Trim()
    }
    else {
        ""
    }

    $matchType = if ($RouteRecord.PSObject.Properties.Name -contains "matchType" -and -not [string]::IsNullOrWhiteSpace([string]$RouteRecord.matchType)) {
        ([string]$RouteRecord.matchType).Trim().ToLowerInvariant()
    }
    else {
        ""
    }

    $peerId = if ($RouteRecord.PSObject.Properties.Name -contains "peerId" -and -not [string]::IsNullOrWhiteSpace([string]$RouteRecord.peerId)) {
        ([string]$RouteRecord.peerId).Trim()
    }
    else {
        ""
    }

    if ([string]::IsNullOrWhiteSpace($matchType)) {
        return @()
    }

    if ($matchType -notin @("trusted-dms", "trusted-groups", "direct", "group")) {
        return @()
    }

    if ($matchType -in @("direct", "group") -and [string]::IsNullOrWhiteSpace($peerId)) {
        return @()
    }

    return @([pscustomobject][ordered]@{
            accountId     = $accountId
            targetAgentId = $targetAgentId
            matchType     = $matchType
            peerId        = $peerId
        })
}

function Get-ToolkitTelegramAccountList {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "telegram" -and
        $null -ne $Config.telegram -and
        $Config.telegram.PSObject.Properties.Name -contains "accounts" -and
        $null -ne $Config.telegram.accounts) {
        return @($Config.telegram.accounts)
    }

    return @()
}

function Get-ToolkitTelegramAccountById {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AccountId
    )

    foreach ($account in @(Get-ToolkitTelegramAccountList -Config $Config)) {
        if ($null -eq $account) {
            continue
        }

        if ($account.PSObject.Properties.Name -contains "id" -and [string]$account.id -eq $AccountId) {
            return $account
        }
    }

    return $null
}

function Normalize-ToolkitTelegramRoutingConfig {
    param([Parameter(Mandatory = $true)]$Config)

    $agentsContainer = Get-ToolkitAgentsContainer -Config $Config
    if ($null -eq $agentsContainer) {
        return $null
    }

    if (-not ($agentsContainer.PSObject.Properties.Name -contains "telegramRouting") -or $null -eq $agentsContainer.telegramRouting) {
        return $null
    }

    $telegramRouting = if ($agentsContainer.telegramRouting -is [hashtable]) {
        [pscustomobject]$agentsContainer.telegramRouting
    }
    else {
        $agentsContainer.telegramRouting
    }

    $defaultAccountId = Get-ToolkitTelegramDefaultAccountId -Config $Config
    $rawRoutes = New-Object System.Collections.Generic.List[object]
    if ($telegramRouting.PSObject.Properties.Name -contains "routes" -and $null -ne $telegramRouting.routes) {
        foreach ($route in @($telegramRouting.routes)) {
            if ($null -ne $route) {
                $rawRoutes.Add($route)
            }
        }
    }
    $normalizedRoutes = New-Object System.Collections.Generic.List[object]
    $seenRouteKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($route in @($rawRoutes.ToArray())) {
        foreach ($normalizedRoute in @(Normalize-ToolkitTelegramRouteRecord -RouteRecord $route -DefaultAccountId $defaultAccountId)) {
            if ($null -eq $normalizedRoute) {
                continue
            }

            $accountId = if ($normalizedRoute.PSObject.Properties.Name -contains "accountId") { [string]$normalizedRoute.accountId } else { "" }
            $matchType = if ($normalizedRoute.PSObject.Properties.Name -contains "matchType") { [string]$normalizedRoute.matchType } else { "" }
            $peerId = if ($normalizedRoute.PSObject.Properties.Name -contains "peerId") { [string]$normalizedRoute.peerId } else { "" }
            if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($matchType)) {
                continue
            }

            $routeKey = ("{0}|{1}|{2}" -f $accountId, $matchType, $peerId)
            if ($seenRouteKeys.Add($routeKey)) {
                $normalizedRoutes.Add($normalizedRoute)
            }
        }
    }
    if ($telegramRouting.PSObject.Properties.Name -contains "routes") {
        $telegramRouting.routes = @($normalizedRoutes.ToArray())
    }
    else {
        Add-Member -InputObject $telegramRouting -NotePropertyName "routes" -NotePropertyValue @($normalizedRoutes.ToArray()) -Force
    }

    $agentsContainer.telegramRouting = $telegramRouting
    return $telegramRouting
}

function Get-ToolkitTelegramRouteList {
    param([Parameter(Mandatory = $true)]$Config)

    $telegramRouting = Normalize-ToolkitTelegramRoutingConfig -Config $Config
    if ($null -ne $telegramRouting -and
        $telegramRouting.PSObject.Properties.Name -contains "routes" -and
        $null -ne $telegramRouting.routes) {
        return @($telegramRouting.routes)
    }

    return @()
}

function Get-ToolkitTelegramAccountTrustedDirectIds {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AccountId
    )

    $accountConfig = Get-ToolkitTelegramAccountById -Config $Config -AccountId $AccountId
    if ($null -ne $accountConfig -and $accountConfig.PSObject.Properties.Name -contains "allowFrom" -and $null -ne $accountConfig.allowFrom) {
        return @($accountConfig.allowFrom | ForEach-Object { [string]$_ })
    }

    if ($Config.PSObject.Properties.Name -contains "telegram" -and
        $null -ne $Config.telegram -and
        $Config.telegram.PSObject.Properties.Name -contains "allowFrom" -and
        $null -ne $Config.telegram.allowFrom) {
        return @($Config.telegram.allowFrom | ForEach-Object { [string]$_ })
    }

    return @()
}

function Get-ToolkitTelegramAccountTrustedGroupIds {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AccountId
    )

    $accountConfig = Get-ToolkitTelegramAccountById -Config $Config -AccountId $AccountId
    if ($null -ne $accountConfig -and $accountConfig.PSObject.Properties.Name -contains "groups" -and $null -ne $accountConfig.groups) {
        return @(
            foreach ($group in @($accountConfig.groups)) {
                if ($null -ne $group -and $group.PSObject.Properties.Name -contains "id" -and -not [string]::IsNullOrWhiteSpace([string]$group.id)) {
                    [string]$group.id
                }
            }
        )
    }

    $defaultAccountId = Get-ToolkitTelegramDefaultAccountId -Config $Config
    if ($AccountId -eq $defaultAccountId -or @((Get-ToolkitTelegramAccountList -Config $Config)).Count -eq 0) {
        if ($Config.PSObject.Properties.Name -contains "telegram" -and
            $null -ne $Config.telegram -and
            $Config.telegram.PSObject.Properties.Name -contains "groups" -and
            $null -ne $Config.telegram.groups) {
            return @(
                foreach ($group in @($Config.telegram.groups)) {
                    if ($null -ne $group -and $group.PSObject.Properties.Name -contains "id" -and -not [string]::IsNullOrWhiteSpace([string]$group.id)) {
                        [string]$group.id
                    }
                }
            )
        }
    }

    return @()
}

function Get-ToolkitTelegramRouteBindingSpecs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [object[]]$Routes = @(),
        [string]$DefaultAccountId = "default"
    )

    $normalizedRoutes = New-Object System.Collections.Generic.List[object]
    foreach ($route in @($Routes)) {
        foreach ($normalizedRoute in @(Normalize-ToolkitTelegramRouteRecord -RouteRecord $route -DefaultAccountId $DefaultAccountId)) {
            if ($null -ne $normalizedRoute) {
                $normalizedRoutes.Add($normalizedRoute)
            }
        }
    }

    $specificGroupKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $specificDirectKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($route in @($normalizedRoutes.ToArray())) {
        $accountId = if ($route.PSObject.Properties.Name -contains "accountId" -and -not [string]::IsNullOrWhiteSpace([string]$route.accountId)) {
            [string]$route.accountId
        }
        else {
            $DefaultAccountId
        }

        $matchType = if ($route.PSObject.Properties.Name -contains "matchType") { ([string]$route.matchType).ToLowerInvariant() } else { "" }
        $peerId = if ($route.PSObject.Properties.Name -contains "peerId") { [string]$route.peerId } else { "" }
        switch ($matchType) {
            "group" {
                if (-not [string]::IsNullOrWhiteSpace($peerId)) {
                    [void]$specificGroupKeys.Add(("{0}|group|{1}" -f $accountId, $peerId))
                }
            }
            "direct" {
                if (-not [string]::IsNullOrWhiteSpace($peerId)) {
                    [void]$specificDirectKeys.Add(("{0}|direct|{1}" -f $accountId, $peerId))
                }
            }
        }
    }

    $bindingSpecs = New-Object System.Collections.Generic.List[object]
    $seenBindingKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($route in @($normalizedRoutes.ToArray())) {
        $accountId = if ($route.PSObject.Properties.Name -contains "accountId" -and -not [string]::IsNullOrWhiteSpace([string]$route.accountId)) {
            [string]$route.accountId
        }
        else {
            $DefaultAccountId
        }
        $targetAgentId = if ($route.PSObject.Properties.Name -contains "targetAgentId") { [string]$route.targetAgentId } else { "" }
        $matchType = if ($route.PSObject.Properties.Name -contains "matchType") { ([string]$route.matchType).ToLowerInvariant() } else { "" }
        $peerId = if ($route.PSObject.Properties.Name -contains "peerId") { [string]$route.peerId } else { "" }

        $candidateSpecs = @()
        switch ($matchType) {
            "trusted-groups" {
                foreach ($groupId in @(Get-ToolkitTelegramAccountTrustedGroupIds -Config $Config -AccountId $accountId)) {
                    $bindingKey = ("{0}|group|{1}" -f $accountId, [string]$groupId)
                    if ($specificGroupKeys.Contains($bindingKey)) {
                        continue
                    }

                    $candidateSpecs += [pscustomobject][ordered]@{
                        accountId     = $accountId
                        targetAgentId = $targetAgentId
                        matchType     = $matchType
                        peerKind      = "group"
                        peerId        = [string]$groupId
                    }
                }
            }
            "trusted-dms" {
                foreach ($directId in @(Get-ToolkitTelegramAccountTrustedDirectIds -Config $Config -AccountId $accountId)) {
                    $bindingKey = ("{0}|direct|{1}" -f $accountId, [string]$directId)
                    if ($specificDirectKeys.Contains($bindingKey)) {
                        continue
                    }

                    $candidateSpecs += [pscustomobject][ordered]@{
                        accountId     = $accountId
                        targetAgentId = $targetAgentId
                        matchType     = $matchType
                        peerKind      = "direct"
                        peerId        = [string]$directId
                    }
                }
            }
            "group" {
                if (-not [string]::IsNullOrWhiteSpace($peerId)) {
                    $candidateSpecs += [pscustomobject][ordered]@{
                        accountId     = $accountId
                        targetAgentId = $targetAgentId
                        matchType     = $matchType
                        peerKind      = "group"
                        peerId        = $peerId
                    }
                }
            }
            "direct" {
                if (-not [string]::IsNullOrWhiteSpace($peerId)) {
                    $candidateSpecs += [pscustomobject][ordered]@{
                        accountId     = $accountId
                        targetAgentId = $targetAgentId
                        matchType     = $matchType
                        peerKind      = "direct"
                        peerId        = $peerId
                    }
                }
            }
        }

        foreach ($candidate in @($candidateSpecs)) {
            $bindingKey = ("{0}|{1}|{2}" -f [string]$candidate.accountId, [string]$candidate.peerKind, [string]$candidate.peerId)
            if ($seenBindingKeys.Add($bindingKey)) {
                $bindingSpecs.Add($candidate)
            }
        }
    }

    return @($bindingSpecs.ToArray())
}

function Get-ToolkitTelegramRouteDescription {
    param(
        [Parameter(Mandatory = $true)]$RouteRecord,
        [string]$DefaultAccountId = "default"
    )

    foreach ($normalizedRoute in @(Normalize-ToolkitTelegramRouteRecord -RouteRecord $RouteRecord -DefaultAccountId $DefaultAccountId)) {
        if ($null -eq $normalizedRoute) {
            continue
        }

        $matchType = if ($normalizedRoute.PSObject.Properties.Name -contains "matchType") { ([string]$normalizedRoute.matchType).ToLowerInvariant() } else { "" }
        $peerId = if ($normalizedRoute.PSObject.Properties.Name -contains "peerId") { [string]$normalizedRoute.peerId } else { "" }
        switch ($matchType) {
            "trusted-dms" { return "trusted-dms" }
            "trusted-groups" { return "trusted-groups" }
            "direct" { return ("direct {0}" -f $peerId) }
            "group" { return ("group {0}" -f $peerId) }
        }
    }

    return "unknown"
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

    foreach ($propertyName in @($ModelEntry.PSObject.Properties.Name)) {
        if ($propertyName -like "fallbackModel*" -and $propertyName -ne "fallbackModelIds") {
            $ModelEntry.PSObject.Properties.Remove($propertyName)
        }
    }

    return $ModelEntry
}

function Normalize-ToolkitToolNameList {
    param($ToolNames)

    $normalized = New-Object System.Collections.Generic.List[string]
    foreach ($rawToolName in @($ToolNames)) {
        $toolName = if ($null -eq $rawToolName) { "" } else { ([string]$rawToolName).Trim() }
        if ([string]::IsNullOrWhiteSpace($toolName) -or $toolName -in @($normalized)) {
            continue
        }

        $normalized.Add($toolName)
    }

    return @($normalized.ToArray())
}

function New-ToolkitToolsetRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [string]$Name,
        [string[]]$Allow = @(),
        [string[]]$Deny = @()
    )

    return [pscustomobject][ordered]@{
        key   = $Key
        name  = if ([string]::IsNullOrWhiteSpace($Name)) { $Key } else { $Name }
        allow = @(Normalize-ToolkitToolNameList -ToolNames $Allow)
        deny  = @(Normalize-ToolkitToolNameList -ToolNames $Deny)
    }
}

function New-ToolkitDefaultMinimalToolsetRecord {
    param(
        [string[]]$Allow = @(),
        [string[]]$Deny = @()
    )

    $resolvedAllow = if (@($Allow).Count -gt 0) {
        @($Allow)
    }
    else {
        @("message")
    }

    $resolvedDeny = if (@($Deny).Count -gt 0) {
        @($Deny)
    }
    else {
        @(
            "read",
            "write",
            "edit",
            "apply_patch",
            "exec",
            "process",
            "code_execution",
            "web_search",
            "web_fetch",
            "x_search",
            "memory_search",
            "memory_get",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "sessions_yield",
            "subagents",
            "session_status",
            "browser",
            "canvas",
            "agents_list",
            "update_plan",
            "image",
            "image_generate",
            "music_generate",
            "video_generate",
            "tts",
            "nodes",
            "cron",
            "gateway"
        )
    }

    return (New-ToolkitToolsetRecord -Key "minimal" -Name "Minimal" -Allow $resolvedAllow -Deny $resolvedDeny)
}

function Normalize-ToolkitToolsetRecord {
    param($Toolset)

    if ($null -eq $Toolset) {
        return $null
    }

    $key = if ($Toolset.PSObject.Properties.Name -contains "key" -and $Toolset.key) {
        ([string]$Toolset.key).Trim()
    }
    else {
        ""
    }
    if ([string]::IsNullOrWhiteSpace($key)) {
        return $null
    }

    $Toolset.key = $key
    if (-not ($Toolset.PSObject.Properties.Name -contains "name") -or [string]::IsNullOrWhiteSpace([string]$Toolset.name)) {
        Add-Member -InputObject $Toolset -NotePropertyName "name" -NotePropertyValue $key -Force
    }
    else {
        $Toolset.name = ([string]$Toolset.name).Trim()
    }

    $allowSource = if ($Toolset.PSObject.Properties.Name -contains "allow") { $Toolset.allow } else { @() }
    $denySource = if ($Toolset.PSObject.Properties.Name -contains "deny") { $Toolset.deny } else { @() }
    $allow = @(Normalize-ToolkitToolNameList -ToolNames $allowSource)
    $deny = @(Normalize-ToolkitToolNameList -ToolNames $denySource)

    $Toolset.allow = @($allow)
    $Toolset.deny = @($deny)
    return $Toolset
}

function Get-ToolkitToolProfileMappedKey {
    param([string]$ToolProfile)

    switch (([string]$ToolProfile).Trim().ToLowerInvariant()) {
        "research" { return "research" }
        "review" { return "review" }
        "codingdelegate" { return "codingDelegate" }
        default { return $null }
    }
}

function Ensure-ToolkitToolsetsConfig {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not ($Config.PSObject.Properties.Name -contains "toolsets") -or $null -eq $Config.toolsets) {
        Add-Member -InputObject $Config -NotePropertyName "toolsets" -NotePropertyValue ([pscustomobject][ordered]@{
                list = @()
            }) -Force
    }

    if (-not ($Config.toolsets.PSObject.Properties.Name -contains "list") -or $null -eq $Config.toolsets.list) {
        Add-Member -InputObject $Config.toolsets -NotePropertyName "list" -NotePropertyValue @() -Force
    }

    $normalizedToolsets = New-Object System.Collections.Generic.List[object]
    $knownToolsetKeys = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($toolset in @($Config.toolsets.list)) {
        $normalizedToolset = Normalize-ToolkitToolsetRecord -Toolset $toolset
        if ($null -eq $normalizedToolset) {
            continue
        }
        if (-not $knownToolsetKeys.Add([string]$normalizedToolset.key)) {
            continue
        }
        $normalizedToolsets.Add($normalizedToolset)
    }

    $legacyGlobalAllow = @()
    $legacyGlobalDeny = @()
    $legacyResearchAllow = @()
    $legacyResearchDeny = @()
    if ($Config.PSObject.Properties.Name -contains "toolPolicy" -and $null -ne $Config.toolPolicy) {
        if ($Config.toolPolicy.PSObject.Properties.Name -contains "globalAlsoAllow") {
            $legacyGlobalAllow = @($Config.toolPolicy.globalAlsoAllow)
        }
        elseif ($Config.toolPolicy.PSObject.Properties.Name -contains "globalAllow") {
            $legacyGlobalAllow = @($Config.toolPolicy.globalAllow)
        }

        if ($Config.toolPolicy.PSObject.Properties.Name -contains "globalDeny") {
            $legacyGlobalDeny = @($Config.toolPolicy.globalDeny)
        }

        if ($Config.toolPolicy.PSObject.Properties.Name -contains "researchAlsoAllow") {
            $legacyResearchAllow = @($Config.toolPolicy.researchAlsoAllow)
        }
        elseif ($Config.toolPolicy.PSObject.Properties.Name -contains "researchAllow") {
            $legacyResearchAllow = @($Config.toolPolicy.researchAllow)
        }

        if ($Config.toolPolicy.PSObject.Properties.Name -contains "researchDeny") {
            $legacyResearchDeny = @($Config.toolPolicy.researchDeny)
        }
    }

    if (-not $knownToolsetKeys.Contains("minimal")) {
        $normalizedToolsets.Insert(0, (New-ToolkitDefaultMinimalToolsetRecord -Allow $legacyGlobalAllow -Deny $legacyGlobalDeny))
        [void]$knownToolsetKeys.Add("minimal")
    }

    if ((@($legacyResearchAllow).Count -gt 0 -or @($legacyResearchDeny).Count -gt 0) -and -not $knownToolsetKeys.Contains("research")) {
        $normalizedToolsets.Add((New-ToolkitToolsetRecord -Key "research" -Name "Research" -Allow $legacyResearchAllow -Deny $legacyResearchDeny))
        [void]$knownToolsetKeys.Add("research")
    }

    $Config.toolsets.list = @($normalizedToolsets.ToArray())

    if ($Config.PSObject.Properties.Name -contains "agents" -and
        $null -ne $Config.agents -and
        $Config.agents.PSObject.Properties.Name -contains "list" -and
        $null -ne $Config.agents.list) {
        foreach ($agent in @($Config.agents.list)) {
            if ($null -eq $agent) {
                continue
            }

            $toolsetKeys = New-Object System.Collections.Generic.List[string]
            if ($agent.PSObject.Properties.Name -contains "toolsetKeys" -and $null -ne $agent.toolsetKeys) {
                foreach ($rawKey in @($agent.toolsetKeys)) {
                    $key = ([string]$rawKey).Trim()
                    if ([string]::IsNullOrWhiteSpace($key) -or $key -eq "minimal" -or $key -in @($toolsetKeys)) {
                        continue
                    }
                    $toolsetKeys.Add($key)
                }
            }

            if ($toolsetKeys.Count -eq 0 -and $agent.PSObject.Properties.Name -contains "toolProfile") {
                $mappedKey = Get-ToolkitToolProfileMappedKey -ToolProfile ([string]$agent.toolProfile)
                if (-not [string]::IsNullOrWhiteSpace([string]$mappedKey) -and
                    $mappedKey -ne "minimal" -and
                    $knownToolsetKeys.Contains($mappedKey)) {
                    $toolsetKeys.Add($mappedKey)
                }
            }

            if ($agent.PSObject.Properties.Name -contains "toolsetKeys") {
                $agent.toolsetKeys = @($toolsetKeys.ToArray())
            }
            else {
                Add-Member -InputObject $agent -NotePropertyName "toolsetKeys" -NotePropertyValue @($toolsetKeys.ToArray()) -Force
            }

            if ($agent.PSObject.Properties.Name -contains "toolProfile") {
                $agent.PSObject.Properties.Remove("toolProfile")
            }
        }
    }

    return $Config
}

function Get-ToolkitMutableEndpointsCollection {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "endpoints" -and $null -ne $Config.endpoints) {
        return @($Config.endpoints)
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

    $toolsetKeys = if ($AgentConfig.PSObject.Properties.Name -contains "toolsetKeys" -and $null -ne $AgentConfig.toolsetKeys) {
        @(Normalize-ToolkitToolNameList -ToolNames $AgentConfig.toolsetKeys | Where-Object { $_ -ne "minimal" })
    }
    else {
        @()
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "toolsetKeys") {
        $AgentConfig.toolsetKeys = @($toolsetKeys)
    }
    else {
        Add-Member -InputObject $AgentConfig -NotePropertyName "toolsetKeys" -NotePropertyValue @($toolsetKeys) -Force
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "toolOverrides" -and $null -ne $AgentConfig.toolOverrides) {
        if ($AgentConfig.toolOverrides -is [hashtable]) {
            $AgentConfig.toolOverrides = [pscustomobject]$AgentConfig.toolOverrides
        }

        Set-ToolkitArrayDefaultProperty -Object $AgentConfig.toolOverrides -PropertyName "allow"
        Set-ToolkitArrayDefaultProperty -Object $AgentConfig.toolOverrides -PropertyName "deny"
        $AgentConfig.toolOverrides.allow = @(Normalize-ToolkitToolNameList -ToolNames $AgentConfig.toolOverrides.allow)
        $AgentConfig.toolOverrides.deny = @(Normalize-ToolkitToolNameList -ToolNames $AgentConfig.toolOverrides.deny)

        if (@($AgentConfig.toolOverrides.allow).Count -eq 0 -and @($AgentConfig.toolOverrides.deny).Count -eq 0) {
            $AgentConfig.PSObject.Properties.Remove("toolOverrides")
        }
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
        Set-ToolkitBooleanDefaultProperty -Object $Config.voiceNotes -PropertyName "enabled" -DefaultValue $false
    }

    Ensure-ToolkitToolsetsConfig -Config $Config | Out-Null

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
        if ($Config.telegram.PSObject.Properties.Name -contains "defaultAccount" -and $Config.telegram.defaultAccount) {
            $Config.telegram.defaultAccount = [string]$Config.telegram.defaultAccount
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "allowFrom") {
            Normalize-ToolkitOptionalStringArrayProperty -Object $Config.telegram -PropertyName "allowFrom" | Out-Null
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "groupAllowFrom") {
            Normalize-ToolkitOptionalStringArrayProperty -Object $Config.telegram -PropertyName "groupAllowFrom" | Out-Null
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "execApprovals" -and $null -ne $Config.telegram.execApprovals) {
            Normalize-ToolkitTelegramExecApprovals -ExecApprovals $Config.telegram.execApprovals | Out-Null
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "groups" -and $null -ne $Config.telegram.groups) {
            $normalizedTelegramGroups = New-Object System.Collections.Generic.List[object]
            foreach ($group in @($Config.telegram.groups)) {
                $normalizedGroup = Normalize-ToolkitTelegramGroupRecord -GroupRecord $group
                if ($null -ne $normalizedGroup) {
                    $normalizedTelegramGroups.Add($normalizedGroup)
                }
            }
            $Config.telegram.groups = @($normalizedTelegramGroups.ToArray())
        }
        if ($Config.telegram.PSObject.Properties.Name -contains "accounts" -and $null -ne $Config.telegram.accounts) {
            $normalizedAccounts = New-Object System.Collections.Generic.List[object]
            foreach ($account in @(ConvertTo-ToolkitTelegramAccountList -Accounts $Config.telegram.accounts)) {
                $normalizedAccount = Normalize-ToolkitTelegramAccountRecord -AccountRecord $account
                if ($null -ne $normalizedAccount) {
                    $normalizedAccounts.Add($normalizedAccount)
                }
            }
            $Config.telegram.accounts = @($normalizedAccounts.ToArray())
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
                ($endpoint.PSObject.Properties.Name -contains "models" -and $null -ne $endpoint.models)
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

    Normalize-ToolkitTelegramRoutingConfig -Config $Config | Out-Null

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

function ConvertTo-PortableConfigPaths {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    foreach ($propertyName in @("repoPath", "composeFilePath", "envFilePath", "envTemplatePath")) {
        if ($Config.PSObject.Properties.Name -contains $propertyName -and $Config.$propertyName) {
            $Config.$propertyName = ConvertTo-PortableRelativeConfigPathValue -Value ([string]$Config.$propertyName) -BaseDir $BaseDir
        }
    }

    foreach ($propertyName in @("hostConfigDir", "hostWorkspaceDir")) {
        if ($Config.PSObject.Properties.Name -contains $propertyName -and $Config.$propertyName) {
            $Config.$propertyName = ConvertTo-PortableUserProfileConfigPathValue -Value ([string]$Config.$propertyName)
        }
    }

    if ($Config.verification -and $Config.verification.PSObject.Properties.Name -contains "reportPath" -and $Config.verification.reportPath) {
        $Config.verification.reportPath = ConvertTo-PortableRelativeConfigPathValue -Value ([string]$Config.verification.reportPath) -BaseDir $BaseDir
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

    return (Normalize-ToolkitTelegramRoutingConfig -Config $Config)
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

