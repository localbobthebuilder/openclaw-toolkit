[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$RequesterAgentId = "main",
    [string]$TargetAgentId = "coder-local",
    [string]$LocalModelRef = "ollama/qwen3-coder:30b",
    [string]$WorkspaceHostPath,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

# Derive default workspace path from bootstrap config so it's portable across machines/users
$_scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$_configFile = Join-Path $_scriptDir "openclaw-bootstrap.config.json"
if (-not $WorkspaceHostPath) {
    $_hostConfigDir = $null
    if (Test-Path $_configFile) {
        . (Join-Path $_scriptDir "shared-config-paths.ps1")
        $_bsCfg = Get-Content -Raw $_configFile | ConvertFrom-Json
        $_bsCfg = Resolve-PortableConfigPaths -Config $_bsCfg -BaseDir $_scriptDir
        if ($_bsCfg.hostWorkspaceDir) { $WorkspaceHostPath = [string]$_bsCfg.hostWorkspaceDir }
        elseif ($_bsCfg.hostConfigDir) { $_hostConfigDir = [string]$_bsCfg.hostConfigDir }
    }
    if (-not $WorkspaceHostPath) {
        if (-not $_hostConfigDir) { $_hostConfigDir = Join-Path $env:USERPROFILE ".openclaw" }
        $WorkspaceHostPath = Join-Path $_hostConfigDir "workspace"
    }
}

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[local-delegate] $Message" -ForegroundColor $Color
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

function Get-HostOpenClawDir {
    if ($_hostConfigDir) {
        return $_hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-AgentSessionFiles {
    param([Parameter(Mandatory = $true)][string]$AgentId)

    $sessionDir = Join-Path (Get-HostOpenClawDir) (Join-Path "agents" (Join-Path $AgentId "sessions"))
    if (-not (Test-Path $sessionDir)) {
        return @()
    }

    return @(Get-ChildItem -LiteralPath $sessionDir -File | Where-Object { $_.Name -like "*.jsonl" } | Select-Object -ExpandProperty FullName)
}

function Get-CoderSessionFiles {
    return @(Get-AgentSessionFiles -AgentId $TargetAgentId)
}

function Get-TranscriptPathContainingText {
    param(
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$Needle,
        [int]$WaitSeconds = 20
    )

    for ($i = 0; $i -lt $WaitSeconds; $i++) {
        foreach ($candidate in @((Get-AgentSessionFiles -AgentId $AgentId) | Sort-Object { (Get-Item $_).LastWriteTime } -Descending)) {
            if (Select-String -LiteralPath $candidate -Pattern $Needle -Quiet -SimpleMatch) {
                return $candidate
            }
        }
        Start-Sleep -Seconds 1
    }

    foreach ($candidate in @((Get-AgentSessionFiles -AgentId $AgentId) | Sort-Object { (Get-Item $_).LastWriteTime } -Descending)) {
        if (Select-String -LiteralPath $candidate -Pattern $Needle -Quiet -SimpleMatch) {
            return $candidate
        }
    }

    return $null
}

function Get-AgentReplyText {
    param([Parameter(Mandatory = $true)]$AgentJson)

    $payloads = @($AgentJson.result.payloads)
    if ($payloads.Count -gt 0 -and $null -ne $payloads[0] -and $payloads[0].PSObject.Properties.Name -contains "text") {
        return [string]$payloads[0].text
    }

    $finalVisibleText = [string]$AgentJson.result.meta.finalAssistantVisibleText
    if (-not [string]::IsNullOrWhiteSpace($finalVisibleText)) {
        return $finalVisibleText
    }

    return ""
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the local delegated coder diagnostic."
}

if (-not (Test-Path $WorkspaceHostPath)) {
    throw "Workspace host path does not exist: $WorkspaceHostPath"
}

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$probeFileName = "local-delegate-$suffix.txt"
$probeFilePath = Join-Path $WorkspaceHostPath $probeFileName
$mainSessionId = "smoke-main-localdelegate-$suffix"
$childExpectedText = "LOCAL_DELEGATE_OK"

if (Test-Path $probeFilePath) {
    Remove-Item -LiteralPath $probeFilePath -Force
}

$taskMessage = "Call sessions_spawn exactly once with runtime 'subagent', agentId '$TargetAgentId', model '$LocalModelRef', and a task that uses the write tool to create /home/node/.openclaw/workspace/$probeFileName containing exactly $childExpectedText. Wait for the spawned child to finish. If and only if the child completes successfully, reply with exactly MAIN_DONE and nothing else. Do not write the file yourself."

try {
    Write-ProgressLine "Requester agent: $RequesterAgentId" Cyan
    Write-ProgressLine "Target agent: $TargetAgentId via $LocalModelRef" Cyan
    Write-ProgressLine "Probe file: $probeFilePath" Cyan

    $mainResult = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $RequesterAgentId,
        "--session-id", $mainSessionId,
        "--message", $taskMessage,
        "--timeout", [string]$TimeoutSeconds,
        "--json"
    )

    $mainJson = $mainResult.Output | ConvertFrom-Json -Depth 50
    $mainReply = Get-AgentReplyText -AgentJson $mainJson
    $mainStopReason = [string]$mainJson.result.meta.stopReason

    $mainTranscriptPath = Get-TranscriptPathContainingText -AgentId $RequesterAgentId -Needle $probeFileName -WaitSeconds 25
    $childTranscriptPath = Get-TranscriptPathContainingText -AgentId $TargetAgentId -Needle $probeFileName -WaitSeconds 25

    $probeExists = Test-Path $probeFilePath
    $probeContent = if ($probeExists) { (Get-Content -Raw $probeFilePath).Trim() } else { "" }
    $mainTranscriptText = if ($mainTranscriptPath -and (Test-Path $mainTranscriptPath)) { Get-Content -Raw $mainTranscriptPath } else { "" }
    $transcriptText = if ($childTranscriptPath -and (Test-Path $childTranscriptPath)) { Get-Content -Raw $childTranscriptPath } else { "" }
    $escapedProbePath = [regex]::Escape("/home/node/.openclaw/workspace/$probeFileName")

    $sawStructuredToolCall = $transcriptText -match '"type":"toolCall"' -or $transcriptText -match '"toolName":"write"'
    $sawRawToolMarkup = $transcriptText -match '<function=write>' -or $transcriptText -match '</tool_call>'
    $sawStructuredSpawn = [regex]::IsMatch($mainTranscriptText, '(?s)"name":"sessions_spawn".{0,1600}' + $escapedProbePath) -and $mainTranscriptText -match '"runtime":"subagent"' -and $mainTranscriptText -match ('"agentId":"' + [regex]::Escape($TargetAgentId) + '"')
    $mainWroteProbeDirectly = [regex]::IsMatch($mainTranscriptText, '(?s)"name":"write".{0,800}' + $escapedProbePath)
    $completionEventIndex = $mainTranscriptText.LastIndexOf('sourceTool":"subagent_announce"')
    $finalMainDoneIndex = $mainTranscriptText.LastIndexOf('"text":"MAIN_DONE"')
    $sawCompletionEvent = $completionEventIndex -ge 0 -and $mainTranscriptText -match [regex]::Escape($probeFileName)
    $sawFinalMainDoneAfterCompletion = $completionEventIndex -ge 0 -and $finalMainDoneIndex -gt $completionEventIndex

    $status = if ($probeExists -and $probeContent -eq $childExpectedText -and $sawStructuredSpawn -and $sawStructuredToolCall -and -not $mainWroteProbeDirectly -and $sawCompletionEvent -and $sawFinalMainDoneAfterCompletion) { "pass" } else { "fail" }
    $category = ""
    if ($status -ne "pass") {
        if ($mainWroteProbeDirectly) {
            $category = "requester-wrote-directly"
        }
        elseif (-not $sawStructuredSpawn) {
            $category = "spawn-not-observed"
        }
        elseif ($sawRawToolMarkup) {
            $category = "raw-tool-text"
        }
        elseif (-not $childTranscriptPath) {
            $category = "missing-child-transcript"
        }
        elseif (-not $probeExists) {
            $category = "child-did-not-write"
        }
        elseif (-not $sawCompletionEvent) {
            $category = "missing-completion-event"
        }
        elseif (-not $sawFinalMainDoneAfterCompletion) {
            $category = "requester-did-not-finish"
        }
        else {
            $category = "unexpected-child-behavior"
        }
    }

    $structured = [pscustomobject]@{
        status              = $status
        requesterAgentId    = $RequesterAgentId
        targetAgentId       = $TargetAgentId
        localModelRef       = $LocalModelRef
        mainSessionId       = $mainSessionId
        mainReply           = $mainReply
        mainStopReason      = $mainStopReason
        probeFilePath       = $probeFilePath
        probeExists         = $probeExists
        probeContent        = $probeContent
        mainTranscriptPath  = $mainTranscriptPath
        childTranscriptPath = $childTranscriptPath
        sawStructuredSpawn  = $sawStructuredSpawn
        sawStructuredToolCall = $sawStructuredToolCall
        sawRawToolMarkup    = $sawRawToolMarkup
        mainWroteProbeDirectly = $mainWroteProbeDirectly
        sawCompletionEvent  = $sawCompletionEvent
        sawFinalMainDoneAfterCompletion = $sawFinalMainDoneAfterCompletion
        category            = $category
    }

    if ($status -eq "pass") {
        @(
            "Local delegated coder test passed."
            "Requester: $RequesterAgentId"
            "Target: $TargetAgentId"
            "Model: $LocalModelRef"
            "Probe file: $probeFilePath"
            "Main transcript: $mainTranscriptPath"
            "Transcript: $childTranscriptPath"
            "__SMOKE_JSON__: $(ConvertTo-Json $structured -Depth 8 -Compress)"
        ) | Write-Output
        return
    }

    @(
        "Local delegated coder test failed."
        "Requester: $RequesterAgentId"
        "Target: $TargetAgentId"
        "Model: $LocalModelRef"
        "Category: $category"
        "Main reply: $mainReply"
        "Main stop reason: $mainStopReason"
        "Probe exists: $probeExists"
        "Probe content: $probeContent"
        "Main transcript: $mainTranscriptPath"
        "Transcript: $childTranscriptPath"
        "Saw structured spawn: $sawStructuredSpawn"
        "Saw structured tool call: $sawStructuredToolCall"
        "Saw raw tool markup: $sawRawToolMarkup"
        "Requester wrote probe directly: $mainWroteProbeDirectly"
        "Saw completion event: $sawCompletionEvent"
        "Saw final MAIN_DONE after completion: $sawFinalMainDoneAfterCompletion"
        "__SMOKE_JSON__: $(ConvertTo-Json $structured -Depth 8 -Compress)"
    ) | Write-Output

    throw "Local delegated coder test failed: $category"
}
finally {
    if (Test-Path $probeFilePath) {
        Remove-Item -LiteralPath $probeFilePath -Force -ErrorAction SilentlyContinue
    }
    Stop-OllamaModelFromRef -ModelRef $LocalModelRef
}
