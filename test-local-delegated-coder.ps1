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

function Get-CoderSessionFiles {
    $_hostDir = if ($_hostConfigDir) { $_hostConfigDir } else { Join-Path $env:USERPROFILE ".openclaw" }
    $sessionDir = Join-Path $_hostDir (Join-Path "agents" (Join-Path $TargetAgentId "sessions"))
    if (-not (Test-Path $sessionDir)) {
        return @()
    }

    return @(Get-ChildItem -LiteralPath $sessionDir -File | Where-Object { $_.Name -like "*.jsonl*" } | Select-Object -ExpandProperty FullName)
}

function Get-FinalizedTranscriptPath {
    param(
        [Parameter(Mandatory = $true)][string[]]$BeforeFiles,
        [int]$WaitSeconds = 12
    )

    for ($i = 0; $i -lt $WaitSeconds; $i++) {
        Start-Sleep -Seconds 1
        $afterFiles = @(Get-CoderSessionFiles)
        $newFiles = @($afterFiles | Where-Object { $_ -notin $BeforeFiles })
        $finalized = @($newFiles | Where-Object { $_ -notlike "*.lock" })
        if ($finalized.Count -gt 0) {
            return ($finalized | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1)
        }
    }

    $afterFiles = @(Get-CoderSessionFiles)
    $newFiles = @($afterFiles | Where-Object { $_ -notin $BeforeFiles })
    if ($newFiles.Count -gt 0) {
        return ($newFiles | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1)
    }

    return $null
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
$beforeFiles = @(Get-CoderSessionFiles)

if (Test-Path $probeFilePath) {
    Remove-Item -LiteralPath $probeFilePath -Force
}

$taskMessage = "Spawn coder-local as a subagent with model $LocalModelRef. Do not use research. Task: Use the write tool to create /home/node/.openclaw/workspace/$probeFileName containing exactly $childExpectedText and then stop. After the child finishes, reply with exactly MAIN_DONE and nothing else."

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
    $mainReply = ""
    if ($mainJson.result -and $mainJson.result.payloads -and $mainJson.result.payloads.Count -gt 0) {
        $mainReply = [string]$mainJson.result.payloads[0].text
    }

    $childTranscriptPath = Get-FinalizedTranscriptPath -BeforeFiles $beforeFiles

    $probeExists = Test-Path $probeFilePath
    $probeContent = if ($probeExists) { (Get-Content -Raw $probeFilePath).Trim() } else { "" }
    $transcriptText = if ($childTranscriptPath -and (Test-Path $childTranscriptPath)) { Get-Content -Raw $childTranscriptPath } else { "" }

    $sawStructuredToolCall = $transcriptText -match '"type":"toolCall"' -or $transcriptText -match '"toolName":"write"'
    $sawRawToolMarkup = $transcriptText -match '<function=write>' -or $transcriptText -match '</tool_call>'

    $status = if ($probeExists -and $probeContent -eq $childExpectedText -and $sawStructuredToolCall) { "pass" } else { "fail" }
    $category = ""
    if ($status -ne "pass") {
        if ($sawRawToolMarkup) {
            $category = "raw-tool-text"
        }
        elseif (-not $childTranscriptPath) {
            $category = "missing-child-transcript"
        }
        elseif (-not $probeExists) {
            $category = "child-did-not-write"
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
        probeFilePath       = $probeFilePath
        probeExists         = $probeExists
        probeContent        = $probeContent
        childTranscriptPath = $childTranscriptPath
        sawStructuredToolCall = $sawStructuredToolCall
        sawRawToolMarkup    = $sawRawToolMarkup
        category            = $category
    }

    if ($status -eq "pass") {
        @(
            "Local delegated coder test passed."
            "Requester: $RequesterAgentId"
            "Target: $TargetAgentId"
            "Model: $LocalModelRef"
            "Probe file: $probeFilePath"
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
        "Probe exists: $probeExists"
        "Probe content: $probeContent"
        "Transcript: $childTranscriptPath"
        "Saw structured tool call: $sawStructuredToolCall"
        "Saw raw tool markup: $sawRawToolMarkup"
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
