[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$ConfigFilePath = "C:\Users\Deadline\.openclaw\openclaw.json",
    [string]$AgentId = "chat-local",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[local-model] $Message" -ForegroundColor $Color
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

function Stop-OllamaModel {
    param([string]$ModelId)

    if ([string]::IsNullOrWhiteSpace($ModelId)) {
        return
    }

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        Write-ProgressLine "Skipping unload because ollama CLI is not available on the host" Yellow
        return
    }

    Write-ProgressLine "Stopping Ollama model $ModelId to free GPU memory" Gray
    $stopResult = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $ModelId) -AllowFailure
    if ($stopResult.ExitCode -eq 0) {
        Write-ProgressLine "Ollama model $ModelId stopped" Green
    }
    else {
        Write-ProgressLine "Ollama stop for $ModelId returned exit code $($stopResult.ExitCode)" Yellow
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the local model smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

if (-not (Test-Path $ConfigFilePath)) {
    throw "OpenClaw config not found at $ConfigFilePath"
}

$cfg = Get-Content -Raw $ConfigFilePath | ConvertFrom-Json
$ollamaEntries = @($cfg.models.providers.ollama.models)

if ($ollamaEntries.Count -eq 0) {
    Write-Output "Local model smoke test skipped: no configured Ollama models."
    exit 0
}

$agentConfig = @($cfg.agents.list) | Where-Object { $_.id -eq $AgentId } | Select-Object -First 1
$preferred = $null
if ($agentConfig -and $agentConfig.model -and $agentConfig.model.primary -and [string]$agentConfig.model.primary -like "ollama/*") {
    $agentModelId = ([string]$agentConfig.model.primary).Substring("ollama/".Length)
    $preferred = $ollamaEntries | Where-Object { $_.id -eq $agentModelId } | Select-Object -First 1
}
if ($null -eq $preferred) {
    $preferred = $ollamaEntries | Where-Object { $_.id -match 'flash|mini|small' } | Select-Object -First 1
}
if ($null -eq $preferred) {
    $preferred = $ollamaEntries | Where-Object { @($_.input) -contains "text" } | Select-Object -First 1
}
if ($null -eq $preferred) {
    $preferred = $ollamaEntries | Select-Object -First 1
}

if ($null -eq $preferred -or -not $preferred.id) {
    throw "Could not resolve any Ollama model candidate from $ConfigFilePath."
}

$targetModelRef = "ollama/$($preferred.id)"
$sessionId = "smoke-localmodel-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-ProgressLine "Using container $ContainerName" Cyan
Write-ProgressLine "Agent $AgentId will target $targetModelRef" Cyan
Write-ProgressLine "Session $sessionId with timeout ${TimeoutSeconds}s" Cyan

try {
    Write-ProgressLine "Resetting session state" Gray
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

    Write-ProgressLine "Switching agent to $targetModelRef" Gray
    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", "/model $targetModelRef",
        "--timeout", "60",
        "--json"
    )

    Write-ProgressLine "Sending exact-match reply check to the agent" Gray
    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "dist/index.js",
        "agent",
        "--agent", $AgentId,
        "--session-id", $sessionId,
        "--message", "Reply with exactly LOCAL_MODEL_OK and nothing else.",
        "--timeout", [string]$TimeoutSeconds,
        "--json"
    )

    Write-ProgressLine "Parsing OpenClaw JSON result" Gray
    $json = $result.Output | ConvertFrom-Json
    $payloadText = [string]$json.result.payloads[0].text
    $provider = [string]$json.result.meta.agentMeta.provider
    $model = [string]$json.result.meta.agentMeta.model

    if ($provider -ne "ollama") {
        throw "Expected provider 'ollama' but got '$provider'."
    }
    if ($payloadText.Trim() -ne "LOCAL_MODEL_OK") {
        throw "Expected LOCAL_MODEL_OK but got: $payloadText"
    }

    @(
        "Local model smoke test passed."
        "Agent: $AgentId"
        "Model: $targetModelRef"
        "Runtime provider/model: $provider/$model"
        "Reply: $payloadText"
    ) | Write-Output
}
finally {
    Stop-OllamaModel -ModelId ([string]$preferred.id)
}
