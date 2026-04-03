[CmdletBinding(SupportsShouldProcess = $true, PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Model,
    [string]$ReplaceWith,
    [string]$ConfigPath,
    [switch]$SkipBootstrap,
    [switch]$KeepOllamaModel,
    [switch]$CompactDockerData
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

function Get-LocalModelIds {
    param($Config)

    return @(
        foreach ($entry in @($Config.ollama.models)) {
            if ($entry -and $entry.id) {
                [string]$entry.id
            }
        }
    )
}

function Get-OllamaInstalledModelIds {
    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        return @()
    }

    $result = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("list") -AllowFailure
    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Output)) {
        return @()
    }

    $ids = New-Object System.Collections.Generic.List[string]
    $lines = @($result.Output -split "(`r`n|`n|`r)" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
    foreach ($line in $lines | Select-Object -Skip 1) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        $parts = @($trimmed -split '\s{2,}' | Where-Object { $_ -and $_.Trim().Length -gt 0 })
        if ($parts.Count -gt 0) {
            $ids.Add([string]$parts[0].Trim())
        }
    }

    return @($ids)
}

function Remove-OllamaModel {
    param([Parameter(Mandatory = $true)][string]$ModelId)

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        throw "Ollama CLI is not available on this machine, so host model removal cannot proceed."
    }

    $null = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("stop", $ModelId) -AllowFailure
    return Invoke-External -FilePath $ollamaCommand.Source -Arguments @("rm", $ModelId) -AllowFailure
}

function Remove-ModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    $removed = $false
    $remaining = @(
        foreach ($entry in @($Config.ollama.models)) {
            if ($entry -and [string]$entry.id -eq $ModelId) {
                $removed = $true
            }
            else {
                $entry
            }
        }
    )

    $Config.ollama.models = $remaining
    return $removed
}

function Replace-ManagedModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$RemovedModelRef,
        [string]$ReplacementModelRef
    )

    $changed = New-Object System.Collections.Generic.List[string]
    $agentPropertyNames = @(
        "strongAgent",
        "researchAgent",
        "localChatAgent",
        "hostedTelegramAgent",
        "localReviewAgent",
        "localCoderAgent"
    )

    foreach ($propertyName in $agentPropertyNames) {
        $agent = $Config.multiAgent.$propertyName
        if ($null -eq $agent) {
            continue
        }

        if (($agent.PSObject.Properties.Name -contains "modelRef") -and [string]$agent.modelRef -eq $RemovedModelRef) {
            if ([string]::IsNullOrWhiteSpace($ReplacementModelRef)) {
                throw "Managed agent '$propertyName' points to $RemovedModelRef and no replacement model was available. Add another local model first or pass -ReplaceWith."
            }

            $agent.modelRef = $ReplacementModelRef
            $changed.Add("$propertyName.modelRef")
        }

        if ($agent.PSObject.Properties.Name -contains "candidateModelRefs" -and $agent.candidateModelRefs) {
            $newCandidates = @(
                foreach ($candidate in @($agent.candidateModelRefs)) {
                    if ([string]$candidate -ne $RemovedModelRef) {
                        $candidate
                    }
                }
            )
            if (@($newCandidates).Count -ne @($agent.candidateModelRefs).Count) {
                $agent.candidateModelRefs = $newCandidates
                $changed.Add("$propertyName.candidateModelRefs")
            }
        }
    }

    return @($changed)
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

$currentIds = @(Get-LocalModelIds -Config $config)
$installedOllamaIds = @(Get-OllamaInstalledModelIds)
$isManagedModel = $Model -in $currentIds
$isInstalledInOllama = $Model -in $installedOllamaIds

$replacementId = $null
if ($ReplaceWith) {
    if ($ReplaceWith -eq $Model) {
        throw "-ReplaceWith cannot be the same model as -Model."
    }
    if ($ReplaceWith -notin $currentIds) {
        throw "Replacement model '$ReplaceWith' is not present in the managed ollama.models list."
    }
    $replacementId = $ReplaceWith
}

if (-not $isManagedModel -and -not $isInstalledInOllama) {
    throw "Model '$Model' is neither present in the managed bootstrap config nor currently installed in Ollama."
}

