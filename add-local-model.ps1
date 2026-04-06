[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Model,
    [string]$Name,
    [string]$EndpointKey,
    [string[]]$InputKinds = @("text"),
    [switch]$Reasoning,
    [int]$MaxTokens = 8192,
    [int]$StartContextWindow = 4096,
    [int]$ContextStep = 20480,
    [int]$MaxContextWindow = 262144,
    [int]$HeadroomMiB = 1536,
    [int]$MinimumContextWindow = 24576,
    [double]$RawSizeLimitRatio = 0.70,
    [string]$FallbackModel,
    [string]$AssignTo,
    [string]$ConfigPath,
    [switch]$SkipBootstrap,
    [string[]]$Contexts
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

function Normalize-InputKinds {
    param([string[]]$Values)

    $normalized = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($Values)) {
        foreach ($token in @([string]$value -split '[,\s;]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
            $kind = $token.Trim().ToLowerInvariant()
            if ($kind -notin @("text", "image")) {
                throw "Unsupported input kind '$token'. Allowed values: text, image"
            }
            if ($kind -notin @($normalized)) {
                $normalized.Add($kind)
            }
        }
    }

    if ($normalized.Count -eq 0) {
        $normalized.Add("text")
    }

    return @($normalized)
}

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

function Invoke-OllamaCli {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "The 'ollama' CLI is required."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        $output = & $command.Source @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }

    $text = (@($output) | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): ollama $($Arguments -join ' ')`n$text"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Invoke-OllamaCliStreaming {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "The 'ollama' CLI is required."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        & $command.Source @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }

    if ($exitCode -ne 0) {
        throw "Command failed ($exitCode): ollama $($Arguments -join ' ')"
    }
}

function Get-LocalGpuSnapshot {
    $query = & nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits 2>$null
    if (-not $query) {
        throw "Could not query nvidia-smi."
    }

    $firstLine = @($query)[0]
    $parts = @($firstLine -split ',') | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 3) {
        throw "Could not parse nvidia-smi output."
    }

    return [pscustomobject]@{
        Name     = [string]$parts[0]
        TotalMiB = [int]$parts[1]
        UsedMiB  = [int]$parts[2]
    }
}

function Get-EndpointGpuTotalMiB {
    param([Parameter(Mandatory = $true)]$Endpoint)

    $telemetry = if ($Endpoint.PSObject.Properties.Name -contains "telemetry") { $Endpoint.telemetry } else { $null }
    $kind = if ($telemetry -and $telemetry.PSObject.Properties.Name -contains "kind" -and $telemetry.kind) {
        ([string]$telemetry.kind).ToLowerInvariant()
    }
    else {
        "local-nvidia-smi"
    }

    switch ($kind) {
        "local-nvidia-smi" { return [int](Get-LocalGpuSnapshot).TotalMiB }
        "static-gpu-total" {
            if (-not $telemetry.gpuTotalMiB) {
                throw "Endpoint '$($Endpoint.key)' has no telemetry.gpuTotalMiB configured."
            }
            return [int]$telemetry.gpuTotalMiB
        }
        default {
            throw "Unsupported telemetry kind '$kind' for endpoint '$($Endpoint.key)'."
        }
    }
}

function Get-EndpointDiskFreeBytes {
    param([Parameter(Mandatory = $true)]$Endpoint)

    $telemetry = if ($Endpoint.PSObject.Properties.Name -contains "telemetry") { $Endpoint.telemetry } else { $null }
    $kind = if ($telemetry -and $telemetry.PSObject.Properties.Name -contains "kind" -and $telemetry.kind) {
        ([string]$telemetry.kind).ToLowerInvariant()
    }
    else {
        "local-nvidia-smi"
    }

    switch ($kind) {
        "local-nvidia-smi" {
            $ollamaRoot = Join-Path $env:USERPROFILE ".ollama"
            $drive = (Get-Item -LiteralPath $ollamaRoot).PSDrive
            return [int64]$drive.Free
        }
        "static-gpu-total" {
            if ($telemetry.PSObject.Properties.Name -contains "diskFreeBytes" -and $telemetry.diskFreeBytes) {
                return [int64]$telemetry.diskFreeBytes
            }
            return $null
        }
        default {
            throw "Unsupported telemetry kind '$kind' for endpoint '$($Endpoint.key)'."
        }
    }
}

function Get-OllamaInstalledIds {
    param([Parameter(Mandatory = $true)]$Endpoint)

    $result = Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("list") -AllowFailure
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return @()
    }

    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($result.Output -split "(`r`n|`n|`r)")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed -match '^NAME\s+') {
            continue
        }

        $name = ($trimmed -replace '\s{2,}.*$', '')
        if ($name) {
            $ids.Add($name)
        }
    }

    return @($ids | Select-Object -Unique)
}

function Get-OllamaRegistryManifest {
    param([Parameter(Mandatory = $true)][string]$ModelId)

    $parts = $ModelId -split ':', 2
    $repo = $parts[0]
    $tag = if ($parts.Count -gt 1) { $parts[1] } else { "latest" }
    if ($repo -notmatch "/") {
        $repo = "library/$repo"
    }

    $url = "https://registry.ollama.ai/v2/$repo/manifests/$tag"
    $result = Invoke-External -FilePath "curl.exe" -Arguments @("-fsS", $url) -AllowFailure
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        throw "Could not fetch Ollama registry manifest for $ModelId from $url"
    }

    return ($result.Output | ConvertFrom-Json -Depth 20)
}

function Get-OllamaRegistryModelSizeBytes {
    param([Parameter(Mandatory = $true)][string]$ModelId)

    $manifest = Get-OllamaRegistryManifest -ModelId $ModelId
    $sum = [int64]0
    foreach ($layer in @($manifest.layers)) {
        if ($layer.size) {
            $sum += [int64]$layer.size
        }
    }
    return $sum
}

function Set-AgentLocalModel {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$TargetAgentId,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [Parameter(Mandatory = $true)][string]$EndpointKey
    )

    $mapping = @{
        "chat-local"    = "localChatAgent"
        "review-local"  = "localReviewAgent"
        "coder-local"   = "localCoderAgent"
        "review-remote" = "remoteReviewAgent"
        "coder-remote"  = "remoteCoderAgent"
    }

    if (-not $mapping.ContainsKey($TargetAgentId)) {
        throw "Unknown local agent id for -AssignTo: $TargetAgentId"
    }

    $propertyName = $mapping[$TargetAgentId]
    $agent = $Config.multiAgent.$propertyName
    if ($null -eq $agent) {
        throw "Config does not contain multiAgent.$propertyName"
    }

    $agent.modelSource = "local"
    $agent.endpointKey = $EndpointKey
    $agent.modelRef = "ollama/$ModelId"
    return $true
}

function New-ManagedEndpointModelEntry {
    param(
        $ExistingEntry,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [string[]]$Inputs = @("text"),
        [switch]$ReasoningModel,
        [Parameter(Mandatory = $true)][int]$ContextWindow,
        [Parameter(Mandatory = $true)][int]$MaxTokensValue,
        [int]$MinimumContextWindowValue = 24576,
        [string]$FallbackModelId
    )

    $entry = [ordered]@{}
    if ($null -ne $ExistingEntry) {
        foreach ($property in $ExistingEntry.PSObject.Properties) {
            $entry[$property.Name] = $property.Value
        }
    }

    $entry.id = $ModelId
    $entry.name = $DisplayName
    $entry.input = @($Inputs)
    $entry.cost = [ordered]@{
        input      = 0
        output     = 0
        cacheRead  = 0
        cacheWrite = 0
    }
    $entry.minimumContextWindow = $MinimumContextWindowValue
    $entry.contextWindow = $ContextWindow
    $entry.maxTokens = $MaxTokensValue

    if ($ReasoningModel) {
        $entry.reasoning = $true
    }
    elseif ($entry.Contains("reasoning")) {
        $entry.Remove("reasoning")
    }

    if (-not [string]::IsNullOrWhiteSpace($FallbackModelId)) {
        $entry.fallbackModelId = $FallbackModelId
    }
    elseif ($entry.Contains("fallbackModelId")) {
        $entry.Remove("fallbackModelId")
    }

    return [pscustomobject]$entry
}

function Set-EndpointModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$EndpointKey,
        [Parameter(Mandatory = $true)]$ModelEntry
    )

    foreach ($endpoint in @($Config.ollama.endpoints)) {
        if ([string]$endpoint.key -ne $EndpointKey) {
            continue
        }

        if (-not ($endpoint.PSObject.Properties.Name -contains "models")) {
            $endpoint | Add-Member -NotePropertyName models -NotePropertyValue @()
        }

        $models = New-Object System.Collections.Generic.List[object]
        $replaced = $false
        foreach ($existingModel in @($endpoint.models)) {
            if ($existingModel -and [string]$existingModel.id -eq [string]$ModelEntry.id) {
                $models.Add($ModelEntry)
                $replaced = $true
            }
            elseif ($existingModel) {
                $models.Add($existingModel)
            }
        }
        if (-not $replaced) {
            $models.Add($ModelEntry)
        }

        $endpoint.models = $models.ToArray()
        if ($endpoint.PSObject.Properties.Name -contains "desiredModelIds") {
            $null = $endpoint.PSObject.Properties.Remove("desiredModelIds")
        }
        if ($endpoint.PSObject.Properties.Name -contains "modelOverrides") {
            $null = $endpoint.PSObject.Properties.Remove("modelOverrides")
        }
        return
    }

    throw "Could not find endpoint '$EndpointKey' while writing model entry."
}

function Resolve-ConfiguredFallbackModelId {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$EndpointKey,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$ExplicitFallbackModel
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitFallbackModel)) {
        return $ExplicitFallbackModel
    }

    $entry = Get-ToolkitEffectiveLocalModelEntry -Config $Config -ModelId $ModelId -EndpointKey $EndpointKey
    if ($entry -and $entry.PSObject.Properties.Name -contains "fallbackModelId" -and $entry.fallbackModelId) {
        return [string]$entry.fallbackModelId
    }

    return $null
}

function Resolve-UpperContextBound {
    param(
        [int]$RequestedMaxContextWindow,
        [string[]]$LegacyContexts
    )

    $maxValue = [int]$RequestedMaxContextWindow
    foreach ($entry in @($LegacyContexts)) {
        foreach ($piece in @($entry -split '[,;\s]+')) {
            if (-not $piece) { continue }
            $parsed = 0
            if ([int]::TryParse($piece, [ref]$parsed) -and $parsed -gt $maxValue) {
                $maxValue = $parsed
            }
        }
    }

    return $maxValue
}

function Resolve-ModelPlan {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string]$ModelId,
        [string]$DisplayName,
        [string]$FallbackModelId,
        [bool]$AlreadyInstalled,
        [System.Collections.Generic.HashSet[string]]$Visited
    )

    if ($Visited.Contains($ModelId)) {
        throw "Fallback loop detected while resolving local model plan: $ModelId"
    }
    $Visited.Add($ModelId) | Out-Null

    $gpuTotalMiB = Get-EndpointGpuTotalMiB -Endpoint $Endpoint
    $rawBytes = Get-OllamaRegistryModelSizeBytes -ModelId $ModelId
    $rawMiB = [int][math]::Ceiling($rawBytes / 1MB)
    $rawLimitMiB = [int][math]::Floor($gpuTotalMiB * $RawSizeLimitRatio)
    $diskFreeBytes = $null
    $requiredDiskBytes = [int64][math]::Ceiling($rawBytes * 1.10)

    if ($rawMiB -gt $rawLimitMiB) {
        if ($FallbackModelId) {
            Write-Warning "Skipping $ModelId on endpoint '$($Endpoint.key)': raw size ${rawMiB}MiB exceeds 70% VRAM threshold (${rawLimitMiB}MiB). Falling back to $FallbackModelId."
            return (Resolve-ModelPlan -Config $Config -Endpoint $Endpoint -ModelId $FallbackModelId -DisplayName $DisplayName -FallbackModelId (Resolve-ConfiguredFallbackModelId -Config $Config -EndpointKey $Endpoint.key -ModelId $FallbackModelId) -AlreadyInstalled:$false -Visited $Visited)
        }

        throw "Model '$ModelId' raw size ${rawMiB}MiB exceeds 70% of endpoint GPU VRAM (${rawLimitMiB}MiB). Configure a smaller fallback model."
    }

    if (-not $AlreadyInstalled) {
        $diskFreeBytes = Get-EndpointDiskFreeBytes -Endpoint $Endpoint
        if ($null -eq $diskFreeBytes) {
            Write-Warning "Endpoint '$($Endpoint.key)' does not expose free-disk telemetry. Skipping pre-pull disk check for $ModelId."
        }
        elseif ($diskFreeBytes -lt $requiredDiskBytes) {
            throw "Endpoint '$($Endpoint.key)' has insufficient free disk for $ModelId. Need about $([math]::Round($requiredDiskBytes / 1GB, 2)) GB, free is $([math]::Round($diskFreeBytes / 1GB, 2)) GB."
        }
    }

    return [pscustomobject]@{
        ModelId     = $ModelId
        DisplayName = if ([string]::IsNullOrWhiteSpace($DisplayName)) { $ModelId } else { $DisplayName }
        RawBytes    = [int64]$rawBytes
        RawMiB      = [int]$rawMiB
        GpuTotalMiB = [int]$gpuTotalMiB
    }
}

if (-not (Get-Command "ollama" -ErrorAction SilentlyContinue)) {
    throw "The 'ollama' CLI is required."
}
if (-not (Get-Command "pwsh" -ErrorAction SilentlyContinue)) {
    throw "PowerShell 7 (pwsh) is required for add-local-model."
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$InputKinds = @(Normalize-InputKinds -Values $InputKinds)
$endpoint = Get-ToolkitOllamaEndpoint -Config $config -EndpointKey $EndpointKey
if ($null -eq $endpoint) {
    throw "Unknown Ollama endpoint key: $EndpointKey"
}
$installed = @(Get-OllamaInstalledIds -Endpoint $endpoint)
$alreadyInstalled = $Model -in $installed

$upperContextBound = Resolve-UpperContextBound -RequestedMaxContextWindow $MaxContextWindow -LegacyContexts $Contexts
$visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$fallbackModelId = Resolve-ConfiguredFallbackModelId -Config $config -EndpointKey $endpoint.key -ModelId $Model -ExplicitFallbackModel $FallbackModel
$plan = Resolve-ModelPlan -Config $config -Endpoint $endpoint -ModelId $Model -DisplayName $Name -FallbackModelId $fallbackModelId -AlreadyInstalled:$alreadyInstalled -Visited $visited

if ($plan.ModelId -notin $installed) {
    Write-Step "Pulling Ollama model $($plan.ModelId) on endpoint $($endpoint.key)"
    Invoke-OllamaCliStreaming -Endpoint $endpoint -Arguments @("pull", $plan.ModelId)
}
else {
    Write-Host "Ollama model $($plan.ModelId) is already installed on endpoint $($endpoint.key)." -ForegroundColor Green
}

$probeScript = Join-Path (Split-Path -Parent $PSCommandPath) "probe-ollama-gpu-fit.ps1"
Write-Step "Probing GPU-fit context for $($plan.ModelId) on $($endpoint.key)"
$probeOutput = & $probeScript -Model $plan.ModelId -EndpointKey $endpoint.key -ConfigPath $ConfigPath -StartContextWindow $StartContextWindow -ContextStep $ContextStep -MaxContextWindow $upperContextBound -HeadroomMiB $HeadroomMiB -MinimumContextWindow $MinimumContextWindow -Json
if (-not $probeOutput) {
    throw "Model probe returned no output."
}

$probeJsonLine = @($probeOutput) |
Where-Object { $_ -is [string] } |
ForEach-Object { $_.Trim() } |
Where-Object { $_ -match '^\{.*\}$' } |
Select-Object -Last 1

if (-not $probeJsonLine) {
    $debugText = (@($probeOutput) | ForEach-Object { "$_" }) -join [Environment]::NewLine
    throw "Could not find JSON summary in model probe output.`n$debugText"
}

