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
    $ConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

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
        foreach ($entry in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
            if ($entry -and $entry.id) {
                [string]$entry.id
            }
        }
    )
}

function Invoke-OllamaCli {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        throw "Ollama CLI is not available on this machine."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        return Invoke-External -FilePath $ollamaCommand.Source -Arguments $Arguments -AllowFailure:$AllowFailure
    }
    finally {
        if ([string]::IsNullOrWhiteSpace($oldHost)) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }
}

function Get-OllamaInstalledModelIds {
    param($Endpoint)

    if ($null -eq $Endpoint) {
        return @()
    }

    $result = Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("list") -AllowFailure
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
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    $null = Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("stop", $ModelId) -AllowFailure
    return Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("rm", $ModelId) -AllowFailure
}

function Get-EndpointModelAssignments {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    return @(
        foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
            $matches = @(
                foreach ($entry in @($endpoint.models)) {
                    if ($entry -and [string]$entry.id -eq $ModelId) {
                        $entry
                    }
                }
            )

            if ($matches.Count -gt 0) {
                $endpoint
            }
        }
    )
}

function Remove-ModelEntry {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    $changed = New-Object System.Collections.Generic.List[string]
    if ($Config.PSObject.Properties.Name -contains "modelCatalog" -and $Config.modelCatalog) {
        $remaining = @(
            foreach ($entry in @($Config.modelCatalog)) {
                if ($entry -and [string]$entry.id -ne $ModelId) {
                    $entry
                }
            }
        )
        if (@($remaining).Count -ne @($Config.modelCatalog).Count) {
            $Config.modelCatalog = $remaining
            $changed.Add("modelCatalog")
        }
    }
    elseif ($Config.ollama -and $Config.ollama.PSObject.Properties.Name -contains "models") {
        $remaining = @(
            foreach ($entry in @($Config.ollama.models)) {
                if ($entry -and [string]$entry.id -ne $ModelId) {
                    $entry
                }
            }
        )
        if (@($remaining).Count -ne @($Config.ollama.models).Count) {
            $Config.ollama.models = $remaining
            $changed.Add("ollama.models")
        }
    }

    $endpointCollection = @(Get-ToolkitMutableEndpointsCollection -Config $Config)

    foreach ($endpoint in $endpointCollection) {
        if ($null -eq $endpoint) {
            continue
        }

        $runtime = if ($endpoint.PSObject.Properties.Name -contains "ollama" -and $null -ne $endpoint.ollama) { $endpoint.ollama } else { $endpoint }

        if ($runtime.PSObject.Properties.Name -contains "models") {
            $newModels = @(
                foreach ($entry in @($runtime.models)) {
                    if ($entry -and [string]$entry.id -ne $ModelId) {
                        $entry
                    }
                }
            )
            if (@($newModels).Count -ne @($runtime.models).Count) {
                $runtime.models = $newModels
                $changed.Add("$([string]$endpoint.key).models")
            }
        }
    }

    return @($changed)
}

function Replace-ManagedModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$RemovedModelRef,
        [string]$ReplacementModelRef
    )

    $changed = New-Object System.Collections.Generic.List[string]

    foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
        if ($null -eq $agent) {
            continue
        }

        $agentLabel = if ($agent.PSObject.Properties.Name -contains "key" -and $agent.key) {
            [string]$agent.key
        }
        elseif ($agent.PSObject.Properties.Name -contains "id" -and $agent.id) {
            [string]$agent.id
        }
        else {
            "unknown-agent"
        }

        if (($agent.PSObject.Properties.Name -contains "modelRef") -and [string]$agent.modelRef -eq $RemovedModelRef) {
            if ([string]::IsNullOrWhiteSpace($ReplacementModelRef)) {
                throw "Managed agent '$agentLabel' points to $RemovedModelRef and no replacement model was available. Add another local model first or pass -ReplaceWith."
            }

            $agent.modelRef = $ReplacementModelRef
            $changed.Add("$agentLabel.modelRef")
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
                $changed.Add("$agentLabel.candidateModelRefs")
            }
        }
    }

    return @($changed)
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

$currentIds = @(Get-LocalModelIds -Config $config)
$assignedEndpoints = @(Get-EndpointModelAssignments -Config $config -ModelId $Model)
$defaultOllamaEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $config
$installedOllamaIds = @(
    if ($null -ne $defaultOllamaEndpoint) {
        Get-OllamaInstalledModelIds -Endpoint $defaultOllamaEndpoint
    }
)
$isManagedModel = $Model -in $currentIds
$isInstalledInOllama = $Model -in $installedOllamaIds

