[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,
    [string]$Agent = "main",
    [string]$SessionId,
    [ValidateSet("off", "minimal", "low", "medium", "high", "xhigh")]
    [string]$Thinking = "high",
    [int]$TimeoutSeconds = 900,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$OutputDirectory,
    [switch]$Wait,
    [switch]$NoJson,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PromptFile -PathType Leaf)) {
    throw "Prompt file not found: $PromptFile"
}

if ([string]::IsNullOrWhiteSpace($SessionId)) {
    $safeAgent = ($Agent -replace '[^A-Za-z0-9_.-]+', '-').Trim("-")
    if ([string]::IsNullOrWhiteSpace($safeAgent)) {
        $safeAgent = "agent"
    }
    $SessionId = "{0}-{1}" -f $safeAgent, (Get-Date -Format "yyyyMMdd-HHmmss")
}

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "openclaw-agent-sessions"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$resolvedPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path
$runId = [guid]::NewGuid().ToString("N")
$hostRunnerPath = Join-Path $OutputDirectory ("openclaw-agent-runner-$runId.js")
$containerPromptPath = "/tmp/openclaw-agent-prompt-$runId.txt"
$containerRunnerPath = "/tmp/openclaw-agent-runner-$runId.js"
$stdoutPath = Join-Path $OutputDirectory ("$SessionId.stdout.txt")
$stderrPath = Join-Path $OutputDirectory ("$SessionId.stderr.txt")

$runnerScript = @'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const promptPath = process.argv[2];
const agentId = process.argv[3];
const sessionId = process.argv[4];
const thinking = process.argv[5];
const timeoutSeconds = process.argv[6];
const emitJson = process.argv[7] === "1";

const prompt = fs.readFileSync(promptPath, "utf8");
const args = [
  "agent",
  "--agent",
  agentId,
  "--session-id",
  sessionId,
  "--thinking",
  thinking,
  "--timeout",
  timeoutSeconds,
  "--message",
  prompt,
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
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
'@

[System.IO.File]::WriteAllText($hostRunnerPath, $runnerScript, [System.Text.UTF8Encoding]::new($false))

try {
    $copyPromptOutput = & docker cp $resolvedPromptFile ("{0}:{1}" -f $ContainerName, $containerPromptPath) 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy prompt into container '$ContainerName'. $copyPromptOutput"
    }

    $copyRunnerOutput = & docker cp $hostRunnerPath ("{0}:{1}" -f $ContainerName, $containerRunnerPath) 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy agent runner into container '$ContainerName'. $copyRunnerOutput"
    }
}
finally {
    Remove-Item -LiteralPath $hostRunnerPath -Force -ErrorAction SilentlyContinue
}

$emitJsonFlag = if ($NoJson) { "0" } else { "1" }
$dockerArgs = @(
    "exec",
    $ContainerName,
    "node",
    $containerRunnerPath,
    $containerPromptPath,
    $Agent,
    $SessionId,
    $Thinking,
    ([string]$TimeoutSeconds),
    $emitJsonFlag
)

function Write-AgentSessionSummary {
    param([Parameter(Mandatory = $true)]$Summary)

    [Console]::Out.WriteLine(($Summary | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

if ($DryRun) {
    Write-AgentSessionSummary -Summary ([pscustomobject]@{
            SessionId = $SessionId
            Agent = $Agent
            DryRun = $true
            Command = "docker"
            Arguments = @($dockerArgs)
            Stdout = $stdoutPath
            Stderr = $stderrPath
            PromptFile = $resolvedPromptFile
        })
    exit 0
}

if ($Wait) {
    $process = Start-Process -FilePath "docker" -ArgumentList $dockerArgs -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -NoNewWindow -Wait
    Write-AgentSessionSummary -Summary ([pscustomobject]@{
            SessionId = $SessionId
            Agent = $Agent
            ExitCode = $process.ExitCode
            Stdout = $stdoutPath
            Stderr = $stderrPath
        })
    exit $process.ExitCode
}

$process = Start-Process -FilePath "docker" -ArgumentList $dockerArgs -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -NoNewWindow
Write-AgentSessionSummary -Summary ([pscustomobject]@{
        SessionId = $SessionId
        Agent = $Agent
        ProcessId = $process.Id
        Stdout = $stdoutPath
        Stderr = $stderrPath
        PromptFile = $resolvedPromptFile
    })
