[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$ConfigPath,
    [string]$WorkspaceHostPath,
    [int]$TimeoutSeconds = 300
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

    Write-Host "[remote-review-smoke] $Message" -ForegroundColor $Color
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
        [int]$Timeout = 180
    )

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

function Get-ErrorCategory {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return "unknown"
    }

    $normalized = $Message.ToLowerInvariant()
    if ($normalized -match '429|rate limit|quota|resource_exhausted|usage limit') { return "provider-quota" }
    if ($normalized -match '401|403|unauthorized|forbidden|not authenticated|api key|oauth') { return "provider-auth" }
    if ($normalized -match 'gateway closed|service restart|container .+ is not running|econnrefused|timed out') { return "gateway" }
    if ($normalized -match 'sessions_spawn|child|subagent') { return "delegation" }
    if ($normalized -match 'read|write|exec|tool') { return "tooling" }
    return "task"
}

function Stop-OllamaModelFromRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$ModelRef
    )

    if ([string]::IsNullOrWhiteSpace($ModelRef) -or $ModelRef -notmatch '/') {
        return
    }

    $providerId, $modelId = $ModelRef -split '/', 2
    if ([string]::IsNullOrWhiteSpace($modelId)) {
        return
    }

    $endpoint = @(Get-ToolkitOllamaEndpoints -Config $Config) | Where-Object { [string]$_.providerId -eq $providerId } | Select-Object -First 1
    if ($null -eq $endpoint) {
        return
    }

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return
    }

    Write-ProgressLine "Stopping Ollama model $modelId on endpoint $($endpoint.key)" DarkGray
    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint
        $null = Invoke-External -FilePath $command.Source -Arguments @("stop", $modelId) -AllowFailure
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }
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
        return [string]$liveConfig.agents.defaults.model.primary
    }

    return ""
}

function Wait-ForPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$TimeoutSeconds = 20,
        [int]$PollIntervalMilliseconds = 500
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) {
            return $true
        }
        Start-Sleep -Milliseconds $PollIntervalMilliseconds
    }

    return (Test-Path -LiteralPath $Path)
}

function Wait-ForTextInFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [int]$TimeoutSeconds = 60,
        [int]$PollIntervalMilliseconds = 1000
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) {
            try {
                $text = Get-Content -Raw -LiteralPath $Path
                if (& $Condition $text) {
                    return $text
                }
            }
            catch {
            }
        }
        Start-Sleep -Milliseconds $PollIntervalMilliseconds
    }

    if (Test-Path -LiteralPath $Path) {
        return (Get-Content -Raw -LiteralPath $Path)
    }

    return $null
}

function Find-AgentTranscriptPath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$Marker,
        [int]$LookbackMinutes = 30
    )

    $sessionsDir = Join-Path (Join-Path (Join-Path (Get-HostConfigDir -Config $Config) "agents") $AgentId) "sessions"
    if (-not (Test-Path -LiteralPath $sessionsDir)) {
        return $null
    }

    $cutoff = (Get-Date).AddMinutes(-1 * [Math]::Max(1, $LookbackMinutes))
    $candidates = Get-ChildItem -LiteralPath $sessionsDir -Filter "*.jsonl*" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $cutoff } |
        Sort-Object LastWriteTime -Descending

    foreach ($candidate in $candidates) {
        try {
            if (Select-String -LiteralPath $candidate.FullName -SimpleMatch -Pattern $Marker -Quiet) {
                return $candidate.FullName
            }
        }
        catch {
            continue
        }
    }

    return $null
}

function New-StructuredResult {
    param(
        [string]$Status,
        [string]$Category,
        [string]$Detail,
        [string]$Project = "",
        [string]$MainRuntime = ""
    )

    return [pscustomobject]@{
        status      = $Status
        category    = $Category
        detail      = $Detail
        project     = $Project
        mainRuntime = $MainRuntime
    }
}

function Convert-JsonEscapedText {
    param([string]$Text)

    if ([string]::IsNullOrEmpty($Text)) {
        return ""
    }

    return ($Text -replace '\\n', [Environment]::NewLine -replace '\\"', '"')
}

function Get-AssistantTextFromTranscriptLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return ""
    }

    try {
        $event = $Line | ConvertFrom-Json -Depth 50
        if ($null -eq $event.message -or $event.message.role -ne "assistant") {
            return ""
        }
        $textPart = @($event.message.content) | Where-Object { $_.type -eq "text" } | Select-Object -First 1
        if ($null -eq $textPart -or [string]::IsNullOrWhiteSpace([string]$textPart.text)) {
            return ""
        }
        return (Convert-JsonEscapedText -Text ([string]$textPart.text))
    }
    catch {
        return ""
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the remote-review smoke test."
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$config = Add-ToolkitLegacyMultiAgentView -Config $config

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

$mainAgentId = if ($config.multiAgent.strongAgent -and $config.multiAgent.strongAgent.id) { [string]$config.multiAgent.strongAgent.id } else { "main" }
$remoteCoderId = if ($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.id) { [string]$config.multiAgent.remoteCoderAgent.id } else { "coder-remote" }
$localReviewId = if ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.id) { [string]$config.multiAgent.localReviewAgent.id } else { "review-local" }

if (-not ($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled)) {
    throw "remoteCoderAgent is not enabled in bootstrap config."
}
if (-not ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled)) {
    throw "localReviewAgent is not enabled in bootstrap config."
}

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$projectName = "remote-review-smoke-$suffix"
$projectHostPath = Join-Path $WorkspaceHostPath $projectName
$projectContainerPath = "/home/node/.openclaw/workspace/$projectName"
$mainCppHostPath = Join-Path $projectHostPath "main.cpp"
$readmeHostPath = Join-Path $projectHostPath "README.md"
$mainCppContainerPath = "$projectContainerPath/main.cpp"
$readmeContainerPath = "$projectContainerPath/README.md"
$sessionId = "smoke-main-remote-review-$suffix"
$modelsToStop = New-Object System.Collections.Generic.List[string]
$keepArtifacts = $false
$mainRuntime = ""
$transcriptPath = $null

$modelsToStop.Add((Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $mainAgentId))
$modelsToStop.Add((Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $remoteCoderId))
$modelsToStop.Add((Get-AgentPrimaryModelRef -LiveConfig $liveConfig -AgentId $localReviewId))