$replacementId = $null
if ($ReplaceWith) {
    if ($ReplaceWith -eq $Model) {
        throw "-ReplaceWith cannot be the same model as -Model."
    }
    if ($ReplaceWith -notin $currentIds) {
        throw "Replacement model '$ReplaceWith' is not present in the managed endpoint model list."
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
        $endpointStateChanges = @(Remove-ModelEntry -Config $config -ModelId $Model)
        if ($endpointStateChanges.Count -eq 0) {
            throw "Failed to remove '$Model' from the managed bootstrap config."
        }

        $remainingIds = @(Get-LocalModelIds -Config $config)
        if (-not $replacementId -and $remainingIds.Count -gt 0) {
            $replacementId = $remainingIds[0]
        }

        $removedModelRef = "ollama/$Model"
        $replacementModelRef = if ($replacementId) { "ollama/$replacementId" } else { $null }
        $changedRefs = @(Replace-ManagedModelRefs -Config $config -RemovedModelRef $removedModelRef -ReplacementModelRef $replacementModelRef)

        if ($config.PSObject.Properties.Name -contains "toolsets" -and $null -ne $config.toolsets -and $config.PSObject.Properties.Name -contains "toolPolicy") {
            $config.PSObject.Properties.Remove("toolPolicy")
        }

        $config = ConvertTo-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
        $json = $config | ConvertTo-Json -Depth 50
        Set-Content -Path $ConfigPath -Value $json -Encoding UTF8

        Write-Host "Removed ollama/$Model from bootstrap config." -ForegroundColor Green
        if ($replacementId) {
            Write-Host "Replacement local model for managed references: ollama/$replacementId" -ForegroundColor Green
        }
        if ($changedRefs.Count -gt 0) {
            Write-Host ("Updated managed references: " + ($changedRefs -join ", ")) -ForegroundColor Green
        }
        if ($endpointStateChanges.Count -gt 0) {
            Write-Host ("Removed endpoint-specific model state: " + ($endpointStateChanges -join ", ")) -ForegroundColor Green
        }
    }
    else {
        Write-Host "WhatIf: would remove ollama/$Model from bootstrap config." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Model '$Model' is not in the managed bootstrap config; config update is skipped." -ForegroundColor Yellow
}

if (-not $KeepOllamaModel) {
    $storageRemovalEndpoints = New-Object System.Collections.Generic.List[object]
    foreach ($endpoint in $assignedEndpoints) {
        $storageRemovalEndpoints.Add($endpoint)
    }

    if ($storageRemovalEndpoints.Count -eq 0 -and $isInstalledInOllama -and $null -ne $defaultOllamaEndpoint) {
        $storageRemovalEndpoints.Add($defaultOllamaEndpoint)
    }

    if ($storageRemovalEndpoints.Count -gt 0) {
        $removalFailures = New-Object System.Collections.Generic.List[string]
        foreach ($endpoint in $storageRemovalEndpoints) {
            $endpointLabel = if ($endpoint.name) { "$($endpoint.key) ($($endpoint.name))" } else { [string]$endpoint.key }
            $hostBaseUrl = [string](Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint)
            Write-Step "Removing $Model from Ollama storage on endpoint $endpointLabel"
            if ($PSCmdlet.ShouldProcess("$endpointLabel [$hostBaseUrl]", "remove Ollama model $Model")) {
                $removeResult = Remove-OllamaModel -Endpoint $endpoint -ModelId $Model
                if ($removeResult.ExitCode -eq 0) {
                    Write-Host "Removed $Model from endpoint $endpointLabel." -ForegroundColor Green
                }
                elseif ($removeResult.Output -match '(?i)(not found|no such model|not currently loaded|cannot find)') {
                    Write-Host "Model '$Model' was not present on endpoint $endpointLabel." -ForegroundColor Yellow
                }
                else {
                    $removalFailures.Add("$endpointLabel [$hostBaseUrl]: $($removeResult.Output)")
                }
            }
            else {
                Write-Host "WhatIf: would remove $Model from endpoint $endpointLabel." -ForegroundColor Yellow
            }
        }

        if ($removalFailures.Count -gt 0) {
            throw "Ollama rm failed for '$Model' on one or more endpoints:`n$($removalFailures -join [Environment]::NewLine)"
        }
    }
    else {
        Write-Host "Model '$Model' was not installed in reachable Ollama endpoint storage." -ForegroundColor Yellow
    }
}
elseif ($KeepOllamaModel) {
    Write-Host "Keeping $Model in endpoint Ollama storage because -KeepOllamaModel was set." -ForegroundColor Yellow
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
    Write-Host "If you want to compact Docker Desktop storage separately, run: $(Join-Path (Split-Path $PSScriptRoot -Parent) 'run-openclaw.cmd') compact-storage" -ForegroundColor DarkGray
}


