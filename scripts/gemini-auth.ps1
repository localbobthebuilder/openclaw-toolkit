[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$Provider = "google",
    [switch]$SkipBootstrap,
    [switch]$SkipRelaunch
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-interactive-window.ps1")
. (Join-Path (Split-Path -Parent $PSCommandPath) "shared-gateway-cli-startup.ps1")

if (-not $SkipRelaunch) {
    $launchArgs = @()
    if ($ConfigPath) { $launchArgs += @("-ConfigPath", $ConfigPath) }
    if ($ContainerName) { $launchArgs += @("-ContainerName", $ContainerName) }
    if ($Provider) { $launchArgs += @("-Provider", $Provider) }
    if ($SkipBootstrap) { $launchArgs += "-SkipBootstrap" }
    $launchArgs += "-SkipRelaunch"

    $launched = Restart-InInteractiveWindowIfNeeded `
        -ScriptPath $PSCommandPath `
        -Arguments $launchArgs `
        -WindowTitle "OpenClaw Toolkit - Gemini Auth"
    if ($launched) { return }
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

function Get-JsonFromDockerCommand {
    param([string[]]$Arguments)

    $result = Invoke-External -FilePath "docker" -Arguments (Get-ToolkitGatewayNodeDockerExecArgs -ContainerName $ContainerName -Arguments $Arguments) -AllowFailure
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return $null
    }

    try {
        return ($result.Output | ConvertFrom-Json -Depth 50)
    }
    catch {
        return $null
    }
}

Write-Step "Checking gateway container"
$containerProbe = Invoke-External -FilePath "docker" -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
if ($containerProbe.ExitCode -ne 0 -or ($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
    throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') start"
}

Write-Step "Starting interactive Gemini auth flow"
Write-Host "OpenClaw stores Gemini auth inside its own gateway auth profiles." -ForegroundColor Yellow
Write-Host "This helper uses the official Google Gemini API-key provider, not the unofficial Gemini CLI OAuth path." -ForegroundColor Yellow
Write-Host "You will be prompted for your Gemini API key." -ForegroundColor Yellow

& docker @(Get-ToolkitGatewayNodeDockerExecArgs -ContainerName $ContainerName -Interactive -Arguments @("models", "auth", "login", "--provider", $Provider, "--method", "api-key", "--set-default"))
if ($LASTEXITCODE -ne 0) {
    throw "Gemini auth login did not complete successfully."
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap so Gemini is wired into the managed layout"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap failed after Gemini auth."
    }
}

Write-Step "Checking Gemini provider readiness"
$modelsStatus = Get-JsonFromDockerCommand -Arguments @("models", "status", "--json")
if ($null -eq $modelsStatus) {
    throw "Could not read OpenClaw model status after Gemini auth."
}

$googleProvider = @($modelsStatus.auth.oauth.providers | Where-Object { $_.provider -eq "google" } | Select-Object -First 1)
if ($null -eq $googleProvider -or $googleProvider.status -eq "missing") {
    throw "Gemini auth finished, but OpenClaw still reports the Google provider as missing."
}

Write-Step "Checking research agent wiring"
$agentsList = Get-JsonFromDockerCommand -Arguments @("config", "get", "agents.list")
if ($null -eq $agentsList) {
    throw "Could not read agents.list after Gemini auth."
}

$researchAgent = @($agentsList | Where-Object { $_.id -eq "research" } | Select-Object -First 1)
if ($null -eq $researchAgent) {
    throw "Research agent is missing after Gemini auth/bootstrap."
}

$researchModel = if ($researchAgent.model) { [string]$researchAgent.model.primary } else { "" }
if ($researchModel -ne "google/gemini-3.1-flash-lite-preview") {
    throw "Research agent is present but not using Gemini. Current model: $researchModel"
}

Write-Host ""
Write-Host "Gemini provider is ready and the research agent is wired to $researchModel." -ForegroundColor Green
Write-Host "Gemini auth flow finished." -ForegroundColor Green


