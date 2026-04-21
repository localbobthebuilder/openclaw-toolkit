[CmdletBinding(PositionalBinding = $false)]
param(
    [string[]]$Models = @(
        "ollama/qwen3.5:35b-a3b",
        "ollama/qwen3.6:35b-a3b-q4_K_M",
        "ollama/qwen3-coder:30b",
        "ollama/glm-4.7-flash:latest",
        "ollama/gemma4:31b"
    ),
    [string]$Agent = "main",
    [ValidateSet("off", "minimal", "low", "medium", "high", "xhigh")]
    [string]$Thinking = "high",
    [int]$TimeoutSeconds = 900,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$PromptTemplate,
    [string]$OutputDirectory,
    [switch]$NoStopModels,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-BenchmarkLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    Write-Host "[agent-benchmark] $Message" -ForegroundColor $Color
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' '). $text"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function ConvertTo-SafeSlug {
    param([Parameter(Mandatory = $true)][string]$Value)

    $slug = ($Value -replace '^ollama/', '' -replace '[^A-Za-z0-9_.-]+', '-').Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        return "model"
    }

    return $slug
}

function Normalize-ModelRef {
    param([Parameter(Mandatory = $true)][string]$Model)

    $trimmed = $Model.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        throw "Model references cannot be blank."
    }

    if ($trimmed -notmatch '/') {
        return "ollama/$trimmed"
    }

    return $trimmed
}

function Get-OllamaModelIdFromRef {
    param([string]$ModelRef)

    if ([string]::IsNullOrWhiteSpace($ModelRef) -or $ModelRef -notlike "ollama/*") {
        return $null
    }

    return $ModelRef.Substring("ollama/".Length)
}

function Stop-OllamaModelFromRef {
    param([string]$ModelRef)

    $modelId = Get-OllamaModelIdFromRef -ModelRef $ModelRef
    if ([string]::IsNullOrWhiteSpace($modelId)) {
        return
    }

    $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollama) {
        Write-BenchmarkLine "ollama command not found; skipping unload for $modelId" Yellow
        return
    }

    Write-BenchmarkLine "Stopping Ollama model $modelId to free GPU memory" DarkGray
    $null = Invoke-External -FilePath $ollama.Source -Arguments @("stop", $modelId) -AllowFailure
}

function Test-RawToolCallLeak {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    return [bool]($Text -match '(?is)<\s*(tool_call|function_call|exec|read|write|edit)\b|</\s*(tool_call|function_call|exec|read|write|edit)\s*>')
}

function New-AgentBenchmarkRunner {
    return @'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const promptPath = process.argv[2];
const agentId = process.argv[3];
const sessionId = process.argv[4];
const thinking = process.argv[5];
const timeoutSeconds = process.argv[6];
const modelRef = process.argv[7];
const emitJson = process.argv[8] === "1";

function runAgent(message, timeout) {
  const args = [
    "agent",
    "--agent",
    agentId,
    "--session-id",
    sessionId,
    "--thinking",
    thinking,
    "--timeout",
    String(timeout),
    "--message",
    message,
  ];

  if (emitJson) {
    args.push("--json");
  }

  const result = spawnSync("openclaw", args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.stack || String(result.error));
    return 1;
  }

  return result.status === null ? 1 : result.status;
}

if (modelRef && modelRef.trim()) {
  const switchStatus = runAgent(`/model ${modelRef}`, 60);
  if (switchStatus !== 0) {
    process.exit(switchStatus);
  }
}

const prompt = fs.readFileSync(promptPath, "utf8");
process.exit(runAgent(prompt, timeoutSeconds));
'@
}

if (-not $PromptTemplate) {
    $PromptTemplate = Join-Path (Join-Path $PSScriptRoot "agent-test-prompts") "local-coder-benchmark-template.txt"
}

if (-not (Test-Path -LiteralPath $PromptTemplate -PathType Leaf)) {
    throw "Prompt template not found: $PromptTemplate"
}

