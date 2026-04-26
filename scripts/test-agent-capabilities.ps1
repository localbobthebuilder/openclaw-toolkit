[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$ConfigPath,
    [string]$WorkspaceHostPath,
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

    Write-Host "[agent-smoke] $Message" -ForegroundColor $Color
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

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-HostWorkspaceDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostWorkspaceDir" -and $Config.hostWorkspaceDir) {
        return [string]$Config.hostWorkspaceDir
    }

    return (Join-Path (Get-HostConfigDir -Config $Config) "workspace")
}

function Resolve-HostWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$WorkspacePath
    )

    $hostConfigDir = Get-HostConfigDir -Config $Config
    $hostWorkspaceDir = Get-HostWorkspaceDir -Config $Config
    $defaultContainerWorkspace = "/home/node/.openclaw/workspace"
    $containerHomeRoot = "/home/node/.openclaw"

    if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or $WorkspacePath -eq $defaultContainerWorkspace) {
        return $hostWorkspaceDir
    }

    if ($WorkspacePath.StartsWith($containerHomeRoot + "/")) {
        $relative = $WorkspacePath.Substring(($containerHomeRoot + "/").Length) -replace '/', '\'
        return (Join-Path $hostConfigDir $relative)
    }

    return $hostWorkspaceDir
}

function Invoke-AgentTurn {
    param(
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$SessionId,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$ModelOverrideRef,
        [string]$ThinkingLevel,
        [int]$Timeout = 180
    )

    if (-not [string]::IsNullOrWhiteSpace($ModelOverrideRef)) {
        $switchResult = Invoke-External -FilePath "docker" -Arguments @(
            "exec", $ContainerName,
            "openclaw",
            "agent",
            "--agent", $AgentId,
            "--session-id", $SessionId,
            "--message", "/model $ModelOverrideRef",
            "--timeout", "60",
            "--json"
        )
        $switchJson = $switchResult.Output | ConvertFrom-Json -Depth 50
        if ($switchJson.status -ne "ok") {
            throw "Agent model switch for '$AgentId' to '$ModelOverrideRef' did not return status ok."
        }
    }

    $arguments = @(
        "exec", $ContainerName,
        "openclaw",
        "agent",
        "--agent", $AgentId,
        "--session-id", $SessionId,
        "--message", $Message,
        "--timeout", [string]$Timeout,
        "--json"
    )
    if (-not [string]::IsNullOrWhiteSpace($ThinkingLevel)) {
        $arguments += @("--thinking", $ThinkingLevel)
    }

    $result = Invoke-External -FilePath "docker" -Arguments $arguments

    $json = $result.Output | ConvertFrom-Json -Depth 50
    if ($json.status -ne "ok") {
        throw "Agent turn for '$AgentId' did not return status ok."
    }

    return $json
}

function Get-AgentReplyText {
    param([Parameter(Mandatory = $true)]$AgentJson)

    $finalVisibleText = [string]$AgentJson.result.meta.finalAssistantVisibleText
    if (-not [string]::IsNullOrWhiteSpace($finalVisibleText)) {
        return $finalVisibleText
    }

    $payloads = @($AgentJson.result.payloads)
    for ($idx = $payloads.Count - 1; $idx -ge 0; $idx--) {
        $payload = $payloads[$idx]
        if ($null -ne $payload -and $payload.PSObject.Properties.Name -contains "text" -and -not [string]::IsNullOrWhiteSpace([string]$payload.text)) {
            return [string]$payload.text
        }
    }

    return ""
}

function Get-AgentRuntimeRef {
    param([Parameter(Mandatory = $true)]$AgentJson)

    $provider = [string]$AgentJson.result.meta.agentMeta.provider
    $model = [string]$AgentJson.result.meta.agentMeta.model
    if ([string]::IsNullOrWhiteSpace($provider) -and [string]::IsNullOrWhiteSpace($model)) {
        return ""
    }

    return "$provider/$model"
}

function Get-AgentPrimaryModelRef {
    param(
        [Parameter(Mandatory = $true)]$LiveConfig,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    $agent = @($LiveConfig.agents.list) | Where-Object { $_.id -eq $AgentId } | Select-Object -First 1
    if ($agent -and $agent.model -and $agent.model.primary) {
        return [string]$agent.model.primary
    }

    if ($LiveConfig.agents.defaults -and $LiveConfig.agents.defaults.model -and $LiveConfig.agents.defaults.model.primary) {
        return [string]$LiveConfig.agents.defaults.model.primary
    }

    return ""
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

    if (@($refs).Count -eq 0 -and $LiveConfig.agents.defaults -and $LiveConfig.agents.defaults.model) {
        if ($LiveConfig.agents.defaults.model.primary) {
            $refs = Add-UniqueString -List $refs -Value ([string]$LiveConfig.agents.defaults.model.primary)
        }
        foreach ($fallbackRef in @($LiveConfig.agents.defaults.model.fallbacks)) {
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
    $hostedCandidates = @($candidateRefs | Where-Object { $_ -and $_ -notlike "ollama*/*" })
    if (@($hostedCandidates).Count -gt 0) {
        return [pscustomobject]@{
            status           = "pass"
            modelOverrideRef = $null
            detail           = ""
        }
    }

    $unusableReasons = @()
    foreach ($candidateRef in @($candidateRefs)) {
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
            "No usable local runtime candidate is available for $AgentId. $(@($unusableReasons) -join ' ')"
        }
        else {
            "No usable runtime candidate is available for $AgentId."
        }
    }
}

function Stop-OllamaModelFromRef {
    param([string]$ModelRef)

    if ([string]::IsNullOrWhiteSpace($ModelRef) -or $ModelRef -notlike "ollama/*") {
        return
    }

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        return
    }

    $modelId = $ModelRef.Substring("ollama/".Length)
    Write-ProgressLine "Stopping Ollama model $modelId to free GPU memory" DarkGray
    $null = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $modelId) -AllowFailure
}