$probeResult = $probeJsonLine | ConvertFrom-Json -Depth 20
$selectedContextWindow = if ($null -ne $probeResult.selectedContextWindow) { [int]$probeResult.selectedContextWindow } else { $null }

if ($null -eq $selectedContextWindow -or $selectedContextWindow -lt $MinimumContextWindow) {
    $finalFallback = Resolve-ConfiguredFallbackModelId -Config $config -EndpointKey $endpoint.key -ModelId $plan.ModelId -ExplicitFallbackModel $FallbackModel
    if ($finalFallback -and $finalFallback -ne $plan.ModelId) {
        Write-Warning "Model '$($plan.ModelId)' did not fit with a useful context on endpoint '$($endpoint.key)'. Falling back to '$finalFallback'."
        & $PSCommandPath -Model $finalFallback -Name $Name -EndpointKey $endpoint.key -InputKinds $InputKinds -Reasoning:$Reasoning -MaxTokens $MaxTokens -StartContextWindow $StartContextWindow -ContextStep $ContextStep -MaxContextWindow $upperContextBound -HeadroomMiB $HeadroomMiB -MinimumContextWindow $MinimumContextWindow -RawSizeLimitRatio $RawSizeLimitRatio -AssignTo $AssignTo -ConfigPath $ConfigPath -SkipBootstrap:$SkipBootstrap
        exit $LASTEXITCODE
    }

    if ($null -eq $selectedContextWindow) {
        throw "No tested context met the full-GPU + headroom rule for $($plan.ModelId) on endpoint '$($endpoint.key)'."
    }

    throw "Model '$($plan.ModelId)' only fit with contextWindow=$selectedContextWindow, which is below the minimum useful threshold of $MinimumContextWindow."
}

