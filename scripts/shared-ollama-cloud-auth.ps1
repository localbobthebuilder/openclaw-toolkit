function Get-ToolkitHostConfigDir {
    param($BootstrapConfig)

    if ($BootstrapConfig -and
        $BootstrapConfig.PSObject.Properties.Name -contains "hostConfigDir" -and
        -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.hostConfigDir)) {
        return [string]$BootstrapConfig.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-OllamaCloudAuthMarkerPath {
    param($BootstrapConfig)

    $stateDir = Join-Path (Get-ToolkitHostConfigDir -BootstrapConfig $BootstrapConfig) "toolkit-state"
    return (Join-Path $stateDir "ollama-cloud-auth.json")
}

function Read-OllamaCloudAuthMarker {
    param($BootstrapConfig)

    $path = Get-OllamaCloudAuthMarkerPath -BootstrapConfig $BootstrapConfig
    if (-not (Test-Path $path)) {
        return $null
    }

    try {
        return (Get-Content $path -Raw | ConvertFrom-Json -Depth 20)
    }
    catch {
        return $null
    }
}

function Write-OllamaCloudAuthMarker {
    param($BootstrapConfig)

    $path = Get-OllamaCloudAuthMarkerPath -BootstrapConfig $BootstrapConfig
    $directory = Split-Path -Parent $path
    if (-not (Test-Path $directory)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }

    $payload = [ordered]@{
        provider   = "ollama"
        source     = "toolkit-ollama-signin"
        recordedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    $payload | ConvertTo-Json -Depth 5 | Set-Content -Path $path -Encoding UTF8
    return $path
}