function Normalize-SmokeSentence {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $normalized = $Text.Trim().ToLowerInvariant()
    $normalized = $normalized -replace '[\.\!\?]+$',''
    return $normalized
}

function Normalize-SmokeBlock {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $normalized = (($Text -replace "`r`n", "`n" -replace "`r", "`n").Trim())
    if ($normalized -match '(?s)^.*?```[a-zA-Z0-9_-]*\n(?<block>.*?)\n```$') {
        $normalized = $Matches.block.Trim()
    }

    return $normalized
}

function Normalize-GitStatusSmokeBlock {
    param([string]$Text)

    $normalized = Normalize-SmokeBlock -Text $Text
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return ""
    }

    $lines = @($normalized -split "`n")
    if ($lines.Count -gt 0) {
        $firstLine = $lines[0].Trim()
        if ($firstLine -match '^(##\s+)?No commits yet on ') {
            $lines[0] = ($firstLine -replace '^##\s+', '')
        }
    }

    return (($lines -join "`n").Trim())
}

function Get-SmokeDelimitedBlock {
    param(
        [string]$Text,
        [Parameter(Mandatory = $true)]
        [string]$BeginMarker,
        [Parameter(Mandatory = $true)]
        [string]$EndMarker
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $normalized = (($Text -replace "`r`n", "`n") -replace "`r", "`n")
    $pattern = "(?is)" + [regex]::Escape($BeginMarker) + "\s*\n?(?<block>.*?)\n?\s*" + [regex]::Escape($EndMarker)
    $match = [regex]::Match($normalized, $pattern)
    if (-not $match.Success) {
        return ""
    }

    return ([string]$match.Groups["block"].Value).Trim()
}

function Normalize-SingleLineSmokeReadback {
    param([string]$Text)

    $normalized = Normalize-SmokeBlock -Text $Text
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return ""
    }

    $lines = @(
        foreach ($line in @($normalized -split "`n")) {
            $trimmed = $line.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $trimmed
            }
        }
    )
    if ($lines.Count -eq 0) {
        return ""
    }

    if ($lines.Count -gt 1) {
        $firstLine = $lines[0]
        if ($firstLine -match '^(?:[A-Za-z]:\\|/).+\.(?:md|txt)$') {
            $lines = @($lines | Select-Object -Skip 1)
        }
    }

    if ($lines.Count -eq 0) {
        return ""
    }

    $candidate = [string]$lines[$lines.Count - 1]
    $candidate = $candidate -replace '^#\s+', ''
    return (Normalize-SmokeSentence -Text $candidate)
}

function Test-ResearchSmokeSuccess {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    $normalized = Normalize-SmokeBlock -Text $Text
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $false
    }

    $compact = $normalized.Trim()
    if ($compact.IndexOf("RESEARCH_OK", [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
    }

    return $compact.ToLowerInvariant().Contains("docs.openclaw.ai")
}

function Test-SmokeReplyContainsMarker {
    param(
        [string]$Text,
        [Parameter(Mandatory = $true)]
        [string]$Marker
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    $normalized = Normalize-SmokeBlock -Text $Text
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $false
    }

    return $normalized.IndexOf($Marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-ErrorCategory {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return "unknown"
    }

    $normalized = $Message.ToLowerInvariant()

    if ($normalized -match '429|resource_exhausted|quota|rate limit|too many requests') {
        return "provider-quota"
    }
    if ($normalized -match 'temporarily overloaded|overloaded|capacity|busy') {
        return "provider-capacity"
    }
    if ($normalized -match '401|403|unauthorized|forbidden|auth|api key|not authenticated|provider auth') {
        return "provider-auth"
    }
    if ($normalized -match 'gateway closed|service restart|container .+ is not running|econnrefused|timed out waiting for gateway|healthz') {
        return "gateway"
    }
    if ($normalized -match 'model.+not found|unknown model|no configured ollama models|could not resolve any ollama model') {
        return "model-missing"
    }
    if ($normalized -match 'does not support thinking|thinking.+not support|unsupported thinking') {
        return "model-thinking"
    }
    if ($normalized -match 'tool|exec|write|read|web_search|web_fetch') {
        return "tooling"
    }

    return "task"
}

function Get-FriendlyModelCapabilityFailureMessage {
    param(
        [string]$AgentId,
        [string]$TargetModelRef,
        [string]$Message
    )

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return $Message
    }

    $normalized = $Message.ToLowerInvariant()
    if ($normalized -match 'could not complete its smoke step because .+ was asked to use thinking') {
        return $Message
    }
    if ($normalized -notmatch 'does not support thinking|thinking.+not support|unsupported thinking') {
        return $Message
    }

    $agentLabel = if ([string]::IsNullOrWhiteSpace($AgentId)) { "This agent" } else { $AgentId }
    $modelLabel = if ([string]::IsNullOrWhiteSpace($TargetModelRef)) { "the configured model" } else { $TargetModelRef }
    return "$agentLabel could not complete its smoke step because $modelLabel was asked to use thinking, but that runtime rejected it. Choose a model that supports thinking for this role or clear the stale reasoning metadata for that model in the live OpenClaw config. Raw reply: $Message"
}

function Get-ErrorMessage {
    param($ErrorRecord)

    if ($null -ne $ErrorRecord -and $ErrorRecord.Exception -and -not [string]::IsNullOrWhiteSpace([string]$ErrorRecord.Exception.Message)) {
        return [string]$ErrorRecord.Exception.Message.Trim()
    }

    return ($ErrorRecord | Out-String).Trim()
}

function Resolve-AgentSmokeTargetModelRef {
    param(
        [string]$PrimaryModelRef,
        $ModelPlan
    )

    if ($null -ne $ModelPlan -and -not [string]::IsNullOrWhiteSpace([string]$ModelPlan.modelOverrideRef)) {
        return [string]$ModelPlan.modelOverrideRef
    }

    return [string]$PrimaryModelRef
}

function New-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$AgentId,
        [string]$TargetModel = "",
        [string]$Runtime = "",
        [string]$Category = "",
        [string]$Detail = ""
    )

    return [pscustomobject]@{
        name     = $Name
        status   = $Status
        agentId  = $AgentId
        targetModel = $TargetModel
        runtime  = $Runtime
        category = $Category
        detail   = $Detail
    }
}

