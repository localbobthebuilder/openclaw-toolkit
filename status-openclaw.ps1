[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$HealthUrl
)

$ErrorActionPreference = "Stop"

# Refresh PATH from registry so newly installed tools (e.g. Ollama, Docker) are found
# even if the parent process (dashboard server) started before they were installed
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

# Resolve paths portably from the config file next to this script
$configFile = [System.IO.Path]::Combine($PSScriptRoot, "openclaw-bootstrap.config.json")
$composeFilePath = $null
. ([System.IO.Path]::Combine($PSScriptRoot, "shared-ollama-endpoints.ps1"))
. ([System.IO.Path]::Combine($PSScriptRoot, "shared-ollama-cloud-auth.ps1"))
$bootstrapConfig = $null
if (Test-Path $configFile) {
    . ([System.IO.Path]::Combine($PSScriptRoot, "shared-config-paths.ps1"))
    $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
    $cfg = Resolve-PortableConfigPaths -Config $cfg -BaseDir $PSScriptRoot
    $bootstrapConfig = $cfg
    if (-not $RepoPath)  { $RepoPath  = $cfg.repoPath }
    if (-not $HealthUrl) { $HealthUrl = "http://127.0.0.1:$($cfg.gatewayPort)/healthz" }
    if ($cfg.composeFilePath) { $composeFilePath = $cfg.composeFilePath }
}
if (-not $RepoPath)  { $RepoPath  = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\openclaw")) }
if (-not $HealthUrl) { $HealthUrl = "http://127.0.0.1:18789/healthz" }
if (-not $composeFilePath) { $composeFilePath = [System.IO.Path]::Combine($RepoPath, "docker-compose.yml") }

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure,
        [int]$TimeoutSeconds = 8
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

    try {
        $null = $process.Start()
    } catch [System.ComponentModel.Win32Exception] {
        if (-not $AllowFailure) {
            throw "Command not found: $FilePath"
        }
        return [pscustomobject]@{
            ExitCode = -1
            Output   = "not installed"
        }
    }

    # Read stdout/stderr asynchronously so we can enforce a wall-clock timeout
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $finished = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $finished) {
        try { $process.Kill() } catch {}
        if (-not $AllowFailure) {
            throw "Command timed out after ${TimeoutSeconds}s: $FilePath"
        }
        return [pscustomobject]@{
            ExitCode = -1
            Output   = "timed out"
        }
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    $exitCode = $process.ExitCode
    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine
    # wsl.exe (and some other Windows binaries) write UTF-16LE to stdout which leaves
    # NUL bytes between every character when read back as UTF-8. Strip them.
    $text = $text -replace [char]0, ''

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Get-AuthProfilesSnapshot {
    param([string]$ContainerName = "openclaw-openclaw-gateway-1")

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "sh", "-lc",
        "if [ -f /home/node/.openclaw/agents/main/agent/auth-profiles.json ]; then printf '__FOUND__\n'; cat /home/node/.openclaw/agents/main/agent/auth-profiles.json; fi"
    ) -AllowFailure -TimeoutSeconds 10

    if ($result.ExitCode -ne 0) {
        return [pscustomobject]@{
            Available = $false
            Exists    = $false
            Data      = $null
        }
    }

    if (-not $result.Output) {
        return [pscustomobject]@{
            Available = $true
            Exists    = $false
            Data      = $null
        }
    }

    $text = [string]$result.Output
    if (-not $text.StartsWith("__FOUND__")) {
        return [pscustomobject]@{
            Available = $true
            Exists    = $false
            Data      = $null
        }
    }

    $jsonText = ($text -replace "^__FOUND__\r?\n", "").Trim()
    try {
        return [pscustomobject]@{
            Available = $true
            Exists    = $true
            Data      = ($jsonText | ConvertFrom-Json -Depth 50)
        }
    }
    catch {
        return [pscustomobject]@{
            Available = $true
            Exists    = $true
            Data      = $null
        }
    }
}

