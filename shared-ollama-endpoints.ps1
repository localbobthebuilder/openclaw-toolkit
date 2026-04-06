function Normalize-ToolkitOllamaModelEntries {
    param($Entries)

    $normalized = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($Entries)) {
        if ($entry -and $entry.PSObject.Properties.Name -contains "id" -and -not [string]::IsNullOrWhiteSpace([string]$entry.id)) {
            $normalized.Add($entry)
        }
    }

    return $normalized.ToArray()
}

function Normalize-ToolkitHostedModelEntries {
    param($Entries)

    $normalized = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($Entries)) {
        if ($entry -and $entry.PSObject.Properties.Name -contains "modelRef" -and -not [string]::IsNullOrWhiteSpace([string]$entry.modelRef)) {
            $normalized.Add($entry)
        }
    }

    return $normalized.ToArray()
}

function Get-ToolkitSharedModelCatalog {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "modelCatalog" -and $Config.modelCatalog) {
        return @($Config.modelCatalog)
    }

    if ($Config.ollama -and $Config.ollama.models) {
        return @($Config.ollama.models)
    }

    return @()
}

function Get-ToolkitLegacyLocalModelCatalog {
    param([Parameter(Mandatory = $true)]$Config)

    return @(Normalize-ToolkitOllamaModelEntries -Entries (Get-ToolkitSharedModelCatalog -Config $Config))
}

