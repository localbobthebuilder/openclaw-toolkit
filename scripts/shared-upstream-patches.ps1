function Get-ManagedUpstreamPatches {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    $result = @()
    if (-not ($Config.PSObject.Properties.Name -contains "upstreamPatches") -or -not $Config.upstreamPatches) {
        return @()
    }

    foreach ($patch in @($Config.upstreamPatches)) {
        if ($patch.PSObject.Properties.Name -contains "enabled" -and -not [bool]$patch.enabled) {
            continue
        }

        if (-not ($patch.PSObject.Properties.Name -contains "path") -or [string]::IsNullOrWhiteSpace([string]$patch.path)) {
            throw "Managed upstream patch entry is missing a path."
        }

        $managedPaths = @()
        if ($patch.PSObject.Properties.Name -contains "managedPaths" -and $patch.managedPaths) {
            foreach ($managedPath in @($patch.managedPaths)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$managedPath)) {
                    $managedPaths += [string]$managedPath
                }
            }
        }

        $result += [pscustomobject]@{
            Name         = if ($patch.PSObject.Properties.Name -contains "name" -and $patch.name) { [string]$patch.name } else { [System.IO.Path]::GetFileNameWithoutExtension([string]$patch.path) }
            Path         = Resolve-ConfigPathValue -Value ([string]$patch.path) -BaseDir $BaseDir
            ManagedPaths = @($managedPaths | Select-Object -Unique)
        }
    }

    return @($result)
}

function Get-ManagedUpstreamPatchPaths {
    param([Parameter(Mandatory = $true)][object[]]$Patches)

    return @(
        $Patches |
        ForEach-Object { @($_.ManagedPaths) } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    )
}

function Invoke-ApplyManagedUpstreamPatches {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][object[]]$Patches,
        [Parameter(Mandatory = $true)][scriptblock]$InvokeExternal,
        [scriptblock]$WriteStatus
    )

    $gitApplyWhitespaceArgs = @("--ignore-space-change", "--ignore-whitespace")

    foreach ($patch in $Patches) {
        if (-not (Test-Path -LiteralPath $patch.Path)) {
            throw "Managed upstream patch file not found: $($patch.Path)"
        }

        $reverseCheckArgs = @("-C", $RepoPath, "apply", "--reverse", "--check") + $gitApplyWhitespaceArgs + @($patch.Path)
        $reverseCheck = & $InvokeExternal -FilePath "git" -Arguments $reverseCheckArgs -AllowFailure -Quiet
        if ($reverseCheck.ExitCode -eq 0) {
            if ($WriteStatus) {
                & $WriteStatus "Managed upstream patch already applied: $($patch.Name)"
            }
            continue
        }

        $forwardCheckArgs = @("-C", $RepoPath, "apply", "--check") + $gitApplyWhitespaceArgs + @($patch.Path)
        $forwardCheck = & $InvokeExternal -FilePath "git" -Arguments $forwardCheckArgs -AllowFailure -Quiet
        if ($forwardCheck.ExitCode -ne 0) {
            $detail = if ($forwardCheck.Output) { "`n$($forwardCheck.Output)" } else { "" }
            throw "Managed upstream patch '$($patch.Name)' could not be applied to $RepoPath.$detail"
        }

        $applyArgs = @("-C", $RepoPath, "apply", "--whitespace=nowarn") + $gitApplyWhitespaceArgs + @($patch.Path)
        $null = & $InvokeExternal -FilePath "git" -Arguments $applyArgs
        if ($WriteStatus) {
            & $WriteStatus "Applied managed upstream patch: $($patch.Name)"
        }
    }
}
