function Split-ToolkitModelRef {
    param([string]$ModelRef)

    $trimmed = ([string]$ModelRef).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed -notmatch "/") {
        return $null
    }

    $parts = $trimmed -split "/", 2
    return [pscustomobject]@{
        Provider = $parts[0]
        Model    = $parts[1]
    }
}

function Get-ToolkitBootstrapConfig {
    param([string]$ConfigPath)

    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $toolkitDir = Split-Path -Parent $PSScriptRoot
        $ConfigPath = Join-Path $toolkitDir "openclaw-bootstrap.config.json"
    }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        return $null
    }

    $json = Get-Content -LiteralPath $ConfigPath -Raw
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return $json | ConvertFrom-Json -Depth 100
    }

    return $json | ConvertFrom-Json
}

function Get-ToolkitLiveOpenClawConfig {
    param($BootstrapConfig)

    $hostConfigDir = ""
    if ($null -ne $BootstrapConfig -and
        $BootstrapConfig.PSObject.Properties.Name -contains "hostConfigDir" -and
        -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.hostConfigDir)) {
        $hostConfigDir = [string]$BootstrapConfig.hostConfigDir
    }
    else {
        $hostConfigDir = Join-Path $env:USERPROFILE ".openclaw"
    }

    $liveConfigPath = Join-Path $hostConfigDir "openclaw.json"
    if (-not (Test-Path -LiteralPath $liveConfigPath -PathType Leaf)) {
        return $null
    }

    $json = Get-Content -LiteralPath $liveConfigPath -Raw
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return $json | ConvertFrom-Json -Depth 100
    }

    return $json | ConvertFrom-Json
}

function Resolve-ToolkitAgentPrimaryModelRef {
    param(
        $LiveConfig,
        [string]$AgentId
    )

    if ($null -eq $LiveConfig) {
        return ""
    }

    $agent = @($LiveConfig.agents.list) | Where-Object { [string]$_.id -eq $AgentId } | Select-Object -First 1
    if ($agent -and $agent.model -and $agent.model.primary) {
        return [string]$agent.model.primary
    }

    if ($LiveConfig.agents.defaults -and $LiveConfig.agents.defaults.model -and $LiveConfig.agents.defaults.model.primary) {
        return [string]$LiveConfig.agents.defaults.model.primary
    }

    return ""
}

function Test-ToolkitModelRefReasoningCapable {
    param(
        [string]$ModelRef,
        $BootstrapConfig,
        $LiveConfig
    )

    $parts = Split-ToolkitModelRef -ModelRef $ModelRef
    if ($null -eq $parts) {
        return $false
    }

    $liveProvider = $LiveConfig.models.providers.($parts.Provider)
    if ($liveProvider) {
        $liveModel = @($liveProvider.models) | Where-Object { [string]$_.id -eq [string]$parts.Model } | Select-Object -First 1
        if ($liveModel -and $liveModel.PSObject.Properties.Name -contains "reasoning" -and [bool]$liveModel.reasoning) {
            return $true
        }
    }

    foreach ($model in @($BootstrapConfig.modelCatalog)) {
        if ([string]$model.id -eq [string]$parts.Model -and
            $model.PSObject.Properties.Name -contains "reasoning" -and
            [bool]$model.reasoning) {
            return $true
        }
    }

    foreach ($endpoint in @($BootstrapConfig.endpoints)) {
        $providerId = if ($endpoint.PSObject.Properties.Name -contains "providerId" -and $endpoint.providerId) {
            [string]$endpoint.providerId
        }
        else {
            [string]$endpoint.key
        }
        if ($providerId -ne [string]$parts.Provider) {
            continue
        }

        foreach ($model in @($endpoint.ollama.models)) {
            if ([string]$model.id -eq [string]$parts.Model -and
                $model.PSObject.Properties.Name -contains "reasoning" -and
                [bool]$model.reasoning) {
                return $true
            }
        }
    }

    return $false
}

function Resolve-ToolkitThinkingLevel {
    param(
        [Parameter(Mandatory = $true)][string]$RequestedThinking,
        [string]$ModelRef,
        [string]$AgentId,
        [string]$ConfigPath
    )

    if ($RequestedThinking -ne "auto") {
        return [pscustomobject]@{
            Thinking = $RequestedThinking
            ModelRef = $ModelRef
            Reason   = "explicit"
        }
    }

    $bootstrapConfig = Get-ToolkitBootstrapConfig -ConfigPath $ConfigPath
    $liveConfig = Get-ToolkitLiveOpenClawConfig -BootstrapConfig $bootstrapConfig
    $resolvedModelRef = $ModelRef
    if ([string]::IsNullOrWhiteSpace($resolvedModelRef)) {
        $resolvedModelRef = Resolve-ToolkitAgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $AgentId
    }

    $reasoningCapable = Test-ToolkitModelRefReasoningCapable -ModelRef $resolvedModelRef -BootstrapConfig $bootstrapConfig -LiveConfig $liveConfig
    return [pscustomobject]@{
        Thinking = if ($reasoningCapable) { "high" } else { "off" }
        ModelRef = $resolvedModelRef
        Reason   = if ($reasoningCapable) { "auto:reasoning-capable" } else { "auto:reasoning-not-advertised" }
    }
}