function Get-ToolkitEndpoints {
    param([Parameter(Mandatory = $true)]$Config)

    $rawEndpoints = @()
    if ($Config.PSObject.Properties.Name -contains "endpoints" -and $Config.endpoints) {
        $rawEndpoints = @($Config.endpoints)
    }
    elseif ($Config.ollama -and $Config.ollama.PSObject.Properties.Name -contains "endpoints" -and $Config.ollama.endpoints) {
        $rawEndpoints = @($Config.ollama.endpoints)
    }
    elseif ($Config.ollama -and $Config.ollama.enabled) {
        $legacy = [ordered]@{
            key      = "local"
            default  = $true
            telemetry = [ordered]@{
                kind = "local-nvidia-smi"
            }
            ollama   = [ordered]@{
                enabled             = $true
                providerId          = "ollama"
                baseUrl             = if ($Config.ollama.baseUrl) { [string]$Config.ollama.baseUrl } else { "http://127.0.0.1:11434" }
                hostBaseUrl         = if ($Config.ollama.hostBaseUrl) { [string]$Config.ollama.hostBaseUrl } else { "http://127.0.0.1:11434" }
                apiKey              = if ($Config.ollama.apiKey) { [string]$Config.ollama.apiKey } else { "ollama-local" }
                autoPullMissingModels = $true
            }
        }
        $rawEndpoints = @([pscustomobject]$legacy)
    }

    $normalized = New-Object System.Collections.Generic.List[object]
    $sawDefault = $false
    foreach ($endpoint in @($rawEndpoints)) {
        if ($null -eq $endpoint) {
            continue
        }

        $key = if ($endpoint.PSObject.Properties.Name -contains "key" -and $endpoint.key) { [string]$endpoint.key } else { "local" }
        $item = [ordered]@{
            key          = $key
            name         = if ($endpoint.PSObject.Properties.Name -contains "name" -and $endpoint.name) { [string]$endpoint.name } else { $key }
            default      = [bool]($endpoint.PSObject.Properties.Name -contains "default" -and $endpoint.default)
            hostedModels = @(
                if ($endpoint.PSObject.Properties.Name -contains "hostedModels" -and $endpoint.hostedModels) {
                    Normalize-ToolkitHostedModelEntries -Entries $endpoint.hostedModels
                }
            )
        }

        if ($endpoint.PSObject.Properties.Name -contains "telemetry" -and $endpoint.telemetry) {
            $item.telemetry = $endpoint.telemetry
        }

        $rawOllama = $null
        if ($endpoint.PSObject.Properties.Name -contains "ollama" -and $null -ne $endpoint.ollama) {
            $rawOllama = $endpoint.ollama
        }
        elseif ($endpoint.PSObject.Properties.Name -contains "baseUrl" -or
                $endpoint.PSObject.Properties.Name -contains "hostBaseUrl" -or
                $endpoint.PSObject.Properties.Name -contains "providerId" -or
                $endpoint.PSObject.Properties.Name -contains "models" -or
                $endpoint.PSObject.Properties.Name -contains "desiredModelIds" -or
                $endpoint.PSObject.Properties.Name -contains "modelOverrides") {
            $rawOllama = $endpoint
        }

        if ($null -ne $rawOllama) {
            $ollamaEnabled = $true
            if ($rawOllama.PSObject.Properties.Name -contains "enabled" -and $null -ne $rawOllama.enabled) {
                $ollamaEnabled = [bool]$rawOllama.enabled
            }

            if ($ollamaEnabled) {
                $providerId = if ($rawOllama.PSObject.Properties.Name -contains "providerId" -and $rawOllama.providerId) {
                    [string]$rawOllama.providerId
                }
                elseif ($key -eq "local") {
                    "ollama"
                }
                else {
                    "ollama-" + (($key -replace '[^a-zA-Z0-9-]', '-').Trim('-').ToLowerInvariant())
                }

                $item.ollama = [pscustomobject][ordered]@{
                    enabled               = $true
                    providerId            = $providerId
                    baseUrl               = if ($rawOllama.PSObject.Properties.Name -contains "baseUrl" -and $rawOllama.baseUrl) { [string]$rawOllama.baseUrl } else { "http://127.0.0.1:11434" }
                    hostBaseUrl           = if ($rawOllama.PSObject.Properties.Name -contains "hostBaseUrl" -and $rawOllama.hostBaseUrl) {
                        [string]$rawOllama.hostBaseUrl
                    }
                    elseif ($rawOllama.PSObject.Properties.Name -contains "baseUrl" -and $rawOllama.baseUrl) {
                        [string]$rawOllama.baseUrl
                    }
                    else {
                        "http://127.0.0.1:11434"
                    }
                    apiKey                = if ($rawOllama.PSObject.Properties.Name -contains "apiKey" -and $rawOllama.apiKey) { [string]$rawOllama.apiKey } else { "ollama-$key" }
                    autoPullMissingModels = if ($rawOllama.PSObject.Properties.Name -contains "autoPullMissingModels") { [bool]$rawOllama.autoPullMissingModels } else { $true }
                    usesEndpointModels    = [bool]($rawOllama.PSObject.Properties.Name -contains "models")
                    models                = @(
                        if ($rawOllama.PSObject.Properties.Name -contains "models" -and $rawOllama.models) {
                            Normalize-ToolkitOllamaModelEntries -Entries $rawOllama.models
                        }
                    )
                    legacyDesiredModelIds = @(
                        if ($rawOllama.PSObject.Properties.Name -contains "desiredModelIds" -and $rawOllama.desiredModelIds) {
                            foreach ($modelId in @($rawOllama.desiredModelIds)) {
                                if (-not [string]::IsNullOrWhiteSpace([string]$modelId)) {
                                    [string]$modelId
                                }
                            }
                        }
                    )
                    legacyModelOverrides  = @(
                        if ($rawOllama.PSObject.Properties.Name -contains "modelOverrides" -and $rawOllama.modelOverrides) {
                            Normalize-ToolkitOllamaModelEntries -Entries $rawOllama.modelOverrides
                        }
                    )
                }
            }
        }

        if ($item.default) {
            $sawDefault = $true
        }

        $normalized.Add([pscustomobject]$item)
    }

    if ($normalized.Count -gt 0 -and -not $sawDefault) {
        $normalized[0].default = $true
    }

    return $normalized.ToArray()
}

function Get-ToolkitDefaultEndpoint {
    param([Parameter(Mandatory = $true)]$Config)

    foreach ($endpoint in @(Get-ToolkitEndpoints -Config $Config)) {
        if ($endpoint.default) {
            return $endpoint
        }
    }

    return $null
}

