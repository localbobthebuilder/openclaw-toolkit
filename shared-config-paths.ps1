function Resolve-ConfigPathValue {
    param(
        [string]$Value,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ($Value -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return $Value
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $Value))
}

function Resolve-PortableConfigPaths {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$BaseDir
    )

    foreach ($propertyName in @("repoPath", "composeFilePath", "envFilePath", "envTemplatePath", "hostConfigDir", "hostWorkspaceDir")) {
        if ($Config.PSObject.Properties.Name -contains $propertyName -and $Config.$propertyName) {
            $Config.$propertyName = Resolve-ConfigPathValue -Value ([string]$Config.$propertyName) -BaseDir $BaseDir
        }
    }

    if ($Config.verification -and $Config.verification.PSObject.Properties.Name -contains "reportPath" -and $Config.verification.reportPath) {
        $Config.verification.reportPath = Resolve-ConfigPathValue -Value ([string]$Config.verification.reportPath) -BaseDir $BaseDir
    }

    return $Config
}