function Test-ProviderProfilePresence {
    param(
        $Object,
        [string[]]$ProviderIds
    )

    if ($null -eq $Object) {
        return $false
    }

    if ($Object -is [string]) {
        return $false
    }

    $properties = @($Object.PSObject.Properties)
    foreach ($propertyName in @("provider", "providerId")) {
        $property = $properties | Where-Object { $_.Name -eq $propertyName } | Select-Object -First 1
        if ($property -and [string]$property.Value -in $ProviderIds) {
            return $true
        }
    }

    foreach ($property in $properties) {
        if (Test-ProviderProfilePresence -Object $property.Value -ProviderIds $ProviderIds) {
            return $true
        }
    }

    if ($Object -is [System.Collections.IEnumerable]) {
        foreach ($item in @($Object)) {
            if (Test-ProviderProfilePresence -Object $item -ProviderIds $ProviderIds) {
                return $true
            }
        }
    }

    return $false
}

function Read-JsonFile {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
        return $null
    }

    try {
        return (Get-Content $Path -Raw | ConvertFrom-Json -Depth 50)
    }
    catch {
        return $null
    }
}

function Test-TextForStringPattern {
    param(
        [string]$Text,
        [Parameter(Mandatory = $true)][regex]$Pattern
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    return $Pattern.IsMatch($Text)
}

function Get-HostOpenClawConfigPath {
    param($BootstrapConfig)

    $hostConfigDir = Get-ToolkitHostConfigDir -BootstrapConfig $BootstrapConfig
    return (Join-Path $hostConfigDir "openclaw.json")
}

function Test-OllamaWebSearchConfigured {
    param($Config)

    if ($null -eq $Config) {
        return $false
    }

    if ($Config.PSObject.Properties.Name -notcontains "tools" -or $null -eq $Config.tools) {
        return $false
    }
    if ($Config.tools.PSObject.Properties.Name -notcontains "web" -or $null -eq $Config.tools.web) {
        return $false
    }
    if ($Config.tools.web.PSObject.Properties.Name -notcontains "search" -or $null -eq $Config.tools.web.search) {
        return $false
    }
    if ($Config.tools.web.search.PSObject.Properties.Name -notcontains "provider") {
        return $false
    }

    return [string]$Config.tools.web.search.provider -eq "ollama"
}

function Get-OllamaCloudIntent {
    param(
        [string]$BootstrapConfigText,
        [string]$HostConfigText,
        $HostConfig
    )

    $cloudPattern = [regex]'"[^"\r\n]*:cloud"'
    $cloudModelsConfigured =
        (Test-TextForStringPattern -Text $BootstrapConfigText -Pattern $cloudPattern) -or
        (Test-TextForStringPattern -Text $HostConfigText -Pattern $cloudPattern)
    $webSearchConfigured = Test-OllamaWebSearchConfigured -Config $HostConfig

    return [pscustomobject]@{
        CloudModelsConfigured = $cloudModelsConfigured
        WebSearchConfigured   = $webSearchConfigured
        Needed                = $cloudModelsConfigured -or $webSearchConfigured
    }
}

function Get-OllamaListIdsFromText {
    param([string]$Text)

    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($Text -split "(`r`n|`n|`r)")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed -match '^NAME\s+') {
            continue
        }

        $parts = $trimmed -split '\s{2,}'
        if ($parts.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$parts[0])) {
            $ids.Add([string]$parts[0])
        }
    }

    return @($ids)
}

