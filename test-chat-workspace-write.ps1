[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$AgentId = "chat-local",
    [string]$WorkspaceHostPath = (Join-Path $env:USERPROFILE ".openclaw\\workspace-chat-local"),
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[chat-write] $Message" -ForegroundColor $Color
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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the chat workspace write smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

if (-not (Test-Path $WorkspaceHostPath)) {
    throw "Workspace host path does not exist: $WorkspaceHostPath"
}

$probeId = "verify-chat-write-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$sessionId = "smoke-$probeId"
$probeFileName = "$probeId.txt"
$probePath = Join-Path $WorkspaceHostPath $probeFileName

Write-ProgressLine "Using agent $AgentId in session $sessionId" Cyan
Write-ProgressLine "Workspace host path: $WorkspaceHostPath" Cyan

if (Test-Path $probePath) {
    Remove-Item -LiteralPath $probePath -Recurse -Force
}

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

if ($sandboxed) {
    throw "Expected $AgentId to run unsandboxed for writable Telegram workspace access."
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
    "Chat workspace write smoke test passed."
    "Agent: $AgentId"
    "Runtime provider/model: $provider/$model"
    "Sandboxed: $sandboxed"
    "Created and removed: $probePath"
    "Reply: $payloadText"
) | Write-Output
