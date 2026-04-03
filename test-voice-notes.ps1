[CmdletBinding()]
param(
    [string]$Phrase = "OpenClaw voice transcription test",
    [string]$ContainerName = "openclaw-openclaw-gateway-1"
)

$ErrorActionPreference = "Stop"

function Write-ProgressLine {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "[voice] $Message" -ForegroundColor $Color
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
    throw "Docker is required for the voice smoke test."
}

if (-not (Test-ContainerRunning -Name $ContainerName)) {
    throw "Container '$ContainerName' is not running."
}

$tempDir = Join-Path $env:TEMP "openclaw-voice-test"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$wavPath = Join-Path $tempDir "voice-test.wav"
$scriptPath = Join-Path $tempDir "voice-test.mjs"

$voice = $null
$stream = $null

try {
    Write-ProgressLine "Generating local WAV sample with Windows SAPI" Cyan
    $voice = New-Object -ComObject SAPI.SpVoice
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open($wavPath, 3, $false)
    $voice.AudioOutputStream = $stream
    $null = $voice.Speak($Phrase)
    $stream.Close()

@'
import fs from "node:fs/promises";
import { runMediaUnderstandingFile } from "/app/dist/extensions/media-understanding-core/runtime-api.js";

const cfg = JSON.parse(await fs.readFile("/home/node/.openclaw/openclaw.json", "utf8"));
const result = await runMediaUnderstandingFile({
  capability: "audio",
  filePath: "/tmp/voice-test.wav",
  mime: "audio/wav",
  cfg,
  agentDir: "/home/node/.openclaw/agents/main/agent"
});
console.log(JSON.stringify(result));
'@ | Set-Content -Path $scriptPath -Encoding UTF8

    Write-ProgressLine "Copying WAV and helper script into $ContainerName" Gray
    Invoke-External -FilePath "docker" -Arguments @("cp", $wavPath, "${ContainerName}:/tmp/voice-test.wav") | Out-Null
    Invoke-External -FilePath "docker" -Arguments @("cp", $scriptPath, "${ContainerName}:/tmp/voice-test.mjs") | Out-Null
    Write-ProgressLine "Running local transcription inside the gateway container" Gray
    $result = Invoke-External -FilePath "docker" -Arguments @("exec", $ContainerName, "node", "/tmp/voice-test.mjs")
    Write-ProgressLine "Parsing transcription JSON result" Gray
    $json = $result.Output | ConvertFrom-Json

    $lines = @("Voice-note transcription result:")
    if ($json.text) {
        $lines += [string]$json.text
    }
    else {
        $lines += "No transcript text returned."
        $lines += $result.Output
    }
    $lines | Write-Output
}
finally {
    if ($null -ne $stream) {
        try {
            $stream.Close()
        }
        catch {
        }
    }
    if ($null -ne $voice) {
        try {
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice) | Out-Null
        }
        catch {
        }
    }
    if ($null -ne $stream) {
        try {
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null
        }
        catch {
        }
    }
    if (Test-Path $wavPath) {
        Remove-Item -LiteralPath $wavPath -Force
    }
    if (Test-Path $scriptPath) {
        Remove-Item -LiteralPath $scriptPath -Force
    }
    Invoke-External -FilePath "docker" -Arguments @("exec", $ContainerName, "sh", "-lc", "rm -f /tmp/voice-test.wav /tmp/voice-test.mjs") -AllowFailure | Out-Null
}