function Get-OllamaEndpointSnapshots {
    param($BootstrapConfig)

    $snapshots = @()
    if ($null -eq $BootstrapConfig -or -not (Test-ToolkitHasOllamaEndpoints -Config $BootstrapConfig)) {
        return $snapshots
    }

    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $BootstrapConfig)) {
        $hostBaseUrl = [string](Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint)
        $tagsUrl = $hostBaseUrl.TrimEnd("/") + "/api/tags"
        $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "--max-time", "2", $tagsUrl) -AllowFailure -TimeoutSeconds 4

        $modelIds = @()
        $missingDesiredIds = @()
        $reachable = $false

        if ($result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Output)) {
            $payload = [string]$result.Output
            try {
                $parsed = $payload | ConvertFrom-Json -Depth 50
                $modelIds = @(
                    foreach ($entry in @($parsed.models)) {
                        $modelId = if ($entry.PSObject.Properties.Name -contains "model" -and $entry.model) {
                            [string]$entry.model
                        }
                        elseif ($entry.PSObject.Properties.Name -contains "name" -and $entry.name) {
                            [string]$entry.name
                        }
                        else {
                            $null
                        }

                        if (-not [string]::IsNullOrWhiteSpace($modelId)) {
                            $modelId
                        }
                    }
                )
                $reachable = $true
            }
            catch {
                $modelIds = @(
                    foreach ($match in [regex]::Matches($payload, '"name"\s*:\s*"([^"]+)"')) {
                        [string]$match.Groups[1].Value
                    }
                )
                $reachable = $payload -match '"models"\s*:'
            }
        }

        $desiredModelIds = @(Get-ToolkitEndpointDesiredModelIds -Config $BootstrapConfig -EndpointKey ([string]$endpoint.key))
        if ($reachable -and $desiredModelIds.Count -gt 0) {
            $missingDesiredIds = @(
                foreach ($desiredId in $desiredModelIds) {
                    if ([string]$desiredId -notin $modelIds) {
                        [string]$desiredId
                    }
                }
            )
        }

        $snapshots += [pscustomobject]@{
            Key              = [string]$endpoint.key
            ProviderId       = [string]$endpoint.providerId
            HostBaseUrl      = $hostBaseUrl
            Reachable        = $reachable
            ModelIds         = @($modelIds)
            MissingDesiredIds = @($missingDesiredIds)
        }
    }

    return $snapshots
}

function Get-OllamaGatewayReachability {
    param(
        $Endpoint,
        [string]$ContainerName = "openclaw-openclaw-gateway-1"
    )

    if ($null -eq $Endpoint) {
        return $null
    }

    $probeUrl = ([string](Get-ToolkitOllamaProviderBaseUrl -Endpoint $Endpoint)).TrimEnd("/") + "/api/version"
    $probeScript = @'
const url = process.argv[1];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);
fetch(url, { signal: controller.signal })
  .then(async (res) => {
    const body = await res.text();
    console.log(JSON.stringify({ ok: res.ok, status: res.status, body: body.slice(0, 200) }));
  })
  .catch((err) => {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => clearTimeout(timer));
'@

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", $ContainerName,
        "node", "-e", $probeScript,
        $probeUrl
    ) -AllowFailure -TimeoutSeconds 8

    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Output)) {
        return [pscustomobject]@{
            Reachable = $false
            ProbeUrl  = $probeUrl
            Details   = [string]$result.Output
        }
    }

    $payload = [string]$result.Output
    if ($payload -match '"ok"\s*:\s*true') {
        $statusCode = if ($payload -match '"status"\s*:\s*([0-9]+)') { $Matches[1] } else { "200" }
        return [pscustomobject]@{
            Reachable = $true
            ProbeUrl  = $probeUrl
            Details   = "HTTP $statusCode"
        }
    }

    try {
        $parsed = $payload | ConvertFrom-Json -Depth 10
        return [pscustomobject]@{
            Reachable = [bool]$parsed.ok
            ProbeUrl  = $probeUrl
            Details   = "HTTP $($parsed.status)"
        }
    }
    catch {
        return [pscustomobject]@{
            Reachable = $false
            ProbeUrl  = $probeUrl
            Details   = [string]$result.Output
        }
    }
}

