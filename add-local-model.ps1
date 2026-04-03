[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Model,
    [string]$Name,
    [string[]]$Contexts = @("131072", "114688", "98304", "81920", "65536", "57344", "49152", "32768"),
    [int]$BudgetMiB = 29000,
    [string[]]$InputKinds = @("text"),
    [switch]$Reasoning,
    [int]$MaxTokens = 8192,
    [string]$AssignTo,
    [string]$ConfigPath,
    [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")

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

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-OllamaInstalledIds {
    $result = Invoke-External -FilePath "ollama" -Arguments @("list") -AllowFailure
    if ($result.ExitCode -ne 0 -or -not $result.Output) {
        return @()
    }

    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($result.Output -split "(`r`n|`n|`r)")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed -match '^NAME\s+') {
            continue
        }

        $name = ($trimmed -replace '\s{2,}.*$', '')
        if ($name) {
            $ids.Add($name)
        }
    }

    return @($ids | Select-Object -Unique)
}

function Ensure-ModelPulled {
    param([Parameter(Mandatory = $true)][string]$ModelId)

    $installed = @(Get-OllamaInstalledIds)
    if ($ModelId -in $installed) {
        Write-Host "Ollama model $ModelId is already installed." -ForegroundColor Green
        return
    }

    Write-Step "Pulling Ollama model $ModelId"
    $null = Invoke-External -FilePath "ollama" -Arguments @("pull", $ModelId)
}

function New-LocalModelEntry {
    param(
        [Parameter(Mandatory = $true)][string]$ModelId,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][int]$ContextWindow,
        [Parameter(Mandatory = $true)][int]$MaxTokensValue,
        [string[]]$Inputs = @("text"),
        [switch]$ReasoningModel
    )

    $entry = [ordered]@{
        id    = $ModelId
        name  = $DisplayName
        input = @($Inputs)
        cost  = [ordered]@{
            input      = 0
            output     = 0
            cacheRead  = 0
            cacheWrite = 0
        }
        contextWindow = $ContextWindow
        maxTokens     = $MaxTokensValue
    }

    if ($ReasoningModel) {
        $entry.reasoning = $true
    }

    return [pscustomobject]$entry
}

function Set-AgentModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$TargetAgentId,
        [Parameter(Mandatory = $true)][string]$ModelRef
    )

    if ([string]::IsNullOrWhiteSpace($TargetAgentId)) {
        return $false
    }

    $mapping = @{
        "chat-local"   = "localChatAgent"
        "review-local" = "localReviewAgent"
        "coder-local"  = "localCoderAgent"
        "chat-openai"  = "hostedTelegramAgent"
        "research"     = "researchAgent"
        "main"         = "strongAgent"
    }

    if (-not $mapping.ContainsKey($TargetAgentId)) {
        throw "Unknown agent id for -AssignTo: $TargetAgentId"
    }

    $propertyName = $mapping[$TargetAgentId]
    if (-not $Config.multiAgent -or -not $Config.multiAgent.$propertyName) {
        throw "Config does not contain multiAgent.$propertyName"
    }

    $Config.multiAgent.$propertyName.modelRef = $ModelRef
    return $true
}

if (-not (Test-CommandExists "ollama")) {
    throw "The 'ollama' CLI is required."
}
if (-not (Test-CommandExists "pwsh")) {
    throw "PowerShell 7 (pwsh) is required for add-local-model."
}
if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = $Model
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

Ensure-ModelPulled -ModelId $Model

$probeScript = Join-Path (Split-Path -Parent $PSCommandPath) "probe-ollama-gpu-fit.ps1"
Write-Step "Probing GPU-fit context for $Model"
$probeOutput = & $probeScript -Model $Model -Contexts $Contexts -BudgetMiB $BudgetMiB -Json
if (-not $probeOutput) {
    throw "Model probe returned no output."
}

$probeJsonLine = @($probeOutput) |
Where-Object { $_ -is [string] } |
ForEach-Object { $_.Trim() } |
Where-Object { $_ -match '^\{.*\}$' } |
Select-Object -Last 1

if (-not $probeJsonLine) {
    $debugText = (@($probeOutput) | ForEach-Object { "$_" }) -join [Environment]::NewLine
    throw "Could not find JSON summary in model probe output.`n$debugText"
}

$probeResult = $probeJsonLine | ConvertFrom-Json -Depth 20
if ($null -eq $probeResult.selectedContextWindow) {
    throw "No tested context met the full-GPU + <= $BudgetMiB MiB budget rule for $Model."
}

$selectedContextWindow = [int]$probeResult.selectedContextWindow
$newEntry = New-LocalModelEntry -ModelId $Model -DisplayName $Name -ContextWindow $selectedContextWindow -MaxTokensValue $MaxTokens -Inputs $InputKinds -ReasoningModel:$Reasoning

Write-Step "Updating bootstrap config"
$newModels = New-Object System.Collections.Generic.List[object]
$replaced = $false
foreach ($existingModel in @($config.ollama.models)) {
    if ([string]$existingModel.id -eq $Model) {
        $newModels.Add($newEntry)
        $replaced = $true
    }
    else {
        $newModels.Add($existingModel)
    }
}
if (-not $replaced) {
    $newModels.Add($newEntry)
}
$config.ollama.models = @(
    foreach ($entry in $newModels) {
        $entry
    }
)

$assigned = $false
if ($AssignTo) {
    $assigned = Set-AgentModelRef -Config $config -TargetAgentId $AssignTo -ModelRef ("ollama/" + $Model)
}

$json = $config | ConvertTo-Json -Depth 50
Set-Content -Path $ConfigPath -Value $json -Encoding UTF8

Write-Host "Updated bootstrap config for ollama/$Model with contextWindow=$selectedContextWindow and maxTokens=$MaxTokens." -ForegroundColor Green
if ($assigned) {
    Write-Host "Assigned ollama/$Model to agent $AssignTo." -ForegroundColor Green
}

if (-not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap"
    & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
}