$normalizedModels = @($Models | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object {
        Normalize-ModelRef -Model ([string]$_)
    })

if (@($normalizedModels).Count -eq 0) {
    throw "At least one model is required."
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path (Join-Path $PSScriptRoot "benchmark-results") "agent-models-$runId"
}

$resolvedOutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null

$templateText = Get-Content -LiteralPath $PromptTemplate -Raw
$runnerText = New-AgentBenchmarkRunner
$results = New-Object System.Collections.Generic.List[object]

Write-BenchmarkLine "Run id: $runId" Cyan
Write-BenchmarkLine "Agent: $Agent" Cyan
Write-BenchmarkLine "Models: $($normalizedModels -join ', ')" Cyan
Write-BenchmarkLine "Output: $resolvedOutputDirectory" Cyan

if ($DryRun) {
    foreach ($modelRef in $normalizedModels) {
        $slug = ConvertTo-SafeSlug -Value $modelRef
        $sessionId = "benchmark-$slug-$runId"
        $containerBenchmarkDir = "/home/node/.openclaw/workspace/model-benchmarks/$runId/$slug"
        Write-BenchmarkLine "DRY RUN: $modelRef -> session $sessionId -> $containerBenchmarkDir" Yellow
    }
    exit 0
}

$containerState = Invoke-External -FilePath "docker" -Arguments @("inspect", "-f", "{{.State.Running}}", $ContainerName) -AllowFailure
if ($containerState.ExitCode -ne 0 -or $containerState.Output.Trim() -ne "true") {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw before running the benchmark."
}

$hostPromptFiles = New-Object System.Collections.Generic.List[string]
$hostRunnerFiles = New-Object System.Collections.Generic.List[string]