function Write-ProviderAuthSection {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string[]]$ProviderIds,
        [Parameter(Mandatory = $true)][string]$SetupCommand,
        [Parameter(Mandatory = $true)][string]$ReadyLabel,
        $AuthProfilesSnapshot = $null,
        [switch]$DockerInstalled,
        [switch]$DockerEngineReady,
        [switch]$BootstrapReady
    )

    Write-Host ""
    Write-Host "[$Title]" -ForegroundColor Cyan

    if (-not $DockerInstalled) {
        Write-Host "Provider auth: not installed" -ForegroundColor Red
        return
    }
    if (-not $DockerEngineReady) {
        Write-Host "Provider auth: not ready (Docker engine not running)" -ForegroundColor Yellow
        return
    }
    if (-not $BootstrapReady) {
        Write-Host "Provider auth: bootstrap not run yet" -ForegroundColor Yellow
        return
    }
    if ($null -eq $AuthProfilesSnapshot -or -not $AuthProfilesSnapshot.Available) {
        Write-Host "Provider auth: not ready (gateway auth store unavailable)" -ForegroundColor Yellow
        return
    }

    if ($AuthProfilesSnapshot.Exists -and (Test-ProviderProfilePresence -Object $AuthProfilesSnapshot.Data -ProviderIds $ProviderIds)) {
        Write-Host "$($ReadyLabel): ready" -ForegroundColor Green
        Write-Host "Source: gateway auth profiles"
        return
    }

    Write-Host "$($ReadyLabel): not configured yet" -ForegroundColor Yellow
    Write-Host "Run: $SetupCommand"
}

# Check Docker installation with a fast command (no daemon connection needed),
# then separately check if the engine is actually running.
$dockerVersion   = Invoke-External -FilePath "docker" -Arguments @("--version") -AllowFailure -TimeoutSeconds 5
$dockerInstalled = $dockerVersion.ExitCode -ne -1   # -1 = Win32Exception = binary not found

# Only probe the daemon if Docker is installed — docker info hangs indefinitely otherwise
if ($dockerInstalled) {
    $dockerInfo = Invoke-External -FilePath "docker" -Arguments @("info") -AllowFailure
} else {
    $dockerInfo = [PSCustomObject]@{ ExitCode = -1; Output = "not installed" }
}

$wslVersion  = Invoke-External -FilePath "wsl" -Arguments @("--version") -AllowFailure

# $dockerInstalled already set above via docker --version
$dockerEngineReady = $dockerInstalled -and $dockerInfo.ExitCode -eq 0
$wslReady = $wslVersion.ExitCode -eq 0 -and $wslVersion.Output -match 'WSL version:\s*[0-9]+'

# Only call the gateway health endpoint when the Docker engine is actually running;
# otherwise curl just burns its full timeout before failing.
if ($dockerEngineReady) {
    $health = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "--max-time", "5", $HealthUrl) -AllowFailure
} else {
    $health = [PSCustomObject]@{ ExitCode = -1; Output = "not installed" }
}

