[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$ConfigFilePath,
    [string]$AgentId = "chat-local",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

# Derive default config path from bootstrap config so it's portable across machines/users
$_scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$_configFile = Join-Path $_scriptDir "openclaw-bootstrap.config.json"
if (-not $ConfigFilePath) {
    $_hostConfigDir = $null
    if (Test-Path $_configFile) {
        . (Join-Path $_scriptDir "shared-config-paths.ps1")
        $_bsCfg = Get-Content -Raw $_configFile | ConvertFrom-Json
        $_bsCfg = Resolve-PortableConfigPaths -Config $_bsCfg -BaseDir $_scriptDir
        if ($_bsCfg.hostConfigDir) { $_hostConfigDir = [string]$_bsCfg.hostConfigDir }
    }
    if (-not $_hostConfigDir) { $_hostConfigDir = Join-Path $env:USERPROFILE ".openclaw" }
    $ConfigFilePath = Join-Path $_hostConfigDir "openclaw.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[local-model] $Message" -ForegroundColor $Color
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

function Test-ContainerRunning {
    param([Parameter(Mandatory = $true)][string]$Name)

    $result = Invoke-External -FilePath "docker" -Arguments @("inspect", "-f", "{{.State.Running}}", $Name) -AllowFailure
    return $result.ExitCode -eq 0 -and $result.Output.Trim().ToLowerInvariant() -eq "true"
}

function Stop-OllamaModel {
    param([string]$ModelId)

    if ([string]::IsNullOrWhiteSpace($ModelId)) {
        return
    }

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        Write-ProgressLine "Skipping unload because ollama CLI is not available on the host" Yellow
        return
    }

    Write-ProgressLine "Stopping Ollama model $ModelId to free GPU memory" Gray
    $stopResult = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $ModelId) -AllowFailure
    if ($stopResult.ExitCode -eq 0) {
        Write-ProgressLine "Ollama model $ModelId stopped" Green
    }
    else {
        Write-ProgressLine "Ollama stop for $ModelId returned exit code $($stopResult.ExitCode)" Yellow
    }
}

function Get-ErrorCategory {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return "unknown"
    }

    $normalized = $Message.ToLowerInvariant()
    if ($normalized -match '429|resource_exhausted|quota|rate limit|too many requests') { return "provider-quota" }
    if ($normalized -match 'temporarily overloaded|overloaded|capacity|busy') { return "provider-capacity" }
    if ($normalized -match '401|403|unauthorized|forbidden|auth|api key|not authenticated') { return "provider-auth" }
    if ($normalized -match 'gateway closed|service restart|container .+ is not running|econnrefused') { return "gateway" }
    if ($normalized -match 'model.+not found|unknown model|could not resolve any ollama model|no configured ollama models') { return "model-missing" }
    return "task"
}

