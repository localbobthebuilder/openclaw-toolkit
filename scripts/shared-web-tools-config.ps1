function Get-ToolkitConfigPathValue {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $current = $Document
    foreach ($segment in @($Path -split '\.')) {
        if ($null -eq $current) {
            return $null
        }

        if (-not ($current.PSObject.Properties.Name -contains $segment)) {
            return $null
        }

        $current = $current.$segment
    }

    return $current
}

function Test-ToolkitHashtableLikeHasEntries {
    param($Value)

    if ($null -eq $Value) {
        return $false
    }

    if ($Value -is [System.Collections.IDictionary]) {
        return $Value.Count -gt 0
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value).Count -gt 0
    }

    if ($Value.PSObject -and @($Value.PSObject.Properties).Count -gt 0) {
        return $true
    }

    return $false
}

function Set-ToolkitOpenClawOptionalJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        $Value
    )

    if ($null -eq $Value) {
        Add-ToolkitOpenClawConfigUnsetOperation -Path $Path
        return
    }

    if (($Value -is [string] -and [string]::IsNullOrWhiteSpace([string]$Value)) -or
        ($Value -isnot [string] -and -not (Test-ToolkitHashtableLikeHasEntries -Value $Value))) {
        Add-ToolkitOpenClawConfigUnsetOperation -Path $Path
        return
    }

    Add-ToolkitOpenClawConfigSetOperation -Path $Path -Value $Value
}

function Sync-ToolkitWebToolsOpenClawConfig {
    param([Parameter(Mandatory = $true)]$Config)

    $webSearch = Get-ToolkitConfigPathValue -Document $Config -Path "tools.web.search"
    $webFetch = Get-ToolkitConfigPathValue -Document $Config -Path "tools.web.fetch"

    Set-ToolkitOpenClawOptionalJson -Path "tools.web.search" -Value $webSearch
    Set-ToolkitOpenClawOptionalJson -Path "tools.web.fetch" -Value $webFetch

    foreach ($providerId in @("duckduckgo", "searxng", "firecrawl")) {
        $pluginEntry = Get-ToolkitConfigPathValue -Document $Config -Path ("plugins.entries." + $providerId)
        if ($null -eq $pluginEntry) {
            Add-ToolkitOpenClawConfigUnsetOperation -Path ("plugins.entries." + $providerId + ".enabled")
            Add-ToolkitOpenClawConfigUnsetOperation -Path ("plugins.entries." + $providerId + ".config.webSearch")
            Add-ToolkitOpenClawConfigUnsetOperation -Path ("plugins.entries." + $providerId + ".config.webFetch")
            continue
        }

        if ($pluginEntry.PSObject.Properties.Name -contains "enabled") {
            Add-ToolkitOpenClawConfigSetOperation -Path ("plugins.entries." + $providerId + ".enabled") -Value ([bool]$pluginEntry.enabled)
        }
        else {
            Add-ToolkitOpenClawConfigUnsetOperation -Path ("plugins.entries." + $providerId + ".enabled")
        }

        $webSearchConfig = Get-ToolkitConfigPathValue -Document $pluginEntry -Path "config.webSearch"
        $webFetchConfig = Get-ToolkitConfigPathValue -Document $pluginEntry -Path "config.webFetch"
        Set-ToolkitOpenClawOptionalJson -Path ("plugins.entries." + $providerId + ".config.webSearch") -Value $webSearchConfig
        Set-ToolkitOpenClawOptionalJson -Path ("plugins.entries." + $providerId + ".config.webFetch") -Value $webFetchConfig
    }
}