if ($ReplaceWith -and -not $isManagedModel) {
    throw "-ReplaceWith only makes sense when removing a managed bootstrap model."
}

if ($isManagedModel) {
    Write-Step "Removing $Model from managed bootstrap config"
    if ($PSCmdlet.ShouldProcess($ConfigPath, "remove managed model $Model")) {
        $removed = Remove-ModelEntry -Config $config -ModelId $Model
        if (-not $removed) {
            throw "Failed to remove '$Model' from managed ollama.models."
        }

        $remainingIds = @(Get-LocalModelIds -Config $config)
        if (-not $replacementId -and $remainingIds.Count -gt 0) {
            $replacementId = $remainingIds[0]
        }

        $removedModelRef = "ollama/$Model"
        $replacementModelRef = if ($replacementId) { "ollama/$replacementId" } else { $null }
        $changedRefs = @(Replace-ManagedModelRefs -Config $config -RemovedModelRef $removedModelRef -ReplacementModelRef $replacementModelRef)

        $json = $config | ConvertTo-Json -Depth 50
        Set-Content -Path $ConfigPath -Value $json -Encoding UTF8

        Write-Host "Removed ollama/$Model from bootstrap config." -ForegroundColor Green
        if ($replacementId) {
            Write-Host "Replacement local model for managed references: ollama/$replacementId" -ForegroundColor Green
        }
        if ($changedRefs.Count -gt 0) {
            Write-Host ("Updated managed references: " + ($changedRefs -join ", ")) -ForegroundColor Green
        }
    }
    else {
        Write-Host "WhatIf: would remove ollama/$Model from bootstrap config." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Model '$Model' is not in the managed bootstrap config; config update is skipped." -ForegroundColor Yellow
}

if (-not $KeepOllamaModel -and $isInstalledInOllama) {
    Write-Step "Removing $Model from host Ollama storage"
    if ($PSCmdlet.ShouldProcess($Model, "remove Ollama model")) {
        $removeResult = Remove-OllamaModel -ModelId $Model
        if ($removeResult.ExitCode -eq 0) {
            Write-Host "Removed $Model from Ollama host storage." -ForegroundColor Green
        }
        else {
            throw "Ollama rm failed for '$Model': $($removeResult.Output)"
        }
    }
    else {
        Write-Host "WhatIf: would remove $Model from Ollama host storage." -ForegroundColor Yellow
    }
}
elseif ($KeepOllamaModel) {
    Write-Host "Keeping $Model in host Ollama storage because -KeepOllamaModel was set." -ForegroundColor Yellow
}
else {
    Write-Host "Model '$Model' was not installed in host Ollama storage." -ForegroundColor Yellow
}

if ($isManagedModel -and -not $SkipBootstrap) {
    Write-Step "Reapplying bootstrap"
    if ($PSCmdlet.ShouldProcess($config.repoPath, "reapply bootstrap")) {
        & (Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1") -ConfigPath $ConfigPath
    }
    else {
        Write-Host "WhatIf: would reapply bootstrap." -ForegroundColor Yellow
    }
}

if ($CompactDockerData) {
    Write-Step "Compacting Docker Desktop storage"
    $compactScript = Join-Path (Split-Path -Parent $PSCommandPath) "compact-docker-storage.ps1"
    if (-not (Test-Path $compactScript)) {
        throw "Compaction helper not found at $compactScript"
    }

    if ($PSCmdlet.ShouldProcess($compactScript, "compact Docker Desktop storage")) {
        & $compactScript -ConfigPath $ConfigPath
    }
    else {
        Write-Host "WhatIf: would compact Docker Desktop storage." -ForegroundColor Yellow
    }
}
else {
    Write-Host ""
    Write-Host "Note: Ollama model files live on this machine under $env:USERPROFILE\.ollama\models, not inside Docker Desktop's VHDX." -ForegroundColor DarkGray
    Write-Host "If you want to compact Docker Desktop storage separately, run: D:\openclaw\openclaw-toolkit\run-openclaw.cmd compact-storage" -ForegroundColor DarkGray
}