function Get-ErrorMessage {
    param($ErrorRecord)

    if ($null -ne $ErrorRecord -and $ErrorRecord.Exception -and -not [string]::IsNullOrWhiteSpace([string]$ErrorRecord.Exception.Message)) {
        return [string]$ErrorRecord.Exception.Message.Trim()
    }

    return ($ErrorRecord | Out-String).Trim()
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

function Get-LiveAgentLocalModelCandidateRefs {
    param(
        $LiveConfig,
        [string]$AgentId
    )

    $refs = @()
    $agentConfig = @($LiveConfig.agents.list) | Where-Object { $_.id -eq $AgentId } | Select-Object -First 1
    if ($agentConfig -and $agentConfig.model) {
        if ($agentConfig.model.primary) {
            $primaryRef = [string]$agentConfig.model.primary
            if ($primaryRef -like "ollama*/*") {
                $refs = Add-UniqueString -List $refs -Value $primaryRef
            }
        }

        foreach ($fallbackRef in @($agentConfig.model.fallbacks)) {
            $fallbackText = [string]$fallbackRef
            if ($fallbackText -like "ollama*/*") {
                $refs = Add-UniqueString -List $refs -Value $fallbackText
            }
        }
    }

    return @($refs)
}

function Get-BootstrapManagedAgentConfigById {
    param(
        $BootstrapConfig,
        [string]$AgentId
    )

    if ($null -eq $BootstrapConfig) {
        return $null
    }

    return (Get-ToolkitAgentById -Config $BootstrapConfig -AgentId $AgentId)
}

function Get-PreferredLocalSmokeCandidateRefs {
    param(
        $LiveConfig,
        $BootstrapConfig,
        [Parameter(Mandatory = $true)]$ProviderEntries,
        [string]$AgentId
    )

    $refs = @()
    foreach ($modelRef in @(Get-LiveAgentLocalModelCandidateRefs -LiveConfig $LiveConfig -AgentId $AgentId)) {
        $refs = Add-UniqueString -List $refs -Value $modelRef
    }

    if ($null -ne $BootstrapConfig) {
        $endpointKey = $null
        $bootstrapAgentConfig = Get-BootstrapManagedAgentConfigById -BootstrapConfig $BootstrapConfig -AgentId $AgentId
        if ($null -ne $bootstrapAgentConfig) {
            $endpointKey = Get-ToolkitAgentEndpointKey -Config $BootstrapConfig -AgentConfig $bootstrapAgentConfig
        }
        elseif (@($refs).Count -gt 0) {
            $providerId = ([string]$refs[0] -split '/', 2)[0]
            $endpoint = Get-ToolkitOllamaEndpointByProviderId -Config $BootstrapConfig -ProviderId $providerId
            if ($null -ne $endpoint) {
                $endpointKey = [string]$endpoint.key
            }
        }
        elseif ($null -ne (Get-ToolkitDefaultOllamaEndpoint -Config $BootstrapConfig)) {
            $endpointKey = [string](Get-ToolkitDefaultOllamaEndpoint -Config $BootstrapConfig).key
        }

        if (-not [string]::IsNullOrWhiteSpace($endpointKey)) {
            $endpointModels = @(
                foreach ($entry in @(Get-ToolkitEndpointModelCatalog -Config $BootstrapConfig -EndpointKey $endpointKey)) {
                    if ($entry -and $entry.id) {
                        [pscustomobject]@{
                            endpointKey = $endpointKey
                            id          = [string]$entry.id
                            input       = @($entry.input)
                        }
                    }
                }
            )
            foreach ($entry in @($endpointModels | Where-Object { $_.id -match 'flash|mini|small' })) {
                $refs = Add-UniqueString -List $refs -Value (Convert-ToolkitLocalModelIdToRef -Config $BootstrapConfig -ModelId ([string]$entry.id) -EndpointKey $endpointKey)
            }
            foreach ($entry in @($endpointModels | Where-Object { @($_.input) -contains "text" })) {
                $refs = Add-UniqueString -List $refs -Value (Convert-ToolkitLocalModelIdToRef -Config $BootstrapConfig -ModelId ([string]$entry.id) -EndpointKey $endpointKey)
            }
            foreach ($entry in @($endpointModels)) {
                $refs = Add-UniqueString -List $refs -Value (Convert-ToolkitLocalModelIdToRef -Config $BootstrapConfig -ModelId ([string]$entry.id) -EndpointKey $endpointKey)
            }
            return @($refs)
        }
    }

    foreach ($entry in @($ProviderEntries | Where-Object { $_.id -match 'flash|mini|small' })) {
        $refs = Add-UniqueString -List $refs -Value ("$($entry.providerId)/$($entry.id)")
    }
    foreach ($entry in @($ProviderEntries | Where-Object { @($_.input) -contains "text" })) {
        $refs = Add-UniqueString -List $refs -Value ("$($entry.providerId)/$($entry.id)")
    }
    foreach ($entry in @($ProviderEntries)) {
        $refs = Add-UniqueString -List $refs -Value ("$($entry.providerId)/$($entry.id)")
    }

    return @($refs)
}

function Resolve-UsableLocalSmokeModel {
    param(
        $BootstrapConfig,
        $LiveConfig,
        [Parameter(Mandatory = $true)]$ProviderEntries,
        [string]$AgentId
    )

    $candidateRefs = @(Get-PreferredLocalSmokeCandidateRefs -LiveConfig $LiveConfig -BootstrapConfig $BootstrapConfig -ProviderEntries $ProviderEntries -AgentId $AgentId)
    if (@($candidateRefs).Count -eq 0) {
        return [pscustomobject]@{
            status   = "skip"
            modelRef = ""
            detail   = "No configured Ollama models."
        }
    }

    if ($null -eq $BootstrapConfig) {
        return [pscustomobject]@{
            status   = "pass"
            modelRef = [string]$candidateRefs[0]
            detail   = "Bootstrap config unavailable, using the first configured local candidate."
        }
    }

    $skipReasons = @()
    foreach ($candidateRef in @($candidateRefs)) {
        $status = Get-ToolkitLocalModelRefRuntimeStatus -Config $BootstrapConfig -ModelRef $candidateRef
        if ($status.usable) {
            return [pscustomobject]@{
                status   = "pass"
                modelRef = [string]$candidateRef
                detail   = if ($status.reason) { [string]$status.reason } else { "" }
            }
        }

        if ($status.isLocal -and -not [string]::IsNullOrWhiteSpace([string]$status.reason)) {
            $skipReasons = Add-UniqueString -List $skipReasons -Value ([string]$status.reason)
        }
    }

    $detail = if (@($skipReasons).Count -gt 0) {
        "No configured local-model smoke candidate is usable right now. $(@($skipReasons) -join ' ')"
    }
    else {
        "No configured local-model smoke candidate is usable right now."
    }

    return [pscustomobject]@{
        status   = "skip"
        modelRef = ""
        detail   = $detail
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the local model smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

if (-not (Test-Path $ConfigFilePath)) {
    throw "OpenClaw config not found at $ConfigFilePath"
}

$bootstrapConfig = $null
if (Test-Path $_configFile) {
    try {
        $bootstrapConfig = Get-Content -Raw $_configFile | ConvertFrom-Json
        $bootstrapConfig = Resolve-PortableConfigPaths -Config $bootstrapConfig -BaseDir $_scriptDir
    }
    catch {
        $bootstrapConfig = $null
    }
}

$cfg = Get-Content -Raw $ConfigFilePath | ConvertFrom-Json
$localProviderIds = @(
    foreach ($providerName in @($cfg.models.providers.PSObject.Properties.Name)) {
        if ($providerName -like "ollama*") {
            [string]$providerName
        }
    }
)
$ollamaEntries = @(
    foreach ($providerName in $localProviderIds) {
        foreach ($model in @($cfg.models.providers.$providerName.models)) {
            [pscustomobject]@{
                providerId = $providerName
                id         = [string]$model.id
                name       = [string]$model.name
                input      = @($model.input)
            }
        }
    }
)

if ($ollamaEntries.Count -eq 0) {
    $skipResult = [pscustomobject]@{
        status   = "skip"
        agentId  = $AgentId
        modelRef = ""
        category = "disabled"
        detail   = "No configured Ollama models."
    }
    Write-Output "Local model smoke test skipped: no configured Ollama models."
    Write-Output "__SMOKE_JSON__: $(ConvertTo-Json $skipResult -Compress)"
    exit 0
}

$modelPlan = Resolve-UsableLocalSmokeModel -BootstrapConfig $bootstrapConfig -LiveConfig $cfg -ProviderEntries $ollamaEntries -AgentId $AgentId
if ($modelPlan.status -eq "skip") {
    $skipResult = [pscustomobject]@{
        status   = "skip"
        agentId  = $AgentId
        modelRef = ""
        category = "fit"
        detail   = [string]$modelPlan.detail
    }
    Write-Output "Local model smoke test skipped: $($modelPlan.detail)"
    Write-Output "__SMOKE_JSON__: $(ConvertTo-Json $skipResult -Compress)"
    exit 0
}

$targetModelRef = [string]$modelPlan.modelRef
$targetModelId = Get-ToolkitModelIdFromRef -ModelRef $targetModelRef
$sessionId = "smoke-localmodel-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-ProgressLine "Using container $ContainerName" Cyan
Write-ProgressLine "Agent $AgentId will target $targetModelRef" Cyan
Write-ProgressLine "Session $sessionId with timeout ${TimeoutSeconds}s" Cyan
Add-ToolkitVerificationCleanupModelRef -ModelRef $targetModelRef | Out-Null

try {
    Write-ProgressLine "Resetting session state" Gray
    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", "/reset",
        "--timeout", "60",
        "--json"
    ) -AllowFailure

    Write-ProgressLine "Switching agent to $targetModelRef" Gray
    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", "/model $targetModelRef",
        "--timeout", "60",
        "--json"
    )

    Write-ProgressLine "Sending exact-match reply check to the agent" Gray
    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", "Reply with exactly LOCAL_MODEL_OK and nothing else.",
        "--timeout", [string]$TimeoutSeconds,
        "--json"
    )

    Write-ProgressLine "Parsing OpenClaw JSON result" Gray
    $json = $result.Output | ConvertFrom-Json
    $payloadText = [string]$json.result.payloads[0].text
    $provider = [string]$json.result.meta.agentMeta.provider
    $model = [string]$json.result.meta.agentMeta.model
    Add-ToolkitVerificationCleanupModelRef -ModelRef ($provider + '/' + $model) | Out-Null

    if ($provider -notlike "ollama*") {
        throw "Expected provider 'ollama*' but got '$provider'."
    }
    if ($payloadText.Trim() -ne "LOCAL_MODEL_OK") {
        throw "Expected LOCAL_MODEL_OK but got: $payloadText"
    }

    @(
        "Local model smoke test passed."
        "Agent: $AgentId"
        "Configured model for ${AgentId}: $targetModelRef"
        "Observed model for ${AgentId}: $provider/$model"
        "Reply: $payloadText"
        "__SMOKE_JSON__: $(ConvertTo-Json ([pscustomobject]@{status='pass';agentId=$AgentId;modelRef=$targetModelRef;runtime=($provider + '/' + $model);category='';detail='Local model replied correctly.'}) -Compress)"
    ) | Write-Output
}
catch {
    $message = Get-ErrorMessage -ErrorRecord $_
    $category = Get-ErrorCategory -Message $message
    @(
        "Local model smoke test failed."
        "Agent: $AgentId"
        "Configured model for ${AgentId}: $targetModelRef"
        "Category: $category"
        $message
        "__SMOKE_JSON__: $(ConvertTo-Json ([pscustomobject]@{status='fail';agentId=$AgentId;modelRef=$targetModelRef;runtime='';category=$category;detail=$message}) -Compress)"
    ) | Write-Output
    throw
}
finally {
    Stop-OllamaModel -ModelId $targetModelId
}