function Get-ToolkitEndpoint {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey
    )

    $endpoints = @(Get-ToolkitEndpoints -Config $Config)
    if ([string]::IsNullOrWhiteSpace($EndpointKey)) {
        return (Get-ToolkitDefaultEndpoint -Config $Config)
    }

    foreach ($endpoint in $endpoints) {
        if ([string]$endpoint.key -eq $EndpointKey) {
            return $endpoint
        }
    }

    return $null
}

function Get-ToolkitEndpointHostedModelCatalog {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey
    )

    $endpoint = Get-ToolkitEndpoint -Config $Config -EndpointKey $EndpointKey
    if ($null -eq $endpoint) {
        return @()
    }

    return @($endpoint.hostedModels)
}

function Get-ToolkitOllamaEndpoints {
    param([Parameter(Mandatory = $true)]$Config)

    $ollamaEndpoints = New-Object System.Collections.Generic.List[object]
    foreach ($endpoint in @(Get-ToolkitEndpoints -Config $Config)) {
        if (-not ($endpoint.PSObject.Properties.Name -contains "ollama") -or $null -eq $endpoint.ollama) {
            continue
        }

        $runtime = $endpoint.ollama
        $item = [ordered]@{
            key                   = [string]$endpoint.key
            name                  = [string]$endpoint.name
            default               = [bool]$endpoint.default
            providerId            = [string]$runtime.providerId
            baseUrl               = [string]$runtime.baseUrl
            hostBaseUrl           = [string]$runtime.hostBaseUrl
            apiKey                = [string]$runtime.apiKey
            autoPullMissingModels = [bool]$runtime.autoPullMissingModels
            usesEndpointModels    = [bool]$runtime.usesEndpointModels
            models                = @($runtime.models)
            legacyDesiredModelIds = @($runtime.legacyDesiredModelIds)
            legacyModelOverrides  = @($runtime.legacyModelOverrides)
            hostedModels          = @($endpoint.hostedModels)
        }

        if ($endpoint.PSObject.Properties.Name -contains "telemetry" -and $endpoint.telemetry) {
            $item.telemetry = $endpoint.telemetry
        }

        $ollamaEndpoints.Add([pscustomobject]$item)
    }

    return $ollamaEndpoints.ToArray()
}

function Get-ToolkitDefaultOllamaEndpoint {
    param([Parameter(Mandatory = $true)]$Config)

    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        if ($endpoint.default) {
            return $endpoint
        }
    }

    return $null
}

function Get-ToolkitOllamaEndpoint {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey
    )

    $endpoints = @(Get-ToolkitOllamaEndpoints -Config $Config)
    if ([string]::IsNullOrWhiteSpace($EndpointKey)) {
        return (Get-ToolkitDefaultOllamaEndpoint -Config $Config)
    }

    foreach ($endpoint in $endpoints) {
        if ([string]$endpoint.key -eq $EndpointKey) {
            return $endpoint
        }
    }

    return $null
}

function Get-ToolkitOllamaEndpointByProviderId {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$ProviderId
    )

    if ([string]::IsNullOrWhiteSpace($ProviderId)) {
        return $null
    }

    if ($ProviderId -eq "ollama") {
        return (Get-ToolkitDefaultOllamaEndpoint -Config $Config)
    }

    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        if ([string]$endpoint.providerId -eq $ProviderId) {
            return $endpoint
        }
    }

    return $null
}

function Get-ToolkitOllamaProviderIds {
    param([Parameter(Mandatory = $true)]$Config)

    return @(
        foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
            [string]$endpoint.providerId
        }
    )
}

function Test-ToolkitHasOllamaEndpoints {
    param([Parameter(Mandatory = $true)]$Config)

    return (@(Get-ToolkitOllamaEndpoints -Config $Config).Count -gt 0)
}

function Get-ToolkitOllamaHostBaseUrl {
    param([Parameter(Mandatory = $true)]$Endpoint)

    if ($Endpoint.PSObject.Properties.Name -contains "hostBaseUrl" -and -not [string]::IsNullOrWhiteSpace([string]$Endpoint.hostBaseUrl)) {
        return [string]$Endpoint.hostBaseUrl
    }

    return [string]$Endpoint.baseUrl
}