try {
    if (Test-Path $projectHostPath) {
        Remove-Item -LiteralPath $projectHostPath -Recurse -Force
    }
    if ($transcriptPath -and (Test-Path $transcriptPath)) {
        Remove-Item -LiteralPath $transcriptPath -Force
    }

    $message = @"
Use subagents for this task and do not use research.
1. Spawn only $remoteCoderId to create a tiny practical C++17 CLI app in $projectContainerPath.
2. The coder must create exactly these files:
- $mainCppContainerPath
- $readmeContainerPath
3. The app should accept one positive integer argument N and print factorials from 1 through N, one per line. If the argument is missing or invalid, print a short usage message and exit non-zero.
4. After $remoteCoderId finishes, spawn only $localReviewId to review exactly these full paths:
- $mainCppContainerPath
- $readmeContainerPath
5. In the review task, include those exact full paths verbatim. Do not use bare filenames.
6. Wait for both child completions before replying.
7. Reply in exactly this format:
MAIN_REMOTE_LOCAL_OK
FILES=$mainCppContainerPath|$readmeContainerPath
REVIEW=<one line>
"@

    Write-ProgressLine "Running main -> $remoteCoderId -> $localReviewId orchestration test" Cyan
    $mainTurn = Invoke-AgentTurn -AgentId $mainAgentId -SessionId $sessionId -Message $message -Timeout $TimeoutSeconds
    $mainReply = (Get-AgentReplyText -AgentJson $mainTurn).Trim()
    $mainRuntime = Get-AgentRuntimeRef -AgentJson $mainTurn

    if (-not (Wait-ForPath -Path $mainCppHostPath -TimeoutSeconds 20)) {
        throw "Expected $mainCppHostPath to be created by $remoteCoderId, but it does not exist."
    }
    if (-not (Wait-ForPath -Path $readmeHostPath -TimeoutSeconds 20)) {
        throw "Expected $readmeHostPath to be created by $remoteCoderId, but it does not exist."
    }

    $transcriptPath = Find-AgentTranscriptPath -Config $config -AgentId $mainAgentId -Marker $projectName
    if (-not (Test-Path $transcriptPath)) {
        throw "Could not locate a recent main session transcript containing marker '$projectName'."
    }

    $transcriptText = Wait-ForTextInFile -Path $transcriptPath -TimeoutSeconds 90 -Condition {
        param($text)
        if ([string]::IsNullOrWhiteSpace($text)) {
            return $false
        }

        $lines = @($text -split "\r?\n")
        $hasCoderSpawn = $text -match ('"name":"sessions_spawn".*?"agentId":"' + [regex]::Escape($remoteCoderId) + '"')
        $hasReviewSpawn = $lines |
            Where-Object {
                $_ -match '"name":"sessions_spawn"' -and
                $_ -match ('"agentId":"' + [regex]::Escape($localReviewId) + '"') -and
                $_ -match [regex]::Escape($mainCppContainerPath) -and
                $_ -match [regex]::Escape($readmeContainerPath)
            } |
            Select-Object -First 1
        $finalAssistantLine = $lines |
            Where-Object {
                $assistantText = Get-AssistantTextFromTranscriptLine -Line $_
                $assistantText -match '^MAIN_REMOTE_LOCAL_OK' -and
                $assistantText -match [regex]::Escape("FILES=$mainCppContainerPath|$readmeContainerPath") -and
                $assistantText -match [regex]::Escape("REVIEW=")
            } |
            Select-Object -Last 1

        return [bool]($hasCoderSpawn -and $hasReviewSpawn -and $finalAssistantLine)
    }
    $transcriptLines = @($transcriptText -split "\r?\n")

    if ($transcriptText -notmatch ('"name":"sessions_spawn".*?"agentId":"' + [regex]::Escape($remoteCoderId) + '"')) {
        throw "Main transcript does not show a sessions_spawn call for $remoteCoderId."
    }
    if ($transcriptText -notmatch ('"name":"sessions_spawn".*?"agentId":"' + [regex]::Escape($localReviewId) + '"')) {
        throw "Main transcript does not show a sessions_spawn call for $localReviewId."
    }
    $reviewSpawnLine = $transcriptLines |
        Where-Object {
            $_ -match '"name":"sessions_spawn"' -and
            $_ -match ('"agentId":"' + [regex]::Escape($localReviewId) + '"') -and
            $_ -match [regex]::Escape($mainCppContainerPath) -and
            $_ -match [regex]::Escape($readmeContainerPath)
        } |
        Select-Object -First 1
    if (-not $reviewSpawnLine) {
        throw "Main transcript shows $localReviewId spawning, but the review task did not include both exact full file paths."
    }
    $finalReplyText = $mainReply
    $finalReplyLine = $transcriptLines |
        Where-Object {
            $assistantText = Get-AssistantTextFromTranscriptLine -Line $_
            $assistantText -match '^MAIN_REMOTE_LOCAL_OK' -and
            $assistantText -match [regex]::Escape($mainCppContainerPath) -and
            $assistantText -match [regex]::Escape($readmeContainerPath)
        } |
        Select-Object -Last 1
    if ($finalReplyLine) {
        $assistantText = Get-AssistantTextFromTranscriptLine -Line $finalReplyLine
        if (-not [string]::IsNullOrWhiteSpace($assistantText)) {
            $finalReplyText = $assistantText
        }
    }
    if ($finalReplyText -notmatch '^MAIN_REMOTE_LOCAL_OK') {
        throw "Expected main reply to begin with MAIN_REMOTE_LOCAL_OK, but got: $finalReplyText"
    }

    $structured = New-StructuredResult -Status "pass" -Category "" -Detail "main delegated code creation to $remoteCoderId and review to $localReviewId using exact file paths." -Project $projectHostPath -MainRuntime $mainRuntime
    @(
        "Remote coder/local reviewer smoke test passed.",
        "Main runtime: $mainRuntime",
        "Project: $projectHostPath",
        "Transcript: $transcriptPath",
        "Main reply:",
        $finalReplyText,
        "__SMOKE_JSON__: $(ConvertTo-Json $structured -Depth 8 -Compress)"
    ) | Write-Output
}
catch {
    $keepArtifacts = $true
    $message = ($_ | Out-String).Trim()
    $category = Get-ErrorCategory -Message $message
    $structured = New-StructuredResult -Status "fail" -Category $category -Detail $message -Project $projectHostPath
    @(
        "Remote coder/local reviewer smoke test failed.",
        "Category: $category",
        "Project: $projectHostPath",
        "Main runtime: $mainRuntime",
        $message,
        "__SMOKE_JSON__: $(ConvertTo-Json $structured -Depth 8 -Compress)"
    ) | Write-Output
    throw
}
finally {
    if (-not $keepArtifacts -and (Test-Path $projectHostPath)) {
        Remove-Item -LiteralPath $projectHostPath -Recurse -Force -ErrorAction SilentlyContinue
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
        Stop-OllamaModelFromRef -Config $config -ModelRef $modelRef
    }
}
