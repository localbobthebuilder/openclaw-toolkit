function Get-ToolkitOllamaAuthProfileSpecs {
    param([Parameter(Mandatory = $true)]$Config)

    $specs = New-Object System.Collections.Generic.List[object]
    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        $providerId = [string]$endpoint.providerId
        if ([string]::IsNullOrWhiteSpace($providerId)) {
            continue
        }

        $apiKey = if ($endpoint.apiKey) { [string]$endpoint.apiKey } else { "" }
        if ([string]::IsNullOrWhiteSpace($apiKey)) {
            continue
        }

        $profileId = "$providerId`:default"
        $specs.Add([pscustomobject]@{
                ProviderId = $providerId
                ProfileId  = $profileId
                ApiKey     = $apiKey
            })
    }

    return $specs.ToArray()
}

function Get-ToolkitAgentAuthStoreDirs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AgentIds = @()
    )

    $dirs = New-Object System.Collections.Generic.List[string]
    $hostConfigDir = Get-HostConfigDir -Config $Config
    $agentsRoot = Join-Path $hostConfigDir "agents"

    if (Test-Path $agentsRoot) {
        foreach ($entry in @(Get-ChildItem -Path $agentsRoot -Directory -Force -ErrorAction SilentlyContinue)) {
            $dirs.Add((Join-Path $entry.FullName "agent"))
        }
    }

    foreach ($agentId in @($AgentIds)) {
        $agentIdText = [string]$agentId
        if ([string]::IsNullOrWhiteSpace($agentIdText)) {
            continue
        }

        $dirs.Add((Join-Path (Join-Path $agentsRoot $agentIdText) "agent"))
    }

    return @($dirs.ToArray() | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function New-ToolkitAuthProfileStoreDocument {
    return [pscustomobject]@{
        version = 1
        profiles = [pscustomobject]@{}
    }
}

function Read-ToolkitAuthProfileStoreDocument {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        return (New-ToolkitAuthProfileStoreDocument)
    }

    try {
        $raw = (Get-Content -Raw $Path).Trim()
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return (New-ToolkitAuthProfileStoreDocument)
        }

        return ($raw | ConvertFrom-Json -Depth 50)
    }
    catch {
        return (New-ToolkitAuthProfileStoreDocument)
    }
}

function Ensure-ToolkitAuthStoreObjectProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )

    if (-not ($Object.PSObject.Properties.Name -contains $PropertyName) -or $null -eq $Object.$PropertyName) {
        Add-Member -InputObject $Object -NotePropertyName $PropertyName -NotePropertyValue ([pscustomobject]@{}) -Force
    }
}

function Set-ToolkitAuthStoreCredential {
    param(
        [Parameter(Mandatory = $true)]$Store,
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $true)][string]$ProviderId,
        [Parameter(Mandatory = $true)][string]$ApiKey
    )

    Ensure-ToolkitAuthStoreObjectProperty -Object $Store -PropertyName "profiles"

    $credential = [pscustomobject]@{
        type     = "api_key"
        provider = $ProviderId
        key      = $ApiKey
    }

    Add-Member -InputObject $Store.profiles -NotePropertyName $ProfileId -NotePropertyValue $credential -Force

    Ensure-ToolkitAuthStoreObjectProperty -Object $Store -PropertyName "lastGood"
    Add-Member -InputObject $Store.lastGood -NotePropertyName $ProviderId -NotePropertyValue $ProfileId -Force
}

function Write-ToolkitAuthProfileStoreDocument {
    param(
        [Parameter(Mandatory = $true)]$Store,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }

    $Store | ConvertTo-Json -Depth 50 | Set-Content -Path $Path -Encoding UTF8
}

function Sync-ToolkitOllamaAgentAuthStores {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AgentIds = @()
    )

    $profileSpecs = @(Get-ToolkitOllamaAuthProfileSpecs -Config $Config)
    if (@($profileSpecs).Count -eq 0) {
        return
    }

    foreach ($agentDir in @(Get-ToolkitAgentAuthStoreDirs -Config $Config -AgentIds $AgentIds)) {
        $storePath = Join-Path $agentDir "auth-profiles.json"
        $store = Read-ToolkitAuthProfileStoreDocument -Path $storePath
        foreach ($profileSpec in @($profileSpecs)) {
            Set-ToolkitAuthStoreCredential -Store $store -ProfileId ([string]$profileSpec.ProfileId) -ProviderId ([string]$profileSpec.ProviderId) -ApiKey ([string]$profileSpec.ApiKey)
        }
        Write-ToolkitAuthProfileStoreDocument -Store $store -Path $storePath
    }
}