function Get-ToolkitOllamaProviderBaseUrl {
    param([Parameter(Mandatory = $true)]$Endpoint)

    return [string]$Endpoint.baseUrl
}

function Get-ToolkitOllamaPullVramBudgetFraction {
    param($Config)

    $fraction = 0.70
    if ($null -ne $Config -and
        $Config.PSObject.Properties.Name -contains "ollama" -and
        $null -ne $Config.ollama -and
        $Config.ollama.PSObject.Properties.Name -contains "pullVramBudgetFraction" -and
        $Config.ollama.pullVramBudgetFraction -ne $null) {
        try {
            $parsed = [double]$Config.ollama.pullVramBudgetFraction
            if ($parsed -gt 0 -and $parsed -le 1) {
                $fraction = $parsed
            }
        }
        catch {
        }
    }

    return $fraction
}

function Get-ToolkitOllamaVramHeadroomMiB {
    param($Config)

    $headroomMiB = 1536
    if ($null -ne $Config -and
        $Config.PSObject.Properties.Name -contains "ollama" -and
        $null -ne $Config.ollama -and
        $Config.ollama.PSObject.Properties.Name -contains "vramHeadroomMiB" -and
        $Config.ollama.vramHeadroomMiB -ne $null) {
        try {
            $parsed = [double]$Config.ollama.vramHeadroomMiB
            if ($parsed -ge 0) {
                $headroomMiB = [int][math]::Round($parsed)
            }
        }
        catch {
        }
    }

    return $headroomMiB
}

function Test-ToolkitOllamaEndpointReachable {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [int]$TimeoutSeconds = 5
    )

    if ($null -eq $script:ToolkitOllamaEndpointReachableCache) {
        $script:ToolkitOllamaEndpointReachableCache = @{}
    }

    $endpointKey = if ($Endpoint.PSObject.Properties.Name -contains "key" -and $Endpoint.key) {
        [string]$Endpoint.key
    }
    else {
        (Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint)
    }
    $cacheKey = "$endpointKey|$TimeoutSeconds"
    if ($script:ToolkitOllamaEndpointReachableCache.ContainsKey($cacheKey)) {
        return [bool]$script:ToolkitOllamaEndpointReachableCache[$cacheKey]
    }

    $probeUrl = (Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint).TrimEnd("/") + "/api/version"
    try {
        $null = Invoke-RestMethod -Uri $probeUrl -Method Get -TimeoutSec $TimeoutSeconds -ErrorAction Stop
        $script:ToolkitOllamaEndpointReachableCache[$cacheKey] = $true
        return $true
    }
    catch {
        $script:ToolkitOllamaEndpointReachableCache[$cacheKey] = $false
        return $false
    }
}

function Get-ToolkitModelIdFromRef {
    param([string]$ModelRef)

    if ([string]::IsNullOrWhiteSpace($ModelRef)) {
        return $null
    }

    $parts = $ModelRef -split "/", 2
    if ($parts.Count -eq 2) {
        return [string]$parts[1]
    }

    return [string]$ModelRef
}

function Reset-ToolkitVerificationCleanupModelRefs {
    $global:ToolkitVerificationCleanupModelRefs = New-Object System.Collections.Generic.List[string]
}

function Get-ToolkitVerificationCleanupModelRefs {
    if ($null -eq $global:ToolkitVerificationCleanupModelRefs) {
        Reset-ToolkitVerificationCleanupModelRefs
    }

    return @($global:ToolkitVerificationCleanupModelRefs.ToArray())
}

function Add-ToolkitVerificationCleanupModelRef {
    param([string]$ModelRef)

    if ([string]::IsNullOrWhiteSpace($ModelRef)) {
        return $false
    }

    $modelRefText = [string]$ModelRef
    $providerId = ($modelRefText -split "/", 2)[0]
    if ($providerId -notlike "ollama*") {
        return $false
    }

    if ($modelRefText -in @(Get-ToolkitVerificationCleanupModelRefs)) {
        return $true
    }

    if ($null -eq $global:ToolkitVerificationCleanupModelRefs) {
        Reset-ToolkitVerificationCleanupModelRefs
    }

    $global:ToolkitVerificationCleanupModelRefs.Add($modelRefText)
    return $true
}

function Convert-ToolkitLocalModelIdToRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$EndpointKey
    )

    $endpoint = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey $EndpointKey
    if ($null -eq $endpoint) {
        throw "Unknown Ollama endpoint key: $EndpointKey"
    }

    return "$($endpoint.providerId)/$ModelId"
}

function Convert-ToolkitLocalRefToEndpointRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelRef,
        [string]$EndpointKey
    )

    $modelId = Get-ToolkitModelIdFromRef -ModelRef $ModelRef
    return (Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId $modelId -EndpointKey $EndpointKey)
}

function Test-IsToolkitLocalModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$ModelRef
    )

    if ([string]::IsNullOrWhiteSpace($ModelRef)) {
        return $false
    }

    $providerId = ($ModelRef -split "/", 2)[0]
    return $providerId -in @(Get-ToolkitOllamaProviderIds -Config $Config)
}

function Get-AgentOllamaEndpointKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "endpointKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.endpointKey)) {
        $explicit = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey ([string]$AgentConfig.endpointKey)
        if ($null -ne $explicit) {
            return [string]$explicit.key
        }
    }

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    if ($null -ne $defaultEndpoint) {
        return [string]$defaultEndpoint.key
    }

    return "local"
}

function Merge-ToolkitConfigObjects {
    param(
        $BaseObject,
        $OverrideObject
    )

    $merged = [ordered]@{}
    if ($null -ne $BaseObject) {
        foreach ($property in $BaseObject.PSObject.Properties) {
            $merged[$property.Name] = $property.Value
        }
    }
    if ($null -ne $OverrideObject) {
        foreach ($property in $OverrideObject.PSObject.Properties) {
            if ($null -ne $property.Value) {
                $merged[$property.Name] = $property.Value
            }
        }
    }

    if ($merged.Count -eq 0) {
        return $null
    }

    return [pscustomobject]$merged
}

function Get-ToolkitEndpointDesiredModelIds {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey
    )

    $endpoint = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey $EndpointKey
    if ($null -eq $endpoint) {
        return @()
    }

    if ($endpoint.usesEndpointModels) {
        return @(
            foreach ($model in @($endpoint.models)) {
                if ($model -and $model.id) {
                    [string]$model.id
                }
            }
        )
    }

    return @($endpoint.legacyDesiredModelIds)
}

function Get-ToolkitEndpointModelCatalog {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey
    )

    $endpoint = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey $EndpointKey
    if ($null -eq $endpoint) {
        return @()
    }

    if ($endpoint.usesEndpointModels) {
        return @($endpoint.models)
    }

    $legacyCatalog = @(Get-ToolkitLegacyLocalModelCatalog -Config $Config)
    $requestedIds = New-Object System.Collections.Generic.List[string]
    foreach ($modelId in @($endpoint.legacyDesiredModelIds)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$modelId) -and [string]$modelId -notin @($requestedIds)) {
            $requestedIds.Add([string]$modelId)
        }
    }
    foreach ($override in @($endpoint.legacyModelOverrides)) {
        if ($override -and $override.id -and [string]$override.id -notin @($requestedIds)) {
            $requestedIds.Add([string]$override.id)
        }
    }
    if ($requestedIds.Count -eq 0) {
        foreach ($legacyModel in @($legacyCatalog)) {
            if ($legacyModel -and $legacyModel.id -and [string]$legacyModel.id -notin @($requestedIds)) {
                $requestedIds.Add([string]$legacyModel.id)
            }
        }
    }

    $effectiveCatalog = New-Object System.Collections.Generic.List[object]
    foreach ($modelId in @($requestedIds)) {
        $baseEntry = $null
        foreach ($entry in @($legacyCatalog)) {
            if ($entry -and [string]$entry.id -eq $modelId) {
                $baseEntry = $entry
                break
            }
        }

        $overrideEntry = $null
        foreach ($entry in @($endpoint.legacyModelOverrides)) {
            if ($entry -and [string]$entry.id -eq $modelId) {
                $overrideEntry = $entry
                break
            }
        }

        $effectiveEntry = Merge-ToolkitConfigObjects -BaseObject $baseEntry -OverrideObject $overrideEntry
        if ($null -ne $effectiveEntry) {
            $effectiveCatalog.Add($effectiveEntry)
        }
    }

    return $effectiveCatalog.ToArray()
}