function Get-SmokeRuntimeDetail {
    param(
        [string]$TargetModel,
        [string]$RuntimeModel,
        [string]$BaseDetail
    )

    if (-not [string]::IsNullOrWhiteSpace($TargetModel) -and
        -not [string]::IsNullOrWhiteSpace($RuntimeModel) -and
        $TargetModel -ne $RuntimeModel) {
        return "$BaseDetail OpenClaw model fallback/runtime switch observed: configured $TargetModel, ran $RuntimeModel. This usually means the configured model hit a retryable provider issue such as rate limit, quota, capacity, or timeout; check gateway logs for the exact provider error."
    }

    return $BaseDetail
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the agent capability smoke test."
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

$hostConfigPath = Join-Path (Get-HostConfigDir -Config $config) "openclaw.json"
if (-not (Test-Path $hostConfigPath)) {
    throw "Live OpenClaw config not found at $hostConfigPath"
}
$liveConfig = Get-Content -Raw $hostConfigPath | ConvertFrom-Json -Depth 50

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

if (-not $WorkspaceHostPath) {
    $primarySharedWorkspace = Get-ToolkitPrimarySharedWorkspace -Config $config
    $workspacePath = if ($null -ne $primarySharedWorkspace) {
        Get-ToolkitWorkspacePathValue -Workspace $primarySharedWorkspace -DefaultPath "/home/node/.openclaw/workspace"
    }
    else {
        "/home/node/.openclaw/workspace"
    }
    $WorkspaceHostPath = Resolve-HostWorkspacePath -Config $config -WorkspacePath $workspacePath
}

if (-not (Test-Path $WorkspaceHostPath)) {
    throw "Workspace host path does not exist: $WorkspaceHostPath"
}

$localChatAgentConfig = Get-ToolkitAgentByKey -Config $config -Key "localChatAgent"
$localReviewAgentConfig = Get-ToolkitAgentByKey -Config $config -Key "localReviewAgent"
$localCoderAgentConfig = Get-ToolkitAgentByKey -Config $config -Key "localCoderAgent"
$researchAgentConfig = Get-ToolkitAgentByKey -Config $config -Key "researchAgent"

$chatAgentId = if ($localChatAgentConfig -and $localChatAgentConfig.id) { [string]$localChatAgentConfig.id } else { "chat-local" }
$reviewAgentId = if ($localReviewAgentConfig -and $localReviewAgentConfig.id) { [string]$localReviewAgentConfig.id } else { "review-local" }
$coderAgentId = if ($localCoderAgentConfig -and $localCoderAgentConfig.id) { [string]$localCoderAgentConfig.id } else { "coder-local" }
$researchAgentId = if ($researchAgentConfig -and $researchAgentConfig.id) { [string]$researchAgentConfig.id } else { "research" }
$toolingAgentId = $coderAgentId

$chatAgentEnabled = [bool]($localChatAgentConfig -and $localChatAgentConfig.enabled)
$reviewAgentEnabled = [bool]($localReviewAgentConfig -and $localReviewAgentConfig.enabled)
$coderAgentEnabled = [bool]($localCoderAgentConfig -and $localCoderAgentConfig.enabled)
$researchAgentEnabled = [bool]($researchAgentConfig -and $researchAgentConfig.enabled)
$toolingAgentEnabled = $coderAgentEnabled

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$toolingRepoName = "tooling-smoke-$suffix"
$toolingRepoPath = Join-Path $WorkspaceHostPath $toolingRepoName
$coderProbeName = "coder-smoke-$suffix.txt"
$coderProbePath = Join-Path $WorkspaceHostPath $coderProbeName
$reviewProbeName = "review-smoke-$suffix.txt"
$reviewProbePath = Join-Path $WorkspaceHostPath $reviewProbeName

$outputLines = New-Object System.Collections.Generic.List[string]
$modelsToStop = New-Object System.Collections.Generic.List[string]
$failures = New-Object System.Collections.Generic.List[string]
$checkResults = New-Object System.Collections.Generic.List[object]

Write-ProgressLine "Workspace host path: $WorkspaceHostPath" Cyan
Write-ProgressLine "Tooling agent: $toolingAgentId" Cyan

try {
    if (Test-Path $toolingRepoPath) {
        Remove-Item -LiteralPath $toolingRepoPath -Recurse -Force
    }
    if (Test-Path $coderProbePath) {
        Remove-Item -LiteralPath $coderProbePath -Force
    }
    if (Test-Path $reviewProbePath) {
        Remove-Item -LiteralPath $reviewProbePath -Force
    }

    if ($toolingAgentEnabled) {
        $toolingModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $toolingAgentId
        if ($toolingModelRef) {
            $modelsToStop.Add($toolingModelRef)
        }
        $toolingModelPlan = Get-AgentSmokeModelPlan -BootstrapConfig $config -LiveConfig $liveConfig -AgentId $toolingAgentId
        $toolingTargetModelRef = Resolve-AgentSmokeTargetModelRef -PrimaryModelRef $toolingModelRef -ModelPlan $toolingModelPlan
        if ($toolingTargetModelRef) {
            Write-ProgressLine "[$toolingAgentId] Configured model: $toolingTargetModelRef" Cyan
            Add-ToolkitVerificationCleanupModelRef -ModelRef $toolingTargetModelRef | Out-Null
        }
        if ($toolingModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $toolingAgentId tooling smoke skipped because no endpoint-defined local model currently fits.")
            if ($toolingTargetModelRef) {
                $outputLines.Add("Target model: $toolingTargetModelRef")
            }
            $outputLines.Add($toolingModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "tooling" -Status "skip" -AgentId $toolingAgentId -TargetModel $toolingTargetModelRef -Category "fit" -Detail $toolingModelPlan.detail))
        }
        else {
        $toolingRuntime = ""
        try {
            if ($toolingModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$toolingModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($toolingModelPlan.detail)")
                Write-ProgressLine "[$toolingAgentId] Switching smoke session to $($toolingModelPlan.modelOverrideRef)" Gray
            }
            Write-ProgressLine "[$toolingAgentId] Initializing a real git repo in the shared workspace" Gray
            $toolingInit = Invoke-AgentTurn -AgentId $toolingAgentId -SessionId "smoke-tooling-init-$suffix" -Message "Run exactly one exec command with workdir /home/node/.openclaw/workspace: git init $toolingRepoName. After the command finishes, include marker INIT_OK in your visible reply." -ModelOverrideRef $toolingModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $toolingRuntime = Get-AgentRuntimeRef -AgentJson $toolingInit
            Add-ToolkitVerificationCleanupModelRef -ModelRef $toolingRuntime | Out-Null
            $toolingInitReply = (Get-AgentReplyText -AgentJson $toolingInit).Trim()
            if (-not (Test-Path (Join-Path $toolingRepoPath ".git"))) {
                throw "Expected git repo at $toolingRepoPath, but .git directory was not created. Agent reply: $toolingInitReply"
            }
            $outputLines.Add("PASS: $toolingAgentId initialized git repo $toolingRepoName")
            if ($toolingTargetModelRef) {
                $outputLines.Add("Configured model for ${toolingAgentId}: $toolingTargetModelRef")
            }
            $outputLines.Add("Observed model for ${toolingAgentId}: $toolingRuntime")

            Write-ProgressLine "[$toolingAgentId] Writing a README inside that repo" Gray
            $toolingWrite = Invoke-AgentTurn -AgentId $toolingAgentId -SessionId "smoke-tooling-write-$suffix" -Message "Use the write tool to create /home/node/.openclaw/workspace/$toolingRepoName/README.md with exact file contents shown on the next line and nothing else:`ntooling smoke test`nThen include marker WRITE_OK in your visible reply." -ModelOverrideRef $toolingModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $toolingRuntime = Get-AgentRuntimeRef -AgentJson $toolingWrite
            Add-ToolkitVerificationCleanupModelRef -ModelRef $toolingRuntime | Out-Null
            $toolingWriteReply = (Get-AgentReplyText -AgentJson $toolingWrite).Trim()
            if (-not (Test-SmokeReplyContainsMarker -Text $toolingWriteReply -Marker "WRITE_OK") -and (Normalize-SingleLineSmokeReadback -Text $toolingWriteReply) -ne "tooling smoke test") {
                throw "Expected WRITE_OK from $toolingAgentId after README write, but got: $toolingWriteReply"
            }
            $readmePath = Join-Path $toolingRepoPath "README.md"
            if (-not (Test-Path $readmePath)) {
                throw "Expected README at $readmePath, but it was not created."
            }
            $readmeText = (Get-Content -Raw $readmePath).Trim()
            if ((Normalize-SmokeSentence -Text $readmeText) -ne "tooling smoke test") {
                throw "Expected README content 'tooling smoke test', but found '$readmeText'."
            }
            $outputLines.Add("PASS: $toolingAgentId wrote README.md in shared workspace")

            Write-ProgressLine "[$toolingAgentId] Reading the README back through OpenClaw" Gray
            $toolingRead = Invoke-AgentTurn -AgentId $toolingAgentId -SessionId "smoke-tooling-read-$suffix" -Message "First use the read tool on /home/node/.openclaw/workspace/$toolingRepoName/README.md. After you receive the file contents, include marker README_OK in your visible reply if and only if the file contains the exact phrase tooling smoke test. Also include the read file content between these exact delimiter lines:`nBEGIN_SMOKE_README`n<file content here>`nEND_SMOKE_README" -ModelOverrideRef $toolingModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $toolingRuntime = Get-AgentRuntimeRef -AgentJson $toolingRead
            Add-ToolkitVerificationCleanupModelRef -ModelRef $toolingRuntime | Out-Null
            $toolingReadReply = (Get-AgentReplyText -AgentJson $toolingRead).Trim()
            if (-not (Test-SmokeReplyContainsMarker -Text $toolingReadReply -Marker "README_OK")) {
                throw "Expected README_OK from $toolingAgentId after README readback, but got: $toolingReadReply"
            }
            $toolingReadbackBlock = Get-SmokeDelimitedBlock -Text $toolingReadReply -BeginMarker "BEGIN_SMOKE_README" -EndMarker "END_SMOKE_README"
            if (-not [string]::IsNullOrWhiteSpace($toolingReadbackBlock) -and (Normalize-SingleLineSmokeReadback -Text $toolingReadbackBlock) -ne "tooling smoke test") {
                throw "Expected README readback block 'tooling smoke test', but got: $toolingReadbackBlock"
            }
            $outputLines.Add("PASS: $toolingAgentId read back README.md content")

            Write-ProgressLine "[$toolingAgentId] Running git status inside the repo" Gray
            $toolingStatus = Invoke-AgentTurn -AgentId $toolingAgentId -SessionId "smoke-tooling-status-$suffix" -Message "Run exactly one exec command with workdir /home/node/.openclaw/workspace/${toolingRepoName}: git status --short --branch. Include the exact git output between these exact delimiter lines. You may add brief prose outside the delimiter block if needed.`nBEGIN_SMOKE_GIT_STATUS`n<git status output here>`nEND_SMOKE_GIT_STATUS" -ModelOverrideRef $toolingModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $toolingRuntime = Get-AgentRuntimeRef -AgentJson $toolingStatus
            Add-ToolkitVerificationCleanupModelRef -ModelRef $toolingRuntime | Out-Null
            $toolingStatusReply = (Get-AgentReplyText -AgentJson $toolingStatus).Trim()
            $hostStatus = (Invoke-External -FilePath "git" -Arguments @("-C", $toolingRepoPath, "status", "--short", "--branch")).Output.Trim()
            $toolingStatusBlock = Get-SmokeDelimitedBlock -Text $toolingStatusReply -BeginMarker "BEGIN_SMOKE_GIT_STATUS" -EndMarker "END_SMOKE_GIT_STATUS"
            $toolingStatusComparable = if ([string]::IsNullOrWhiteSpace($toolingStatusBlock)) { $toolingStatusReply } else { $toolingStatusBlock }
            if ((Normalize-GitStatusSmokeBlock -Text $hostStatus) -ne (Normalize-GitStatusSmokeBlock -Text $toolingStatusComparable)) {
                throw "Expected $toolingAgentId git status to match host status.`nHost: $hostStatus`nAgent: $toolingStatusReply"
            }
            if ($hostStatus -notmatch '^## ') {
                throw "Unexpected git status output from ${toolingAgentId}: $hostStatus"
            }
            $outputLines.Add("PASS: $toolingAgentId ran git status in the repo")
            $outputLines.Add("Git status:")
            foreach ($statusLine in @(($hostStatus -split "\r\n|\n|\r"))) {
                if (-not [string]::IsNullOrWhiteSpace($statusLine)) {
                    $outputLines.Add("  $statusLine")
                }
            }
            $checkResults.Add((New-CheckResult -Name "tooling" -Status "pass" -AgentId $toolingAgentId -TargetModel $toolingTargetModelRef -Runtime $toolingRuntime -Detail "Completed git/file workflow in shared workspace."))
        }
        catch {
            $message = Get-ErrorMessage -ErrorRecord $_
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${toolingAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $toolingAgentId useful git/file workflow failed [$category]")
            if ($toolingTargetModelRef) {
                $outputLines.Add("Configured model for ${toolingAgentId}: $toolingTargetModelRef")
            }
            if ($toolingRuntime) {
                $outputLines.Add("Observed model for ${toolingAgentId}: $toolingRuntime")
            }
            $outputLines.Add("Reason: $message")
            $checkResults.Add((New-CheckResult -Name "tooling" -Status "fail" -AgentId $toolingAgentId -TargetModel $toolingTargetModelRef -Runtime $toolingRuntime -Category $category -Detail $message))
        }
        }
    }
    else {
        $outputLines.Add("SKIP: coder-local agent is disabled in bootstrap config, so tooling git/file smoke was skipped.")
        $checkResults.Add((New-CheckResult -Name "tooling" -Status "skip" -AgentId $toolingAgentId -Category "disabled" -Detail "coder-local agent is disabled in bootstrap config."))
    }

    Set-Content -Path $reviewProbePath -Value "review smoke ok" -Encoding UTF8
    if ($researchAgentEnabled) {
        $researchModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $researchAgentId
        if ($researchModelRef) {
            $modelsToStop.Add($researchModelRef)
        }
        if ($researchModelRef) {
            Write-ProgressLine "[$researchAgentId] Configured model: $researchModelRef" Cyan
            Add-ToolkitVerificationCleanupModelRef -ModelRef $researchModelRef | Out-Null
        }
        $researchRuntime = ""
        try {
            $researchReply = ""
            $researchPrompt = "Use web_search to find the official documentation domain for OpenClaw. If the official documentation domain is docs.openclaw.ai, include marker RESEARCH_OK in your visible reply. If you cannot verify that domain, include marker RESEARCH_FAIL in your visible reply."
            for ($researchAttempt = 1; $researchAttempt -le 2; $researchAttempt++) {
                try {
                    if ($researchAttempt -eq 1) {
                        Write-ProgressLine "[$researchAgentId] Performing a real web-backed research check" Gray
                    }
                    else {
                        Write-ProgressLine "[$researchAgentId] Retrying research after a transient provider/gateway failure" DarkGray
                    }

                    $researchTurn = Invoke-AgentTurn -AgentId $researchAgentId -SessionId "smoke-research-$suffix-$researchAttempt" -Message $researchPrompt -Timeout $TimeoutSeconds
                    $researchRuntime = Get-AgentRuntimeRef -AgentJson $researchTurn
                    Add-ToolkitVerificationCleanupModelRef -ModelRef $researchRuntime | Out-Null
                    $researchReply = (Get-AgentReplyText -AgentJson $researchTurn).Trim()
                    if (-not (Test-ResearchSmokeSuccess -Text $researchReply)) {
                        throw "Expected docs.openclaw.ai from $researchAgentId, but got: $researchReply"
                    }

                    break
                }
                catch {
                    if ($researchAttempt -ge 2) {
                        throw
                    }

                    $attemptMessage = Get-ErrorMessage -ErrorRecord $_
                    $attemptCategory = Get-ErrorCategory -Message $attemptMessage
                    if ($attemptCategory -notin @("provider-quota", "provider-capacity", "gateway", "task")) {
                        throw
                    }
                    if ($attemptMessage.ToLowerInvariant() -notmatch 'timed out|timeout|overloaded|capacity|busy|temporarily|gateway|econnrefused|service restart|closed') {
                        throw
                    }

                    Start-Sleep -Seconds 3
                }
            }
            $outputLines.Add("PASS: $researchAgentId completed a real research workflow")
            if ($researchModelRef) {
                $outputLines.Add("Configured model for ${researchAgentId}: $researchModelRef")
            }
            $outputLines.Add("Observed model for ${researchAgentId}: $researchRuntime")
            $researchDetail = Get-SmokeRuntimeDetail -TargetModel $researchModelRef -RuntimeModel $researchRuntime -BaseDetail "Completed a web-backed research task."
            if ($researchDetail -ne "Completed a web-backed research task.") {
                $outputLines.Add($researchDetail)
            }
            $checkResults.Add((New-CheckResult -Name "research" -Status "pass" -AgentId $researchAgentId -TargetModel $researchModelRef -Runtime $researchRuntime -Detail $researchDetail ))
        }
        catch {
            $message = Get-ErrorMessage -ErrorRecord $_
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${researchAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $researchAgentId research workflow failed [$category]")
            if ($researchModelRef) {
                $outputLines.Add("Configured model for ${researchAgentId}: $researchModelRef")
            }
            if ($researchRuntime) {
                $outputLines.Add("Observed model for ${researchAgentId}: $researchRuntime")
            }
            $outputLines.Add("Reason: $message")
            $checkResults.Add((New-CheckResult -Name "research" -Status "fail" -AgentId $researchAgentId -TargetModel $researchModelRef -Runtime $researchRuntime -Category $category -Detail $message))
        }
    }
    else {
        $outputLines.Add("SKIP: research agent is disabled in bootstrap config.")
        $checkResults.Add((New-CheckResult -Name "research" -Status "skip" -AgentId $researchAgentId -Category "disabled" -Detail "Research agent is disabled in bootstrap config."))
    }

    if ($reviewAgentEnabled) {
        $reviewModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $reviewAgentId
        if ($reviewModelRef) {
            $modelsToStop.Add($reviewModelRef)
        }
        $reviewModelPlan = Get-AgentSmokeModelPlan -BootstrapConfig $config -LiveConfig $liveConfig -AgentId $reviewAgentId
        $reviewTargetModelRef = Resolve-AgentSmokeTargetModelRef -PrimaryModelRef $reviewModelRef -ModelPlan $reviewModelPlan
        if ($reviewTargetModelRef) {
            Write-ProgressLine "[$reviewAgentId] Configured model: $reviewTargetModelRef" Cyan
            Add-ToolkitVerificationCleanupModelRef -ModelRef $reviewTargetModelRef | Out-Null
        }
        if ($reviewModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $reviewAgentId smoke skipped because no endpoint-defined local model currently fits.")
            if ($reviewTargetModelRef) {
                $outputLines.Add("Configured model for ${reviewAgentId}: $reviewTargetModelRef")
            }
            $outputLines.Add($reviewModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "review" -Status "skip" -AgentId $reviewAgentId -TargetModel $reviewTargetModelRef -Category "fit" -Detail $reviewModelPlan.detail))
        }
        else {
        $reviewRuntime = ""
        try {
            $reviewPrompt = "First use the read tool on /home/node/.openclaw/workspace/$reviewProbeName. After you receive the file contents, include marker REVIEW_OK in your visible reply if and only if the file contains the exact phrase review smoke ok. Do not output NO_REPLY. Do not keep the marker only in hidden reasoning."
            if ($reviewModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$reviewModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($reviewModelPlan.detail)")
                Write-ProgressLine "[$reviewAgentId] Switching smoke session to $($reviewModelPlan.modelOverrideRef)" Gray
            }
            Write-ProgressLine "[$reviewAgentId] Verifying read-only review access to the shared workspace" Gray
            $reviewReply = ""
            for ($reviewAttempt = 1; $reviewAttempt -le 2; $reviewAttempt++) {
                if ($reviewAttempt -gt 1) {
                    Write-ProgressLine "[$reviewAgentId] Retrying after non-visible review reply" DarkGray
                }

                $reviewTurn = Invoke-AgentTurn -AgentId $reviewAgentId -SessionId "smoke-review-$suffix-$reviewAttempt" -Message $reviewPrompt -ModelOverrideRef $reviewModelPlan.modelOverrideRef -ThinkingLevel "off" -Timeout $TimeoutSeconds
                $reviewRuntime = Get-AgentRuntimeRef -AgentJson $reviewTurn
                Add-ToolkitVerificationCleanupModelRef -ModelRef $reviewRuntime | Out-Null
                $reviewReply = (Get-AgentReplyText -AgentJson $reviewTurn).Trim()
                if (Test-SmokeReplyContainsMarker -Text $reviewReply -Marker "REVIEW_OK") {
                    break
                }
                if ($reviewAttempt -ge 2 -or ($reviewReply -ne "NO_REPLY" -and -not [string]::IsNullOrWhiteSpace($reviewReply))) {
                    break
                }

                Start-Sleep -Seconds 2
            }
            if (-not (Test-SmokeReplyContainsMarker -Text $reviewReply -Marker "REVIEW_OK")) {
                $friendlyReviewFailure = Get-FriendlyModelCapabilityFailureMessage -AgentId $reviewAgentId -TargetModelRef $reviewTargetModelRef -Message $reviewReply
                if ($friendlyReviewFailure -ne $reviewReply) {
                    throw $friendlyReviewFailure
                }
                throw "Expected REVIEW_OK from $reviewAgentId, but got: $reviewReply"
            }
            $outputLines.Add("PASS: $reviewAgentId can read and verify shared workspace files")
            if ($reviewTargetModelRef) {
                $outputLines.Add("Configured model for ${reviewAgentId}: $reviewTargetModelRef")
            }
            $outputLines.Add("Observed model for ${reviewAgentId}: $reviewRuntime")
            $checkResults.Add((New-CheckResult -Name "review" -Status "pass" -AgentId $reviewAgentId -TargetModel $reviewTargetModelRef -Runtime $reviewRuntime -Detail "Read and verified shared workspace content."))
        }
        catch {
            $message = Get-ErrorMessage -ErrorRecord $_
            $message = Get-FriendlyModelCapabilityFailureMessage -AgentId $reviewAgentId -TargetModelRef $reviewTargetModelRef -Message $message
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${reviewAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $reviewAgentId review-read workflow failed [$category]")
            if ($reviewTargetModelRef) {
                $outputLines.Add("Configured model for ${reviewAgentId}: $reviewTargetModelRef")
            }
            if ($reviewRuntime) {
                $outputLines.Add("Observed model for ${reviewAgentId}: $reviewRuntime")
            }
            $outputLines.Add("Reason: $message")
            $checkResults.Add((New-CheckResult -Name "review" -Status "fail" -AgentId $reviewAgentId -TargetModel $reviewTargetModelRef -Runtime $reviewRuntime -Category $category -Detail $message))
        }
        }
    }
    else {
        $outputLines.Add("SKIP: review-local agent is disabled in bootstrap config.")
        $checkResults.Add((New-CheckResult -Name "review" -Status "skip" -AgentId $reviewAgentId -Category "disabled" -Detail "review-local agent is disabled in bootstrap config."))
    }

    if ($coderAgentEnabled) {
        $coderModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $coderAgentId
        if ($coderModelRef) {
            $modelsToStop.Add($coderModelRef)
        }
        $coderModelPlan = Get-AgentSmokeModelPlan -BootstrapConfig $config -LiveConfig $liveConfig -AgentId $coderAgentId
        $coderTargetModelRef = Resolve-AgentSmokeTargetModelRef -PrimaryModelRef $coderModelRef -ModelPlan $coderModelPlan
        if ($coderTargetModelRef) {
            Write-ProgressLine "[$coderAgentId] Configured model: $coderTargetModelRef" Cyan
            Add-ToolkitVerificationCleanupModelRef -ModelRef $coderTargetModelRef | Out-Null
        }
        if ($coderModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $coderAgentId smoke skipped because no endpoint-defined local model currently fits.")
            if ($coderTargetModelRef) {
                $outputLines.Add("Configured model for ${coderAgentId}: $coderTargetModelRef")
            }
            $outputLines.Add($coderModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "coder" -Status "skip" -AgentId $coderAgentId -TargetModel $coderTargetModelRef -Category "fit" -Detail $coderModelPlan.detail))
        }
        else {
        $coderRuntime = ""
        try {
            if ($coderModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$coderModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($coderModelPlan.detail)")
                Write-ProgressLine "[$coderAgentId] Switching smoke session to $($coderModelPlan.modelOverrideRef)" Gray
            }
            Write-ProgressLine "[$coderAgentId] Creating a bounded coding artifact in the shared workspace" Gray
            $coderWrite = Invoke-AgentTurn -AgentId $coderAgentId -SessionId "smoke-coder-write-$suffix" -Message "Use the write tool to create /home/node/.openclaw/workspace/$coderProbeName with exact file contents shown on the next line and nothing else:`ncoder smoke ok`nThen include marker CODER_WRITE_OK in your visible reply." -ModelOverrideRef $coderModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $coderRuntime = Get-AgentRuntimeRef -AgentJson $coderWrite
            Add-ToolkitVerificationCleanupModelRef -ModelRef $coderRuntime | Out-Null
            $coderReply = (Get-AgentReplyText -AgentJson $coderWrite).Trim()
            if (-not (Test-SmokeReplyContainsMarker -Text $coderReply -Marker "CODER_WRITE_OK")) {
                throw "Expected CODER_WRITE_OK from $coderAgentId, but got: $coderReply"
            }
            if (-not (Test-Path $coderProbePath)) {
                throw "Expected coder probe file at $coderProbePath, but it was not created."
            }
            $coderText = (Get-Content -Raw $coderProbePath).Trim()
            if ($coderText -ne "coder smoke ok") {
                throw "Expected coder probe file content 'coder smoke ok', but found '$coderText'."
            }
            $outputLines.Add("PASS: $coderAgentId can write bounded workspace files")
            if ($coderTargetModelRef) {
                $outputLines.Add("Configured model for ${coderAgentId}: $coderTargetModelRef")
            }
            $outputLines.Add("Observed model for ${coderAgentId}: $coderRuntime")
            $checkResults.Add((New-CheckResult -Name "coder" -Status "pass" -AgentId $coderAgentId -TargetModel $coderTargetModelRef -Runtime $coderRuntime -Detail "Created a bounded workspace artifact."))
        }
        catch {
            $message = Get-ErrorMessage -ErrorRecord $_
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${coderAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $coderAgentId bounded write workflow failed [$category]")
            if ($coderTargetModelRef) {
                $outputLines.Add("Configured model for ${coderAgentId}: $coderTargetModelRef")
            }
            if ($coderRuntime) {
                $outputLines.Add("Observed model for ${coderAgentId}: $coderRuntime")
            }
            $outputLines.Add("Reason: $message")
            $checkResults.Add((New-CheckResult -Name "coder" -Status "fail" -AgentId $coderAgentId -TargetModel $coderTargetModelRef -Runtime $coderRuntime -Category $category -Detail $message))
        }
        }
    }
    else {
        $outputLines.Add("SKIP: coder-local agent is disabled in bootstrap config.")
        $checkResults.Add((New-CheckResult -Name "coder" -Status "skip" -AgentId $coderAgentId -Category "disabled" -Detail "coder-local agent is disabled in bootstrap config."))
    }
}
finally {
    foreach ($path in @($toolingRepoPath, $coderProbePath, $reviewProbePath)) {
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }
        if (Test-Path $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $seenModelRefs = @{}
    foreach ($modelRef in @($modelsToStop)) {
        if ([string]::IsNullOrWhiteSpace($modelRef)) {
            continue
        }
        if ($seenModelRefs.ContainsKey($modelRef)) {
            continue
        }
        $seenModelRefs[$modelRef] = $true
        Stop-OllamaModelFromRef -ModelRef $modelRef
    }
}

$overallStatus = if ($failures.Count -gt 0) { "fail" } else { "pass" }
$checkResultsArray = @($checkResults.ToArray())
$structuredResult = [pscustomobject]@{
    status    = $overallStatus
    workspace = $WorkspaceHostPath
    checks    = $checkResultsArray
}

if ($failures.Count -gt 0) {
    $outputLines.Insert(0, "Agent capability smoke test failed.")
    $outputLines.Add("Workspace: $WorkspaceHostPath")
    $outputLines.Add("Failed checks: $($failures.Count)")
    $outputLines.Add("coder-local exercised useful file + git workflows in shared workspace, but at least one managed agent could not complete its expected tool path.")
    $outputLines.Add("__SMOKE_JSON__: $(ConvertTo-Json $structuredResult -Depth 8 -Compress)")
    $outputLines | Write-Output
    throw ("Agent capability smoke test failed: " + ($failures -join " | "))
}

$outputLines.Insert(0, "Agent capability smoke test passed.")
$outputLines.Add("Workspace: $WorkspaceHostPath")
$outputLines.Add("coder-local exercised useful file + git workflows in shared workspace.")
$outputLines.Add("__SMOKE_JSON__: $(ConvertTo-Json $structuredResult -Depth 8 -Compress)")
$outputLines | Write-Output
