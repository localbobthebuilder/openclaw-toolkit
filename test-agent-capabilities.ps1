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
        [int]$Timeout = 180
    )

    if (-not [string]::IsNullOrWhiteSpace($ModelOverrideRef)) {
        $switchResult = Invoke-External -FilePath "docker" -Arguments @(
            "exec", $ContainerName,
            "node", "dist/index.js",
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

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $SessionId,
        "--message", $Message,
        "--timeout", [string]$Timeout,
        "--json"
    )

    $json = $result.Output | ConvertFrom-Json -Depth 50
    if ($json.status -ne "ok") {
        throw "Agent turn for '$AgentId' did not return status ok."
    }

    return $json
}

function Get-AgentReplyText {
    param([Parameter(Mandatory = $true)]$AgentJson)

    $payloads = @($AgentJson.result.payloads)
    if ($payloads.Count -eq 0) {
        return ""
    }

    return [string]$payloads[0].text
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

function Get-ErrorCategory {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return "unknown"
    }

    $normalized = $Message.ToLowerInvariant()

    if ($normalized -match '429|resource_exhausted|quota|rate limit|too many requests') {
        return "provider-quota"
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
    if ($normalized -match 'tool|exec|write|read|web_search|web_fetch') {
        return "tooling"
    }

    return "task"
}

function New-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$AgentId,
        [string]$Runtime = "",
        [string]$Category = "",
        [string]$Detail = ""
    )

    return [pscustomobject]@{
        name     = $Name
        status   = $Status
        agentId  = $AgentId
        runtime  = $Runtime
        category = $Category
        detail   = $Detail
    }
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
    $workspacePath = if ($config.multiAgent -and $config.multiAgent.sharedWorkspace -and $config.multiAgent.sharedWorkspace.enabled -and $config.multiAgent.sharedWorkspace.path) {
        [string]$config.multiAgent.sharedWorkspace.path
    }
    else {
        "/home/node/.openclaw/workspace"
    }
    $WorkspaceHostPath = Resolve-HostWorkspacePath -Config $config -WorkspacePath $workspacePath
}

if (-not (Test-Path $WorkspaceHostPath)) {
    throw "Workspace host path does not exist: $WorkspaceHostPath"
}

$chatAgentId = if ($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.id) { [string]$config.multiAgent.localChatAgent.id } else { "chat-local" }
$reviewAgentId = if ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.id) { [string]$config.multiAgent.localReviewAgent.id } else { "review-local" }
$coderAgentId = if ($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.id) { [string]$config.multiAgent.localCoderAgent.id } else { "coder-local" }
$researchAgentId = if ($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.id) { [string]$config.multiAgent.researchAgent.id } else { "research" }

$chatAgentEnabled = [bool]($config.multiAgent -and $config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled)
$reviewAgentEnabled = [bool]($config.multiAgent -and $config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled)
$coderAgentEnabled = [bool]($config.multiAgent -and $config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled)
$researchAgentEnabled = [bool]($config.multiAgent -and $config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled)

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$chatRepoName = "telegram-smoke-$suffix"
$chatRepoPath = Join-Path $WorkspaceHostPath $chatRepoName
$coderProbeName = "coder-smoke-$suffix.txt"
$coderProbePath = Join-Path $WorkspaceHostPath $coderProbeName
$reviewProbeName = "review-smoke-$suffix.txt"
$reviewProbePath = Join-Path $WorkspaceHostPath $reviewProbeName

$outputLines = New-Object System.Collections.Generic.List[string]
$modelsToStop = New-Object System.Collections.Generic.List[string]
$failures = New-Object System.Collections.Generic.List[string]
$checkResults = New-Object System.Collections.Generic.List[object]

Write-ProgressLine "Workspace host path: $WorkspaceHostPath" Cyan
Write-ProgressLine "Telegram-routed agent: $chatAgentId" Cyan