function Get-ToolkitLocalModelCatalog {
    param([Parameter(Mandatory = $true)]$Config)

    $catalog = New-Object System.Collections.Generic.List[object]
    $seenIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        foreach ($entry in @(Get-ToolkitEndpointModelCatalog -Config $Config -EndpointKey ([string]$endpoint.key))) {
            if ($entry -and $entry.id -and $seenIds.Add([string]$entry.id)) {
                $catalog.Add($entry)
            }
        }
    }

    if ($catalog.Count -gt 0) {
        return $catalog.ToArray()
    }

    return @(Get-ToolkitLegacyLocalModelCatalog -Config $Config)
}

function Get-ToolkitLocalModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$EndpointKey
    )

    $catalog = if ([string]::IsNullOrWhiteSpace($EndpointKey)) {
        @(Get-ToolkitLocalModelCatalog -Config $Config)
    }
    else {
        @(Get-ToolkitEndpointModelCatalog -Config $Config -EndpointKey $EndpointKey)
    }

    foreach ($entry in $catalog) {
        if ($entry -and [string]$entry.id -eq $ModelId) {
            return $entry
        }
    }

    return $null
}

function Get-ToolkitEffectiveLocalModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$EndpointKey
    )

    if (-not [string]::IsNullOrWhiteSpace($EndpointKey)) {
        $endpointEntry = Get-ToolkitLocalModelEntry -Config $Config -ModelId $ModelId -EndpointKey $EndpointKey
        if ($null -ne $endpointEntry) {
            return $endpointEntry
        }
    }

    return (Get-ToolkitLocalModelEntry -Config $Config -ModelId $ModelId)
}

function Get-ToolkitOllamaRegistryModelSizeMiB {
    param([Parameter(Mandatory = $true)][string]$ModelId)

    if ($null -eq $script:ToolkitOllamaRegistrySizeCache) {
        $script:ToolkitOllamaRegistrySizeCache = @{}
    }
    if ($script:ToolkitOllamaRegistrySizeCache.ContainsKey($ModelId)) {
        return $script:ToolkitOllamaRegistrySizeCache[$ModelId]
    }

    $parts = $ModelId -split ':', 2
    $modelName = $parts[0]
    $tag = if ($parts.Count -eq 2 -and $parts[1]) { $parts[1] } else { "latest" }

    if ($modelName -match '/') {
        $ns, $name = $modelName -split '/', 2
    }
    else {
        $ns = "library"
        $name = $modelName
    }

    $url = "https://registry.ollama.ai/v2/$ns/$name/manifests/$tag"
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers @{
            Accept = "application/vnd.docker.distribution.manifest.v2+json"
        } -TimeoutSec 10 -ErrorAction Stop
        $totalBytes = ($response.layers | Measure-Object -Property size -Sum).Sum
        if ($totalBytes -gt 0) {
            $cachedSize = [int][math]::Ceiling($totalBytes / 1MB)
            $script:ToolkitOllamaRegistrySizeCache[$ModelId] = $cachedSize
            return $cachedSize
        }
    }
    catch {
    }

    $script:ToolkitOllamaRegistrySizeCache[$ModelId] = $null
    return $null
}