$existingEntry = Get-ToolkitEffectiveLocalModelEntry -Config $config -ModelId $plan.ModelId -EndpointKey $endpoint.key
$newEntry = New-ManagedEndpointModelEntry -ExistingEntry $existingEntry -ModelId $plan.ModelId -DisplayName $plan.DisplayName -Inputs $InputKinds -ReasoningModel:$Reasoning -ContextWindow $selectedContextWindow -MaxTokensValue $MaxTokens -MinimumContextWindowValue $MinimumContextWindow -FallbackModelId $fallbackModelId

Write-Step "Updating bootstrap config"
Set-EndpointModelEntry -Config $config -EndpointKey $endpoint.key -ModelEntry $newEntry

$assigned = $false
if ($AssignTo) {
    $assigned = Set-AgentLocalModel -Config $config -TargetAgentId $AssignTo -ModelId $plan.ModelId -EndpointKey $endpoint.key
}

$json = $config | ConvertTo-Json -Depth 50
Set-Content -Path $ConfigPath -Value $json -Encoding UTF8

Write-Host "Updated bootstrap config for $($endpoint.providerId)/$($plan.ModelId) with contextWindow=$selectedContextWindow and maxTokens=$MaxTokens." -ForegroundColor Green
if ($assigned) {
    Write-Host "Assigned $($endpoint.providerId)/$($plan.ModelId) to agent $AssignTo on endpoint $($endpoint.key)." -ForegroundColor Green
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
}
