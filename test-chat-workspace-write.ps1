[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$ConfigPath,
    [string]$AgentId = "coder-local",
    [string]$WorkspaceHostPath = (Join-Path $env:USERPROFILE ".openclaw\\workspace"),
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[tooling-write] $Message" -ForegroundColor $Color
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

function Stop-OllamaModelFromRef {
    param([string]$ModelRef)

    if ([string]::IsNullOrWhiteSpace($ModelRef) -or $ModelRef -notmatch '^[^/]+/.+$') {
        return
    }

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        Write-ProgressLine "Skipping unload because ollama CLI is not available on the host" Yellow
        return
    }

    $providerId, $modelId = $ModelRef -split '/', 2
    if ([string]::IsNullOrWhiteSpace($modelId)) {
        return
    }

    if ($null -eq $script:BootstrapConfig) {
        if ($providerId -ne "ollama") {
            return
        }
    }
    else {
        $endpoint = Get-ToolkitOllamaEndpointByProviderId -Config $script:BootstrapConfig -ProviderId $providerId
        if ($null -eq $endpoint) {
            return
        }
        $oldHost = $env:OLLAMA_HOST
        try {
            $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint
            Write-ProgressLine "Stopping Ollama model $modelId to free GPU memory" Gray
            $stopResult = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $modelId) -AllowFailure
        }
        finally {
            if ($null -eq $oldHost) {
                Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
            }
            else {
                $env:OLLAMA_HOST = $oldHost
            }
        }
        if ($stopResult.ExitCode -eq 0) {
            Write-ProgressLine "Ollama model $modelId stopped" Green
        }
        else {
            Write-ProgressLine "Ollama stop for $modelId returned exit code $($stopResult.ExitCode)" Yellow
        }
        return
    }

    Write-ProgressLine "Stopping Ollama model $modelId to free GPU memory" Gray
    $stopResult = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $modelId) -AllowFailure
    if ($stopResult.ExitCode -eq 0) {
        Write-ProgressLine "Ollama model $modelId stopped" Green
    }
    else {
        Write-ProgressLine "Ollama stop for $modelId returned exit code $($stopResult.ExitCode)" Yellow
    }
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