function Get-ToolkitEndpointVramBudgetMiB {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        $Config,
        [double]$ThresholdFraction = 0.70
    )

    if ($null -ne $Config) {
        $ThresholdFraction = Get-ToolkitOllamaPullVramBudgetFraction -Config $Config
    }

    $telemetry = if ($Endpoint.PSObject.Properties.Name -contains "telemetry") { $Endpoint.telemetry } else { $null }
    $kind = if ($telemetry -and $telemetry.PSObject.Properties.Name -contains "kind" -and $telemetry.kind) {
        ([string]$telemetry.kind).ToLowerInvariant()
    }
    else {
        "local-nvidia-smi"
    }

    $totalMiB = $null
    switch ($kind) {
        "local-nvidia-smi" {
            $raw = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null
            if ($raw) {
                $parsed = 0
                if ([int]::TryParse((@($raw)[0]).Trim(), [ref]$parsed) -and $parsed -gt 0) {
                    $totalMiB = $parsed
                }
            }
        }
        "static-gpu-total" {
            if ($telemetry.PSObject.Properties.Name -contains "gpuTotalMiB" -and $telemetry.gpuTotalMiB) {
                $totalMiB = [int]$telemetry.gpuTotalMiB
            }
        }
    }

    if ($null -eq $totalMiB -or $totalMiB -le 0) {
        return $null
    }

    return [int]($totalMiB * $ThresholdFraction)
}

function Get-ToolkitLocalModelPullEstimateMiB {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$EndpointKey
    )

    $registryMiB = Get-ToolkitOllamaRegistryModelSizeMiB -ModelId $ModelId
    if ($null -ne $registryMiB) {
        return $registryMiB
    }

    $catalogEntry = Get-ToolkitEffectiveLocalModelEntry -Config $Config -ModelId $ModelId -EndpointKey $EndpointKey
    if ($null -ne $catalogEntry -and
        $catalogEntry.PSObject.Properties.Name -contains "vramEstimateMiB" -and
        $catalogEntry.vramEstimateMiB) {
        return [int]$catalogEntry.vramEstimateMiB
    }

    return $null
}

function Get-ToolkitLocalModelRefRuntimeStatus {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$ModelRef
    )

    $result = [ordered]@{
        modelRef     = [string]$ModelRef
        isLocal      = $false
        usable       = $true
        reason       = ""
        endpointKey  = $null
        providerId   = $null
        modelId      = $null
        estimateMiB  = $null
        budgetMiB    = $null
        reachability = $null
    }

    if ([string]::IsNullOrWhiteSpace($ModelRef)) {
        $result.usable = $false
        $result.reason = "Model ref is empty."
        return [pscustomobject]$result
    }

    $providerId, $modelId = ([string]$ModelRef -split "/", 2)
    $result.providerId = $providerId
    $result.modelId = $modelId

    if (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $ModelRef) -and $providerId -ne "ollama") {
        return [pscustomobject]$result
    }

    $result.isLocal = $true
    $endpoint = Get-ToolkitOllamaEndpointByProviderId -Config $Config -ProviderId $providerId
    if ($null -eq $endpoint) {
        $result.usable = $false
        $result.reason = "No Ollama endpoint is configured for provider '$providerId'."
        return [pscustomobject]$result
    }

    $result.endpointKey = [string]$endpoint.key
    $reachable = Test-ToolkitOllamaEndpointReachable -Endpoint $endpoint -TimeoutSeconds 5
    $result.reachability = $reachable
    if (-not $reachable) {
        $result.usable = $false
        $result.reason = "Endpoint '$($endpoint.key)' is not reachable."
        return [pscustomobject]$result
    }

    $budgetMiB = Get-ToolkitEndpointVramBudgetMiB -Endpoint $endpoint -Config $Config
    if ($null -eq $budgetMiB -or $budgetMiB -le 0) {
        return [pscustomobject]$result
    }

    $result.budgetMiB = [int]$budgetMiB
    $estimateMiB = Get-ToolkitLocalModelPullEstimateMiB -Config $Config -ModelId $modelId -EndpointKey ([string]$endpoint.key)
    if ($null -eq $estimateMiB -or $estimateMiB -le 0) {
        return [pscustomobject]$result
    }

    $result.estimateMiB = [int]$estimateMiB
    if ($estimateMiB -gt $budgetMiB) {
        $result.usable = $false
        $result.reason = "Model '$ModelRef' is estimated at $estimateMiB MiB, above the endpoint budget of $budgetMiB MiB."
    }

    return [pscustomobject]$result
}
