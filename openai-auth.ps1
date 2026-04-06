[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
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

Write-Step "Checking gateway container"
$containerProbe = Invoke-External -FilePath "docker" -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0 -or ($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') start"
}

Write-Step "Starting interactive OpenAI Codex auth flow"
Write-Host "This runs OpenClaw's own OpenAI Codex OAuth login inside the gateway container." -ForegroundColor Yellow
Write-Host "That is separate from any host-browser or host-CLI login state." -ForegroundColor Yellow

& docker exec -it $ContainerName node dist/index.js models auth login --provider openai-codex --set-default
if ($LASTEXITCODE -ne 0) {
    throw "OpenAI Codex auth login did not complete successfully."
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap so managed models and agents are refreshed"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap failed after OpenAI auth."
    }
}

Write-Host ""
Write-Host "OpenAI Codex auth flow finished." -ForegroundColor Green