try {
    if (Test-Path $chatRepoPath) {
        Remove-Item -LiteralPath $chatRepoPath -Recurse -Force
    }
    if (Test-Path $coderProbePath) {
        Remove-Item -LiteralPath $coderProbePath -Force
    }
    if (Test-Path $reviewProbePath) {
        Remove-Item -LiteralPath $reviewProbePath -Force
    }

    if ($chatAgentEnabled) {
        $chatModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $chatAgentId
        if ($chatModelRef) {
            $modelsToStop.Add($chatModelRef)
        }
        $chatModelPlan = Get-AgentSmokeModelPlan -BootstrapConfig $config -LiveConfig $liveConfig -AgentId $chatAgentId
        if ($chatModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $chatAgentId smoke skipped because no endpoint-defined local model currently fits.")
            $outputLines.Add($chatModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "chat" -Status "skip" -AgentId $chatAgentId -Category "fit" -Detail $chatModelPlan.detail))
        }
        else {
        try {
            if ($chatModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$chatModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($chatModelPlan.detail)")
            }
            Write-ProgressLine "[$chatAgentId] Initializing a real git repo in the shared workspace" Gray
            $chatInit = Invoke-AgentTurn -AgentId $chatAgentId -SessionId "smoke-chat-init-$suffix" -Message "Run exactly one exec command with workdir /home/node/.openclaw/workspace: git init $chatRepoName. After the command finishes, reply with exactly INIT_OK and nothing else." -ModelOverrideRef $chatModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $chatInitReply = (Get-AgentReplyText -AgentJson $chatInit).Trim()
            if (-not (Test-Path (Join-Path $chatRepoPath ".git"))) {
                throw "Expected git repo at $chatRepoPath, but .git directory was not created. Agent reply: $chatInitReply"
            }
            $outputLines.Add("PASS: $chatAgentId initialized git repo $chatRepoName")
            $outputLines.Add("Runtime: $(Get-AgentRuntimeRef -AgentJson $chatInit)")

            Write-ProgressLine "[$chatAgentId] Writing a README inside that repo" Gray
            $chatWrite = Invoke-AgentTurn -AgentId $chatAgentId -SessionId "smoke-chat-write-$suffix" -Message "Use the write tool to create /home/node/.openclaw/workspace/$chatRepoName/README.md with exactly this content: telegram smoke test. Then reply with exactly WRITE_OK and nothing else." -ModelOverrideRef $chatModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $chatWriteReply = (Get-AgentReplyText -AgentJson $chatWrite).Trim()
            if ($chatWriteReply -ne "WRITE_OK" -and $chatWriteReply -ne "telegram smoke test") {
                throw "Expected WRITE_OK from $chatAgentId after README write, but got: $chatWriteReply"
            }
            $readmePath = Join-Path $chatRepoPath "README.md"
            if (-not (Test-Path $readmePath)) {
                throw "Expected README at $readmePath, but it was not created."
            }
            $readmeText = (Get-Content -Raw $readmePath).Trim()
            if ((Normalize-SmokeSentence -Text $readmeText) -ne "telegram smoke test") {
                throw "Expected README content 'telegram smoke test', but found '$readmeText'."
            }
            $outputLines.Add("PASS: $chatAgentId wrote README.md in shared workspace")

            Write-ProgressLine "[$chatAgentId] Reading the README back through OpenClaw" Gray
            $chatRead = Invoke-AgentTurn -AgentId $chatAgentId -SessionId "smoke-chat-read-$suffix" -Message "Use the read tool to read /home/node/.openclaw/workspace/$chatRepoName/README.md. Reply with exactly the file contents and nothing else." -ModelOverrideRef $chatModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $chatReadReply = (Get-AgentReplyText -AgentJson $chatRead).Trim()
            if ((Normalize-SmokeSentence -Text $chatReadReply) -ne "telegram smoke test") {
                throw "Expected README readback 'telegram smoke test', but got: $chatReadReply"
            }
            $outputLines.Add("PASS: $chatAgentId read back README.md content")

            Write-ProgressLine "[$chatAgentId] Running git status inside the repo" Gray
            $chatStatus = Invoke-AgentTurn -AgentId $chatAgentId -SessionId "smoke-chat-status-$suffix" -Message "Run exactly one exec command with workdir /home/node/.openclaw/workspace/${chatRepoName}: git status --short --branch. Reply with the exact git output and nothing else." -ModelOverrideRef $chatModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $chatStatusReply = (Get-AgentReplyText -AgentJson $chatStatus).Trim()
            $hostStatus = (Invoke-External -FilePath "git" -Arguments @("-C", $chatRepoPath, "status", "--short", "--branch")).Output.Trim()
            if ($hostStatus -ne $chatStatusReply) {
                throw "Expected $chatAgentId git status to match host status.`nHost: $hostStatus`nAgent: $chatStatusReply"
            }
            if ($hostStatus -notmatch '^## ') {
                throw "Unexpected git status output from ${chatAgentId}: $hostStatus"
            }
            $outputLines.Add("PASS: $chatAgentId ran git status in the repo")
            $outputLines.Add("Git status: $hostStatus")
            $checkResults.Add((New-CheckResult -Name "chat" -Status "pass" -AgentId $chatAgentId -Runtime (Get-AgentRuntimeRef -AgentJson $chatInit) -Detail "Completed git/file workflow in shared workspace."))
        }
        catch {
            $message = ($_ | Out-String).Trim()
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${chatAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $chatAgentId useful git/file workflow failed [$category]")
            $outputLines.Add($message)
            $checkResults.Add((New-CheckResult -Name "chat" -Status "fail" -AgentId $chatAgentId -Category $category -Detail $message))
        }
        }
    }
    else {
        $outputLines.Add("SKIP: Telegram-routed chat agent is disabled in bootstrap config.")
        $checkResults.Add((New-CheckResult -Name "chat" -Status "skip" -AgentId $chatAgentId -Category "disabled" -Detail "Telegram-routed chat agent is disabled in bootstrap config."))
    }

    Set-Content -Path $reviewProbePath -Value "review smoke ok" -Encoding UTF8
    if ($researchAgentEnabled) {
        $researchModelRef = Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $researchAgentId
        if ($researchModelRef) {
            $modelsToStop.Add($researchModelRef)
        }
        try {
            Write-ProgressLine "[$researchAgentId] Performing a real web-backed research check" Gray
            $researchTurn = Invoke-AgentTurn -AgentId $researchAgentId -SessionId "smoke-research-$suffix" -Message "Use web_search to find the official documentation domain for OpenClaw. Reply with exactly docs.openclaw.ai and nothing else." -Timeout $TimeoutSeconds
            $researchReply = (Get-AgentReplyText -AgentJson $researchTurn).Trim()
            if ($researchReply -ne "docs.openclaw.ai") {
                throw "Expected docs.openclaw.ai from $researchAgentId, but got: $researchReply"
            }
            $runtime = Get-AgentRuntimeRef -AgentJson $researchTurn
            $outputLines.Add("PASS: $researchAgentId completed a real research workflow")
            $outputLines.Add("Runtime: $runtime")
            $checkResults.Add((New-CheckResult -Name "research" -Status "pass" -AgentId $researchAgentId -Runtime $runtime -Detail "Completed a web-backed research task." ))
        }
        catch {
            $message = ($_ | Out-String).Trim()
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${researchAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $researchAgentId research workflow failed [$category]")
            $outputLines.Add($message)
            $checkResults.Add((New-CheckResult -Name "research" -Status "fail" -AgentId $researchAgentId -Category $category -Detail $message))
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
        if ($reviewModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $reviewAgentId smoke skipped because no endpoint-defined local model currently fits.")
            $outputLines.Add($reviewModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "review" -Status "skip" -AgentId $reviewAgentId -Category "fit" -Detail $reviewModelPlan.detail))
        }
        else {
        try {
            if ($reviewModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$reviewModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($reviewModelPlan.detail)")
            }
            Write-ProgressLine "[$reviewAgentId] Verifying read-only review access to the shared workspace" Gray
            $reviewTurn = Invoke-AgentTurn -AgentId $reviewAgentId -SessionId "smoke-review-$suffix" -Message "Use the read tool to read /home/node/.openclaw/workspace/$reviewProbeName. If it contains the exact phrase 'review smoke ok', reply with exactly REVIEW_OK and nothing else." -ModelOverrideRef $reviewModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $reviewReply = (Get-AgentReplyText -AgentJson $reviewTurn).Trim()
            if ($reviewReply -ne "REVIEW_OK") {
                throw "Expected REVIEW_OK from $reviewAgentId, but got: $reviewReply"
            }
            $outputLines.Add("PASS: $reviewAgentId can read and verify shared workspace files")
            $runtime = Get-AgentRuntimeRef -AgentJson $reviewTurn
            $outputLines.Add("Runtime: $runtime")
            $checkResults.Add((New-CheckResult -Name "review" -Status "pass" -AgentId $reviewAgentId -Runtime $runtime -Detail "Read and verified shared workspace content."))
        }
        catch {
            $message = ($_ | Out-String).Trim()
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${reviewAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $reviewAgentId review-read workflow failed [$category]")
            $outputLines.Add($message)
            $checkResults.Add((New-CheckResult -Name "review" -Status "fail" -AgentId $reviewAgentId -Category $category -Detail $message))
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
        if ($coderModelPlan.status -eq "skip") {
            $outputLines.Add("SKIP: $coderAgentId smoke skipped because no endpoint-defined local model currently fits.")
            $outputLines.Add($coderModelPlan.detail)
            $checkResults.Add((New-CheckResult -Name "coder" -Status "skip" -AgentId $coderAgentId -Category "fit" -Detail $coderModelPlan.detail))
        }
        else {
        try {
            if ($coderModelPlan.modelOverrideRef) {
                $modelsToStop.Add([string]$coderModelPlan.modelOverrideRef)
                $outputLines.Add("INFO: $($coderModelPlan.detail)")
            }
            Write-ProgressLine "[$coderAgentId] Creating a bounded coding artifact in the shared workspace" Gray
            $coderWrite = Invoke-AgentTurn -AgentId $coderAgentId -SessionId "smoke-coder-write-$suffix" -Message "Use the write tool to create /home/node/.openclaw/workspace/$coderProbeName with exactly this content: coder smoke ok. Then reply with exactly CODER_WRITE_OK and nothing else." -ModelOverrideRef $coderModelPlan.modelOverrideRef -Timeout $TimeoutSeconds
            $coderReply = (Get-AgentReplyText -AgentJson $coderWrite).Trim()
            if ($coderReply -ne "CODER_WRITE_OK") {
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
            $runtime = Get-AgentRuntimeRef -AgentJson $coderWrite
            $outputLines.Add("Runtime: $runtime")
            $checkResults.Add((New-CheckResult -Name "coder" -Status "pass" -AgentId $coderAgentId -Runtime $runtime -Detail "Created a bounded workspace artifact."))
        }
        catch {
            $message = ($_ | Out-String).Trim()
            $category = Get-ErrorCategory -Message $message
            $failures.Add("${coderAgentId}: [$category] $message")
            $outputLines.Add("FAIL: $coderAgentId bounded write workflow failed [$category]")
            $outputLines.Add($message)
            $checkResults.Add((New-CheckResult -Name "coder" -Status "fail" -AgentId $coderAgentId -Category $category -Detail $message))
        }
        }
    }
    else {
        $outputLines.Add("SKIP: coder-local agent is disabled in bootstrap config.")
        $checkResults.Add((New-CheckResult -Name "coder" -Status "skip" -AgentId $coderAgentId -Category "disabled" -Detail "coder-local agent is disabled in bootstrap config."))
    }
}
finally {
    foreach ($path in @($chatRepoPath, $coderProbePath, $reviewProbePath)) {
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
    $outputLines.Add("Failures: $($failures.Count)")
    $outputLines.Add("Telegram-routed agent exercised useful file + git workflows in shared workspace, but at least one managed agent could not complete its expected tool path.")
    $outputLines.Add("__SMOKE_JSON__: $(ConvertTo-Json $structuredResult -Depth 8 -Compress)")
    $outputLines | Write-Output
    throw ("Agent capability smoke test failed: " + ($failures -join " | "))
}

$outputLines.Insert(0, "Agent capability smoke test passed.")
$outputLines.Add("Workspace: $WorkspaceHostPath")
$outputLines.Add("Telegram-routed agent exercised useful file + git workflows in shared workspace.")
$outputLines.Add("__SMOKE_JSON__: $(ConvertTo-Json $structuredResult -Depth 8 -Compress)")
$outputLines | Write-Output