if ($dockerEngineReady) {
    $containers = Invoke-External -FilePath "docker" -Arguments @(
        "ps", "--format", "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
    ) -AllowFailure
    $composePs = Invoke-External -FilePath "docker" -Arguments @(
        "compose", "-f", $composeFilePath, "ps"
    ) -AllowFailure
} else {
    $containers = [PSCustomObject]@{ ExitCode = -1; Output = "" }
    $composePs  = [PSCustomObject]@{ ExitCode = -1; Output = "" }
}
$serve  = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure
$ollamaVersion = Invoke-External -FilePath "ollama" -Arguments @("--version") -AllowFailure -TimeoutSeconds 5
$ollamaInstalled = $ollamaVersion.ExitCode -ne -1
if ($ollamaInstalled) {
    $ollamaList = Invoke-External -FilePath "ollama" -Arguments @("list") -AllowFailure
}
else {
    $ollamaList = [PSCustomObject]@{ ExitCode = -1; Output = "not installed" }
}
$ollamaReady = $ollamaInstalled -and $ollamaList.ExitCode -eq 0
$bootstrapReady = Test-Path $RepoPath
$authProfilesSnapshot = if ($dockerEngineReady -and $bootstrapReady) { Get-AuthProfilesSnapshot } else { $null }
$bootstrapConfigText = if (Test-Path $configFile) { Get-Content $configFile -Raw } else { "" }
$hostOpenClawConfigPath = Get-HostOpenClawConfigPath -BootstrapConfig $bootstrapConfig
$hostOpenClawConfigText = if (Test-Path $hostOpenClawConfigPath) { Get-Content $hostOpenClawConfigPath -Raw } else { "" }
$hostOpenClawConfig = Read-JsonFile -Path $hostOpenClawConfigPath
$ollamaCloudIntent = Get-OllamaCloudIntent `
    -BootstrapConfigText $bootstrapConfigText `
    -HostConfigText $hostOpenClawConfigText `
    -HostConfig $hostOpenClawConfig
$ollamaCloudMarker = Read-OllamaCloudAuthMarker -BootstrapConfig $bootstrapConfig
$ollamaEndpointSnapshots = if ($ollamaInstalled) { @(Get-OllamaEndpointSnapshots -BootstrapConfig $bootstrapConfig) } else { @() }
$defaultOllamaEndpoint = if ($bootstrapConfig) { Get-ToolkitDefaultOllamaEndpoint -Config $bootstrapConfig } else { $null }
$ollamaGatewayReachability = if ($dockerEngineReady -and $bootstrapReady -and $defaultOllamaEndpoint) {
    Get-OllamaGatewayReachability -Endpoint $defaultOllamaEndpoint
} else {
    $null
}

Write-Host "[Virtualization]" -ForegroundColor Cyan
$csInfo = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
$vmms = Get-Service -Name "vmms" -ErrorAction SilentlyContinue
$virtOk = ($csInfo -and $csInfo.HypervisorPresent) -or ($vmms -and $vmms.Status -eq "Running")
if ($virtOk) {
    Write-Host "Virtualization: enabled" -ForegroundColor Green
} else {
    Write-Host "Virtualization: not installed" -ForegroundColor Red
}

Write-Host ""
Write-Host "[WSL2]" -ForegroundColor Cyan
if ($wslReady -and $wslVersion.Output -match 'WSL version:\s*([0-9.]+)') {
    Write-Host "WSL version: $($Matches[1])" -ForegroundColor Green
} else {
    # wsl.exe is always present on Windows - a non-matching result means the feature
    # is not installed/enabled, not just "not ready"
    Write-Host "WSL2: not installed" -ForegroundColor Red
}

Write-Host ""
Write-Host "[Docker]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Docker: not installed" -ForegroundColor Red
} elseif ($dockerEngineReady) {
    Write-Host "Docker engine: ready" -ForegroundColor Green
} else {
    Write-Host "Docker engine: not ready" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Bootstrap]" -ForegroundColor Cyan
if ($bootstrapReady) {
    Write-Host "Repo: found at $RepoPath" -ForegroundColor Green
} else {
    Write-Host "Repo: not cloned yet" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Gateway]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Gateway: not installed" -ForegroundColor Red
} elseif (-not $dockerEngineReady) {
    Write-Host "Gateway: not installed" -ForegroundColor Red
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Gateway: bootstrap not run yet" -ForegroundColor Yellow
} elseif ($health.ExitCode -eq 0 -and $health.Output -match '"ok"\s*:\s*true') {
    Write-Host $health.Output -ForegroundColor Green
} else {
    Write-Host "Gateway health check failed." -ForegroundColor Yellow
    if ($health.Output -and $health.Output -ne "not installed") {
        Write-Host $health.Output
    }
}

Write-Host ""
Write-Host "[Compose]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Compose: not installed"
} elseif (-not $dockerEngineReady) {
    Write-Host "Compose: not ready"
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Compose: bootstrap not run yet"
} elseif ($composePs.Output) {
    Write-Host $composePs.Output
}

Write-Host ""
Write-Host "[Containers]" -ForegroundColor Cyan
if (-not $dockerInstalled) {
    Write-Host "Containers: not installed"
} elseif (-not $dockerEngineReady) {
    Write-Host "Containers: not ready"
} elseif (-not (Test-Path $RepoPath)) {
    Write-Host "Containers: bootstrap not run yet"
} elseif ($containers.Output) {
    Write-Host $containers.Output
}

Write-Host ""
Write-Host "[Tailscale Serve]" -ForegroundColor Cyan
if ($serve.Output) {
    Write-Host $serve.Output
}
else {
    Write-Host "No Tailscale Serve status available."
}

Write-Host ""
Write-Host "[Ollama Runtime]" -ForegroundColor Cyan
if (-not $ollamaInstalled) {
    Write-Host "Ollama runtime: not installed" -ForegroundColor Red
    Write-Host "Run: .\run-openclaw.cmd prereqs"
}
elseif (-not $ollamaReady) {
    Write-Host "Ollama runtime: not responding" -ForegroundColor Yellow
    if ($ollamaList.Output -and $ollamaList.Output -ne "not installed") {
        Write-Host $ollamaList.Output
    }
    Write-Host "Run: .\run-openclaw.cmd start"
}
else {
    Write-Host "Ollama runtime: ready" -ForegroundColor Green
    if ($ollamaVersion.Output) {
        Write-Host $ollamaVersion.Output.Trim()
    }

    if ($defaultOllamaEndpoint) {
        Write-Host "Host endpoint: $([string](Get-ToolkitOllamaHostBaseUrl -Endpoint $defaultOllamaEndpoint))"
        Write-Host "Gateway endpoint: $([string](Get-ToolkitOllamaProviderBaseUrl -Endpoint $defaultOllamaEndpoint))"
    }

    if ($null -ne $ollamaGatewayReachability) {
        if ($ollamaGatewayReachability.Reachable) {
            Write-Host "Gateway path: reachable" -ForegroundColor Green
        }
        else {
            Write-Host "Gateway path: not reachable" -ForegroundColor Yellow
            if ($ollamaGatewayReachability.Details) {
                Write-Host $ollamaGatewayReachability.Details
            }
        }
    }
    elseif ($defaultOllamaEndpoint) {
        Write-Host "Gateway path: waiting for Docker and bootstrap before checking."
    }
}

Write-Host ""
Write-Host "[Ollama Local Models]" -ForegroundColor Cyan
if (-not $ollamaInstalled) {
    Write-Host "Ollama local models: not installed" -ForegroundColor Red
}
elseif (-not $ollamaReady) {
    Write-Host "Ollama local models: runtime not ready" -ForegroundColor Yellow
}
elseif ($ollamaEndpointSnapshots.Count -gt 0) {
    foreach ($snapshot in $ollamaEndpointSnapshots) {
        if ($snapshot.Reachable) {
            Write-Host "Endpoint $($snapshot.Key): $($snapshot.ModelIds.Count) models available" -ForegroundColor Green
            Write-Host "Host URL: $($snapshot.HostBaseUrl)"
            if ($snapshot.ModelIds.Count -gt 0) {
                Write-Host "Examples: $((@($snapshot.ModelIds) | Select-Object -First 5) -join ', ')"
            }
            else {
                Write-Host "No local models pulled on this endpoint yet."
            }
            if ($snapshot.MissingDesiredIds.Count -gt 0) {
                Write-Host "Missing desired models: $($snapshot.MissingDesiredIds -join ', ')" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "Endpoint $($snapshot.Key): unreachable" -ForegroundColor Yellow
            Write-Host "Host URL: $($snapshot.HostBaseUrl)"
        }
    }
    Write-Host "Run: .\run-openclaw.cmd add-local-model -Model <ollama-model-id>"
}
else {
    $localModelIds = @(Get-OllamaListIdsFromText -Text $ollamaList.Output)
    if ($localModelIds.Count -gt 0) {
        Write-Host "Host runtime: $($localModelIds.Count) local models available" -ForegroundColor Green
        Write-Host "Examples: $((@($localModelIds) | Select-Object -First 5) -join ', ')"
    }
    else {
        Write-Host "No local models pulled yet." -ForegroundColor Yellow
    }
    Write-Host "Run: .\run-openclaw.cmd add-local-model -Model <ollama-model-id>"
}

Write-Host ""
Write-Host "[Ollama Cloud Auth]" -ForegroundColor Cyan
if (-not $ollamaInstalled) {
    Write-Host "Ollama cloud auth: not installed" -ForegroundColor Red
}
elseif (-not $ollamaReady) {
    Write-Host "Ollama cloud auth: runtime not ready" -ForegroundColor Yellow
}
elseif (-not $ollamaCloudIntent.Needed) {
    if ($ollamaCloudMarker -and $ollamaCloudMarker.recordedAt) {
        Write-Host "Ollama cloud auth: toolkit sign-in recorded (optional)" -ForegroundColor Green
        Write-Host "Recorded at: $($ollamaCloudMarker.recordedAt)"
    }
    else {
        Write-Host "Ollama cloud auth: not needed (local-only mode)" -ForegroundColor Green
    }
    Write-Host "Cloud models and Ollama Web Search stay optional until you choose them."
    Write-Host "Run: .\run-openclaw.cmd ollama-auth"
}
elseif ($ollamaCloudMarker -and $ollamaCloudMarker.recordedAt) {
    Write-Host "Ollama cloud auth: toolkit sign-in recorded" -ForegroundColor Green
    Write-Host "Recorded at: $($ollamaCloudMarker.recordedAt)"
    if ($ollamaCloudIntent.CloudModelsConfigured) {
        Write-Host "Cloud models are configured for Ollama."
    }
    if ($ollamaCloudIntent.WebSearchConfigured) {
        Write-Host "Ollama Web Search is configured."
    }
}
else {
    Write-Host "Ollama cloud auth: not verified yet" -ForegroundColor Yellow
    if ($ollamaCloudIntent.CloudModelsConfigured -and $ollamaCloudIntent.WebSearchConfigured) {
        Write-Host "Configured Ollama cloud models and Ollama Web Search need a host ollama signin session."
    }
    elseif ($ollamaCloudIntent.CloudModelsConfigured) {
        Write-Host "Configured Ollama cloud models need a host ollama signin session."
    }
    elseif ($ollamaCloudIntent.WebSearchConfigured) {
        Write-Host "Ollama Web Search needs a host ollama signin session."
    }
    Write-Host "Run: .\run-openclaw.cmd ollama-auth"
}

Write-ProviderAuthSection `
    -Title "OpenAI Auth" `
    -ProviderIds @("openai", "openai-codex") `
    -SetupCommand ".\run-openclaw.cmd openai-auth" `
    -ReadyLabel "OpenAI auth" `
    -AuthProfilesSnapshot $authProfilesSnapshot `
    -DockerInstalled:$dockerInstalled `
    -DockerEngineReady:$dockerEngineReady `
    -BootstrapReady:$bootstrapReady

Write-ProviderAuthSection `
    -Title "Claude Auth" `
    -ProviderIds @("anthropic") `
    -SetupCommand ".\run-openclaw.cmd claude-auth" `
    -ReadyLabel "Claude auth" `
    -AuthProfilesSnapshot $authProfilesSnapshot `
    -DockerInstalled:$dockerInstalled `
    -DockerEngineReady:$dockerEngineReady `
    -BootstrapReady:$bootstrapReady

Write-ProviderAuthSection `
    -Title "Gemini Auth" `
    -ProviderIds @("google") `
    -SetupCommand ".\run-openclaw.cmd gemini-auth" `
    -ReadyLabel "Gemini auth" `
    -AuthProfilesSnapshot $authProfilesSnapshot `
    -DockerInstalled:$dockerInstalled `
    -DockerEngineReady:$dockerEngineReady `
    -BootstrapReady:$bootstrapReady

Write-ProviderAuthSection `
    -Title "Copilot Auth" `
    -ProviderIds @("github-copilot") `
    -SetupCommand ".\run-openclaw.cmd copilot-auth" `
    -ReadyLabel "Copilot auth" `
    -AuthProfilesSnapshot $authProfilesSnapshot `
    -DockerInstalled:$dockerInstalled `
    -DockerEngineReady:$dockerEngineReady `
    -BootstrapReady:$bootstrapReady