try {
    foreach ($modelRef in $normalizedModels) {
        $slug = ConvertTo-SafeSlug -Value $modelRef
        $sessionId = "benchmark-$slug-$runId"
        $containerBenchmarkDir = "/home/node/.openclaw/workspace/model-benchmarks/$runId/$slug"
        $hostPromptPath = Join-Path $resolvedOutputDirectory "$sessionId.prompt.txt"
        $hostRunnerPath = Join-Path $resolvedOutputDirectory "$sessionId.runner.js"
        $containerPromptPath = "/tmp/$sessionId.prompt.txt"
        $containerRunnerPath = "/tmp/$sessionId.runner.js"
        $stdoutPath = Join-Path $resolvedOutputDirectory "$sessionId.stdout.txt"
        $stderrPath = Join-Path $resolvedOutputDirectory "$sessionId.stderr.txt"

        $promptText = $templateText.
            Replace("{{MODEL_REF}}", $modelRef).
            Replace("{{RUN_ID}}", $runId).
            Replace("{{BENCHMARK_DIR}}", $containerBenchmarkDir)

        [System.IO.File]::WriteAllText($hostPromptPath, $promptText, [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText($hostRunnerPath, $runnerText, [System.Text.UTF8Encoding]::new($false))
        $hostPromptFiles.Add($hostPromptPath) | Out-Null
        $hostRunnerFiles.Add($hostRunnerPath) | Out-Null

        Write-BenchmarkLine "Starting $modelRef" Green
        $null = Invoke-External -FilePath "docker" -Arguments @("cp", $hostPromptPath, ("{0}:{1}" -f $ContainerName, $containerPromptPath))
        $null = Invoke-External -FilePath "docker" -Arguments @("cp", $hostRunnerPath, ("{0}:{1}" -f $ContainerName, $containerRunnerPath))

        $dockerArgs = @(
            "exec",
            $ContainerName,
            "node",
            $containerRunnerPath,
            $containerPromptPath,
            $Agent,
            $sessionId,
            $Thinking,
            ([string]$TimeoutSeconds),
            $modelRef,
            "1"
        )

        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $process = Start-Process -FilePath "docker" -ArgumentList $dockerArgs -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -NoNewWindow -Wait
        $stopwatch.Stop()

        $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
        $rawToolLeak = Test-RawToolCallLeak -Text ($stdoutText + "`n" + $stderrText)

        $artifactCheck = Invoke-External -FilePath "docker" -Arguments @(
            "exec",
            $ContainerName,
            "sh",
            "-lc",
            "test -f '$containerBenchmarkDir/word-count.js' && test -f '$containerBenchmarkDir/word-count.test.js'"
        ) -AllowFailure

        $testCheck = [pscustomobject]@{ ExitCode = 1; Output = "Benchmark files were not created." }
        if ($artifactCheck.ExitCode -eq 0) {
            $testCheck = Invoke-External -FilePath "docker" -Arguments @(
                "exec",
                "-w",
                $containerBenchmarkDir,
                $ContainerName,
                "node",
                "word-count.test.js"
            ) -AllowFailure
        }

        $finalMarker = [bool]($stdoutText -match 'BENCHMARK_OK')
        $status = if ($process.ExitCode -eq 0 -and $artifactCheck.ExitCode -eq 0 -and $testCheck.ExitCode -eq 0 -and -not $rawToolLeak) {
            "pass"
        }
        else {
            "fail"
        }

        $result = [pscustomobject]@{
            runId                 = $runId
            sessionId             = $sessionId
            modelRef              = $modelRef
            agent                 = $Agent
            status                = $status
            exitCode              = $process.ExitCode
            durationSeconds       = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
            artifactCreated       = ($artifactCheck.ExitCode -eq 0)
            artifactTestExitCode  = $testCheck.ExitCode
            finalMarkerObserved   = $finalMarker
            rawToolCallLeak       = $rawToolLeak
            benchmarkDirectory    = $containerBenchmarkDir
            stdout                = $stdoutPath
            stderr                = $stderrPath
            artifactTestOutput    = $testCheck.Output.Trim()
        }

        $results.Add($result) | Out-Null
        $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory "$sessionId.result.json") -Encoding UTF8

        if ($status -eq "pass") {
            Write-BenchmarkLine "PASS $modelRef in $($result.durationSeconds)s" Green
        }
        else {
            Write-BenchmarkLine "FAIL $modelRef in $($result.durationSeconds)s" Red
            Write-BenchmarkLine "  exit=$($result.exitCode), artifact=$($result.artifactCreated), testExit=$($result.artifactTestExitCode), rawToolLeak=$($result.rawToolCallLeak)" Yellow
        }

        if (-not $NoStopModels) {
            Stop-OllamaModelFromRef -ModelRef $modelRef
        }
    }
}
finally {
    foreach ($runnerFile in $hostRunnerFiles) {
        Remove-Item -LiteralPath $runnerFile -Force -ErrorAction SilentlyContinue
    }
}

$summaryJson = Join-Path $resolvedOutputDirectory "benchmark-summary.json"
$summaryCsv = Join-Path $resolvedOutputDirectory "benchmark-summary.csv"
@($results) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryJson -Encoding UTF8
@($results) | Export-Csv -LiteralPath $summaryCsv -NoTypeInformation -Encoding UTF8

Write-Host ""
Write-BenchmarkLine "Summary" Cyan
@($results) |
    Select-Object modelRef, status, durationSeconds, exitCode, artifactCreated, artifactTestExitCode, finalMarkerObserved, rawToolCallLeak |
    Format-Table -AutoSize

Write-BenchmarkLine "Summary JSON: $summaryJson" Cyan
Write-BenchmarkLine "Summary CSV: $summaryCsv" Cyan

$failed = @($results | Where-Object { $_.status -ne "pass" })
if (@($failed).Count -gt 0) {
    throw "Agent model benchmark failed for $(@($failed | ForEach-Object { $_.modelRef }) -join ', ')"
}
