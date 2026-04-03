function Get-ToolkitOllamaEndpoints {
    param([Parameter(Mandatory = $true)]$Config)

    $endpoints = @()
    if ($Config.ollama -and $Config.ollama.PSObject.Properties.Name -contains "endpoints" -and $Config.ollama.endpoints) {
        $endpoints = @($Config.ollama.endpoints)
    }
    elseif ($Config.ollama -and $Config.ollama.enabled) {
        $legacy = [ordered]@{
            key      = "local"
            providerId = "ollama"
            baseUrl  = if ($Config.ollama.baseUrl) { [string]$Config.ollama.baseUrl } else { "http://127.0.0.1:11434" }
            apiKey   = if ($Config.ollama.apiKey) { [string]$Config.ollama.apiKey } else { "ollama-local" }
            default  = $true
            telemetry = [ordered]@{
                kind = "local-nvidia-smi"
            }
        }
        $endpoints = @([pscustomobject]$legacy)
    }

    $normalized = New-Object System.Collections.Generic.List[object]
    $sawDefault = $false
    foreach ($endpoint in @($endpoints)) {
        if ($null -eq $endpoint) {
            continue
        }

        $key = if ($endpoint.key) { [string]$endpoint.key } else { "local" }
        $providerId = if ($endpoint.PSObject.Properties.Name -contains "providerId" -and $endpoint.providerId) {
            [string]$endpoint.providerId
        }
        elseif ($key -eq "local") {
            "ollama"
        }
        else {
            "ollama-" + (($key -replace '[^a-zA-Z0-9-]', '-').Trim('-').ToLowerInvariant())
        }

        $item = [ordered]@{
            key        = $key
            providerId = $providerId
            baseUrl    = if ($endpoint.baseUrl) { [string]$endpoint.baseUrl } else { "http://127.0.0.1:11434" }
            hostBaseUrl = if ($endpoint.PSObject.Properties.Name -contains "hostBaseUrl" -and $endpoint.hostBaseUrl) {
                [string]$endpoint.hostBaseUrl
            }
            elseif ($endpoint.baseUrl) {
                [string]$endpoint.baseUrl
            }
            else {
                "http://127.0.0.1:11434"
            }
            apiKey     = if ($endpoint.apiKey) { [string]$endpoint.apiKey } else { "ollama-$key" }
            default    = [bool]($endpoint.PSObject.Properties.Name -contains "default" -and $endpoint.default)
        }

        if ($endpoint.PSObject.Properties.Name -contains "telemetry" -and $endpoint.telemetry) {
            $item.telemetry = $endpoint.telemetry
        }

        if ($endpoint.PSObject.Properties.Name -contains "autoPullMissingModels") {
            $item.autoPullMissingModels = [bool]$endpoint.autoPullMissingModels
        }
        else {
            $item.autoPullMissingModels = $true
        }

        if ($endpoint.PSObject.Properties.Name -contains "desiredModelIds" -and $endpoint.desiredModelIds) {
            $item.desiredModelIds = @(
                foreach ($modelId in @($endpoint.desiredModelIds)) {
                    if (-not [string]::IsNullOrWhiteSpace([string]$modelId)) {
                        [string]$modelId
                    }
                }
            )
        }
        else {
            $item.desiredModelIds = @()
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

function Get-ToolkitOllamaProviderIds {
    param([Parameter(Mandatory = $true)]$Config)

    return @(
        foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
            [string]$endpoint.providerId
        }
    )
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

function Get-ToolkitLocalModelCatalog {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.ollama -and $Config.ollama.models) {
        return @($Config.ollama.models)
    }

    return @()
}

function Get-ToolkitLocalModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    foreach ($entry in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
        if ($entry -and [string]$entry.id -eq $ModelId) {
            return $entry
        }
    }

    return $null
}
