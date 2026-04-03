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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required for the sandbox smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

$sessionId = "smoke-sandbox-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
Write-ProgressLine "Using container $ContainerName" Cyan
Write-ProgressLine "Session $sessionId with timeout ${TimeoutSeconds}s" Cyan
Write-ProgressLine "Resetting session state" Gray
$null = Invoke-External -FilePath "docker" -Arguments @(
    "exec", $ContainerName,
    "node", "dist/index.js",
    "agent",
    "--session-id", $sessionId,
    "--message", "/reset",
    "--timeout", "60",
    "--json"
) -AllowFailure

Write-ProgressLine "Prompting OpenClaw to run exactly one exec command" Gray
$result = Invoke-External -FilePath "docker" -Arguments @(
    "exec", $ContainerName,
    "node", "dist/index.js",
    "agent",
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
