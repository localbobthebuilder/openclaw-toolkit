[CmdletBinding()]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[sandbox] $Message" -ForegroundColor $Color
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

function Get-OpenClawJsonConfigValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "openclaw",
        "config", "get", $Path
    ) -AllowFailure

    if ($result.ExitCode -ne 0) {
        return $null
    }

    $raw = $result.Output.Trim()
    if (-not $raw) {
        return $null
    }

    try {
        return $raw | ConvertFrom-Json -Depth 50
    }
    catch {
        return $null
    }
}

function Test-AgentExecAllowed {
    param(
        $Agent,
        [string[]]$GlobalDeny = @()
    )

    if ("exec" -in @($GlobalDeny)) {
        return $false
    }

    if ($null -ne $Agent -and $Agent.tools -and $Agent.tools.deny -and ("exec" -in @($Agent.tools.deny))) {
        return $false
    }

    return $true
}

function Get-AgentSandboxMode {
    param(
        $Agent,
        [string]$DefaultMode
    )

    if ($null -ne $Agent -and $Agent.sandbox -and $Agent.sandbox.mode) {
        return [string]$Agent.sandbox.mode
    }

    return $DefaultMode
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the sandbox smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

$liveAgents = @(Get-OpenClawJsonConfigValue -Path "agents.list")
$defaultSandboxMode = [string](Get-OpenClawJsonConfigValue -Path "agents.defaults.sandbox.mode")
$globalToolsDeny = @()
$globalToolsDenyRaw = Get-OpenClawJsonConfigValue -Path "tools.deny"
if ($null -ne $globalToolsDenyRaw) {
    $globalToolsDeny = @($globalToolsDenyRaw | ForEach-Object { [string]$_ })
}

$sandboxCandidate = $liveAgents |
Where-Object {
    (Get-AgentSandboxMode -Agent $_ -DefaultMode $defaultSandboxMode) -ne "off" -and
    (Test-AgentExecAllowed -Agent $_ -GlobalDeny $globalToolsDeny)
} |
Select-Object -First 1

if ($null -eq $sandboxCandidate) {
    @(
        "Sandbox smoke test skipped."
        "Reason: no sandboxed exec-capable agent is configured in this setup."
    ) | Write-Output
    exit 0
}

$agentId = [string]$sandboxCandidate.id
$sessionId = "smoke-sandbox-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-ProgressLine "Using container $ContainerName" Cyan
Write-ProgressLine "Using agent $agentId" Cyan
Write-ProgressLine "Session $sessionId with timeout ${TimeoutSeconds}s" Cyan
Write-ProgressLine "Resetting session state" Gray
$null = Invoke-External -FilePath "docker" -Arguments @(
    "exec", $ContainerName,
    "openclaw",
    "agent",
    "--agent", $agentId,
    "--session-id", $sessionId,
    "--message", "/reset",
    "--timeout", "60",
    "--json"
) -AllowFailure

Write-ProgressLine "Prompting OpenClaw to run exactly one exec command" Gray
$result = Invoke-External -FilePath "docker" -Arguments @(
    "exec", $ContainerName,
    "openclaw",
    "agent",
    "--agent", $agentId,
    "--session-id", $sessionId,
    "--message", "Run exactly one shell command via exec: pwd. Then reply with only the resulting path and nothing else.",
    "--timeout", [string]$TimeoutSeconds,
    "--json"
)

Write-ProgressLine "Parsing OpenClaw JSON result" Gray
$json = $result.Output | ConvertFrom-Json
$payloadText = [string]$json.result.payloads[0].text
$sandboxed = [bool]$json.result.meta.systemPromptReport.sandbox.sandboxed
$provider = [string]$json.result.meta.agentMeta.provider
$model = [string]$json.result.meta.agentMeta.model

if (-not $sandboxed) {
    throw "Expected sandboxed=true in systemPromptReport."
}
if ($payloadText.Trim() -ne "/workspace") {
    throw "Expected /workspace but got: $payloadText"
}

@(
    "Sandbox smoke test passed."
    "Runtime provider/model: $provider/$model"
    "Sandboxed: $sandboxed"
    "Reply: $payloadText"
) | Write-Output