function Get-AgentModelCandidateRefs {
    param(
        [Parameter(Mandatory = $true)]$LiveConfig,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    $refs = @()
    $agent = @($LiveConfig.agents.list) | Where-Object { $_.id -eq $AgentId } | Select-Object -First 1
    if ($agent -and $agent.model) {
        if ($agent.model.primary) {
            $refs = Add-UniqueString -List $refs -Value ([string]$agent.model.primary)
        }
        foreach ($fallbackRef in @($agent.model.fallbacks)) {
            $refs = Add-UniqueString -List $refs -Value ([string]$fallbackRef)
        }
    }

    return @($refs)
}

function Get-AgentSmokeModelPlan {
    param(
        [Parameter(Mandatory = $true)]$BootstrapConfig,
        [Parameter(Mandatory = $true)]$LiveConfig,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    $candidateRefs = @(Get-AgentModelCandidateRefs -LiveConfig $LiveConfig -AgentId $AgentId)
    if (@($candidateRefs).Count -eq 0) {
        return [pscustomobject]@{
            status           = "pass"
            modelOverrideRef = $null
            detail           = ""
        }
    }

    $primaryRef = [string]$candidateRefs[0]
    $unusableReasons = @()
    foreach ($candidateRef in @($candidateRefs)) {
        if ($candidateRef -notlike "ollama*/*") {
            return [pscustomobject]@{
                status           = "pass"
                modelOverrideRef = $null
                detail           = ""
            }
        }

        $status = Get-ToolkitLocalModelRefRuntimeStatus -Config $BootstrapConfig -ModelRef ([string]$candidateRef)
        if ($status.usable) {
            return [pscustomobject]@{
                status           = "pass"
                modelOverrideRef = if ([string]$candidateRef -ne $primaryRef) { [string]$candidateRef } else { $null }
                detail           = if ([string]$candidateRef -ne $primaryRef) { "Switching smoke session from $primaryRef to usable fallback $candidateRef." } else { "" }
            }
        }

        if ($status.isLocal -and -not [string]::IsNullOrWhiteSpace([string]$status.reason)) {
            $unusableReasons = Add-UniqueString -List $unusableReasons -Value ([string]$status.reason)
        }
    }

    return [pscustomobject]@{
        status           = "skip"
        modelOverrideRef = $null
        detail           = if (@($unusableReasons).Count -gt 0) {
            "No endpoint-defined local runtime candidate currently fits for $AgentId. $(@($unusableReasons) -join ' ')"
        }
        else {
            "No endpoint-defined runtime candidate currently fits for $AgentId."
        }
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the tooling workspace write smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$script:BootstrapConfig = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$script:BootstrapConfig = Resolve-PortableConfigPaths -Config $script:BootstrapConfig -BaseDir (Split-Path -Parent $ConfigPath)
$hostConfigPath = Join-Path (Get-HostConfigDir -Config $script:BootstrapConfig) "openclaw.json"
if (-not (Test-Path $hostConfigPath)) {
    throw "Live OpenClaw config not found at $hostConfigPath"
}
$liveConfig = Get-Content -Raw $hostConfigPath | ConvertFrom-Json -Depth 50

if (-not (Test-Path $WorkspaceHostPath)) {
    throw "Workspace host path does not exist: $WorkspaceHostPath"
}

$probeId = "verify-tooling-write-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$sessionId = "smoke-$probeId"
$probeFileName = "$probeId.txt"
$probePath = Join-Path $WorkspaceHostPath $probeFileName
$runtimeModelRef = ""
$modelPlan = Get-AgentSmokeModelPlan -BootstrapConfig $script:BootstrapConfig -LiveConfig $liveConfig -AgentId $AgentId
$targetModelRef = if ($modelPlan.modelOverrideRef) {
    [string]$modelPlan.modelOverrideRef
}
else {
    [string](@(Get-AgentModelCandidateRefs -LiveConfig $liveConfig -AgentId $AgentId) | Select-Object -First 1)
}

Write-ProgressLine "Using agent $AgentId in session $sessionId" Cyan
Write-ProgressLine "Workspace host path: $WorkspaceHostPath" Cyan
Add-ToolkitVerificationCleanupModelRef -ModelRef $targetModelRef | Out-Null

if (Test-Path $probePath) {
    Remove-Item -LiteralPath $probePath -Recurse -Force
}

if ($modelPlan.status -eq "skip") {
    @(
        "Tooling workspace write smoke test skipped."
        "Agent: $AgentId"
        $modelPlan.detail
        "__SMOKE_JSON__: $(ConvertTo-Json ([pscustomobject]@{status='skip';agentId=$AgentId;runtime='';category='fit';detail=$modelPlan.detail}) -Compress)"
    ) | Write-Output
    exit 0
}

try {
    Write-ProgressLine "Resetting agent session state" Gray
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

    if ($modelPlan.modelOverrideRef) {
        Write-ProgressLine $modelPlan.detail DarkGray
        $null = Invoke-External -FilePath "docker" -Arguments @(
            "exec", $ContainerName,
            "node", "dist/index.js",
            "agent",
            "--agent", $AgentId,
            "--session-id", $sessionId,
            "--message", "/model $($modelPlan.modelOverrideRef)",
            "--timeout", "60",
            "--json"
        )
    }

    $instruction = "Use the write tool to create a file named $probeFileName in your current workspace with exactly this content: smoke-ok. Then reply with only the absolute path to that file and nothing else."
    Write-ProgressLine "Prompting agent to create a file in its workspace" Gray
    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", $instruction,
        "--timeout", [string]$TimeoutSeconds,
        "--json"
    )

    Write-ProgressLine "Parsing OpenClaw JSON result" Gray
    $json = $result.Output | ConvertFrom-Json -Depth 50
    $payloadText = [string]$json.result.payloads[0].text
    $sandboxed = [bool]$json.result.meta.systemPromptReport.sandbox.sandboxed
    $provider = [string]$json.result.meta.agentMeta.provider
    $model = [string]$json.result.meta.agentMeta.model
    $runtimeModelRef = if ([string]::IsNullOrWhiteSpace($provider) -or [string]::IsNullOrWhiteSpace($model)) { "" } else { "$provider/$model" }
    Add-ToolkitVerificationCleanupModelRef -ModelRef $runtimeModelRef | Out-Null

    if ($sandboxed) {
        throw "Expected $AgentId to run unsandboxed for writable shared workspace access."
    }

    if (-not (Test-Path $probePath)) {
        throw "Expected file was not created at $probePath. Agent reply was: $payloadText"
    }

    $fileContents = (Get-Content -Raw $probePath).Trim()
    if ($fileContents -ne "smoke-ok") {
        throw "Expected file contents 'smoke-ok' at $probePath but found '$fileContents'. Agent reply was: $payloadText"
    }

    Remove-Item -LiteralPath $probePath -Force

    @(
        "Tooling workspace write smoke test passed."
        "Agent: $AgentId"
        "Configured model for ${AgentId}: $targetModelRef"
        "Observed model for ${AgentId}: $runtimeModelRef"
        "Sandboxed: $sandboxed"
        "Created and removed: $probePath"
        "Reply: $payloadText"
        "__SMOKE_JSON__: $(ConvertTo-Json ([pscustomobject]@{status='pass';agentId=$AgentId;runtime=$runtimeModelRef;category='';detail='Tooling workspace write smoke test passed.'}) -Compress)"
    ) | Write-Output
}
catch {
    $message = Get-ErrorMessage -ErrorRecord $_
    @(
        "Tooling workspace write smoke test failed."
        "Agent: $AgentId"
        "Configured model for ${AgentId}: $targetModelRef"
        "Observed model for ${AgentId}: $runtimeModelRef"
        $message
        "__SMOKE_JSON__: $(ConvertTo-Json ([pscustomobject]@{status='fail';agentId=$AgentId;runtime=$runtimeModelRef;category='task';detail=$message}) -Compress)"
    ) | Write-Output
    throw
}
finally {
    if (Test-Path $probePath) {
        Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }

    Stop-OllamaModelFromRef -ModelRef $runtimeModelRef
}
