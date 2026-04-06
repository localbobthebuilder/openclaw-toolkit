[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string[]]$Checks
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

function Resolve-RequestedChecks {
    param([string[]]$Values)

    $validChecks = @("all", "health", "docker", "tailscale", "models", "telegram", "voice", "local-model", "agent", "sandbox", "chat-write", "audit", "git", "multi-agent", "context")

    if ($null -eq $Values -or $Values.Count -eq 0) {
        return @("all")
    }

    $resolved = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($Values)) {
        foreach ($token in @($value -split '[,\s;]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
            $normalized = switch -Regex ($token.Trim().ToLowerInvariant()) {
                '^all$' { "all"; break }
                '^health$' { "health"; break }
                '^docker$' { "docker"; break }
                '^tailscale$' { "tailscale"; break }
                '^models?$' { "models"; break }
                '^telegram$' { "telegram"; break }
                '^voice(-notes?)?$' { "voice"; break }
                '^local(-|_)?models?$' { "local-model"; break }
                '^agent(-|_)?smoke$' { "agent"; break }
                '^agents?$' { "agent"; break }
                '^sandbox(-test)?$' { "sandbox"; break }
                '^chat(-|_)?write$' { "chat-write"; break }
                '^audit$' { "audit"; break }
                '^git$' { "git"; break }
                '^multi(-|_)?agent$' { "multi-agent"; break }
                '^context(-|_)?management$' { "context"; break }
                '^context$' { "context"; break }
                default { $null }
            }

            if ([string]::IsNullOrWhiteSpace($normalized)) {
                throw "Unknown verify check '$token'. Valid values: $($validChecks -join ', ')"
            }

            if ($normalized -notin @($resolved)) {
                $resolved.Add($normalized)
            }
        }
    }

    if ("all" -in @($resolved)) {
        return @("all")
    }

    return @($resolved)
}

$script:RequestedChecks = Resolve-RequestedChecks -Values $Checks

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

$usingPowerShellCore = $PSVersionTable.PSEdition -eq "Core"
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $usingPowerShellCore -and $null -ne $pwshCommand) {
    Write-Host "INFO: Running under Windows PowerShell. 'pwsh' is installed and preferred for future verification runs." -ForegroundColor Yellow
    Write-Host "INFO: Next time, launch via run-verify.cmd or run:" -ForegroundColor Yellow
    Write-Host "      pwsh -ExecutionPolicy Bypass -File $($MyInvocation.MyCommand.Path)" -ForegroundColor Yellow
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Detail {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "    $Message" -ForegroundColor $Color
}

function Test-CheckRequested {
    param([string[]]$Names)

    if ("all" -in @($script:RequestedChecks)) {
        return $true
    }

    foreach ($name in @($Names)) {
        if ($name -in @($script:RequestedChecks)) {
            return $true
        }
    }

    return $false
}

function New-SkippedExternalResult {
    param([string]$Message = "Skipped: not requested.")

    return [pscustomobject]@{
        ExitCode = $null
        Output   = $Message
    }
}

function Add-ReportSection {
    param(
        [Parameter(Mandatory = $true)]$Lines,
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Content
    )

    [void]$Lines.Add("")
    [void]$Lines.Add("[$Title]")
    [void]$Lines.Add($Content)
}

function Format-Duration {
    param([Parameter(Mandatory = $true)][timespan]$Elapsed)

    if ($Elapsed.TotalMinutes -ge 1) {
        return "{0:mm\:ss}" -f $Elapsed
    }

    return "{0:N1}s" -f $Elapsed.TotalSeconds
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

function Invoke-LoggedExternal {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure,
        [string]$SuccessSummary,
        [string]$FailureSummary
    )

    Write-Step $Label
    $started = Get-Date
    try {
        $result = Invoke-External -FilePath $FilePath -Arguments $Arguments -AllowFailure:$AllowFailure
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)

        if ($result.ExitCode -eq 0) {
            $message = if ($SuccessSummary) { $SuccessSummary } else { "PASS in $elapsed" }
            Write-Detail $message ([ConsoleColor]::Green)
        }
        else {
            $message = if ($FailureSummary) { $FailureSummary } else { "WARN: exit code $($result.ExitCode) in $elapsed" }
            Write-Detail $message ([ConsoleColor]::Yellow)
        }

        return $result
    }
    catch {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "FAIL in $elapsed" ([ConsoleColor]::Red)
        $errorText = ($_ | Out-String).Trim()
        if ($errorText) {
            $preview = ($errorText -split "(`r`n|`n|`r)")[0]
            Write-Detail $preview ([ConsoleColor]::Red)
        }
        throw
    }
}

function Invoke-LoggedScript {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Alias("Arguments")]
        [string[]]$ScriptArguments = @(),
        [hashtable]$ScriptParameters = @{},
        [string]$SkipMessage
    )

    if (-not (Test-Path $ScriptPath)) {
        Write-Step $Label
        $message = if ($SkipMessage) { $SkipMessage } else { "Skipped: script not found at $ScriptPath" }
        Write-Detail $message ([ConsoleColor]::Yellow)
        return $message
    }

    Write-Step $Label
    $started = Get-Date
    $captured = New-Object System.Collections.Generic.List[string]

    try {
        if ($ScriptParameters.Count -gt 0) {
            & $ScriptPath @ScriptParameters 2>&1 | ForEach-Object {
                $line = ($_ | Out-String).TrimEnd()
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $captured.Add($line)
                    Write-Detail $line ([ConsoleColor]::Gray)
                }
            }
        }
        else {
            & $ScriptPath @ScriptArguments 2>&1 | ForEach-Object {
                $line = ($_ | Out-String).TrimEnd()
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $captured.Add($line)
                    Write-Detail $line ([ConsoleColor]::Gray)
                }
            }
        }

        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "PASS in $elapsed" ([ConsoleColor]::Green)
        return ($captured -join [Environment]::NewLine).Trim()
    }
    catch {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        $errorText = ($_ | Out-String).Trim()
        Write-Detail "FAIL in $elapsed" ([ConsoleColor]::Red)
        if ($errorText) {
            $captured.Add($errorText)
            $preview = ($errorText -split "(`r`n|`n|`r)")[0]
            Write-Detail $preview ([ConsoleColor]::Red)
        }
        return (($captured + @("Verification sub-step failed.", $errorText)) -join [Environment]::NewLine).Trim()
    }
}

function Get-SmokeStructuredResult {
    param([string]$Output)

    if ([string]::IsNullOrWhiteSpace($Output)) {
        return $null
    }

    $match = [regex]::Match($Output, '__SMOKE_JSON__:\s*(\{.*\})')
    if (-not $match.Success) {
        return $null
    }

    try {
        return ($match.Groups[1].Value | ConvertFrom-Json -Depth 20)
    }
    catch {
        return $null
    }
}

function Get-SmokeSummaryLabel {
    param(
        [string]$Output,
        $StructuredResult
    )

    if ($null -ne $StructuredResult -and $StructuredResult.PSObject.Properties.Name -contains "status") {
        switch -Regex ([string]$StructuredResult.status) {
            '^pass$' { return "PASS" }
            '^fail$' { return "FAIL" }
            '^skip$' { return "SKIP/INFO" }
        }
    }

    if ($Output -match 'passed|Voice-note transcription result') { return "PASS" }
    if ($Output -match 'failed') { return "FAIL" }
    return "SKIP/INFO"
}

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Get-HostWorkspaceDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostWorkspaceDir" -and $Config.hostWorkspaceDir) {
        return [string]$Config.hostWorkspaceDir
    }

    return (Join-Path (Get-HostConfigDir -Config $Config) "workspace")
}

function Resolve-HostWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$WorkspacePath
    )

    $hostConfigDir = Get-HostConfigDir -Config $Config
    $hostWorkspaceDir = Get-HostWorkspaceDir -Config $Config
    $defaultContainerWorkspace = "/home/node/.openclaw/workspace"
    $containerHomeRoot = "/home/node/.openclaw"

    if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or $WorkspacePath -eq $defaultContainerWorkspace) {
        return $hostWorkspaceDir
    }

    if ($WorkspacePath.StartsWith($containerHomeRoot + "/")) {
        $relative = $WorkspacePath.Substring(($containerHomeRoot + "/").Length) -replace '/', '\'
        return (Join-Path $hostConfigDir $relative)
    }

    return $hostWorkspaceDir
}

function Add-UniqueString {
    param(
        [string[]]$List = @(),
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @($List)
    }

    if ($Value -notin @($List)) {
        return @(@($List) + $Value)
    }

    return @($List)
}

function Resolve-ExpectedConfiguredModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig,
        [string]$ModelRef
    )

    if ([string]::IsNullOrWhiteSpace($ModelRef)) {
        return $ModelRef
    }

    if (-not ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $ModelRef) -or $ModelRef -like "ollama/*")) {
        return $ModelRef
    }

    return (Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $ModelRef -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig))
}

function Convert-NormalizedJson {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    return ($Value | ConvertTo-Json -Depth 50 -Compress)
}

function Test-BindingMatch {
    param(
        [Parameter(Mandatory = $true)]$Binding,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$Channel,
        [Parameter(Mandatory = $true)][string]$PeerKind,
        [Parameter(Mandatory = $true)][string]$PeerId
    )

    return (
        $Binding.agentId -eq $AgentId -and
        $Binding.match.channel -eq $Channel -and
        $Binding.match.peer.kind -eq $PeerKind -and
        [string]$Binding.match.peer.id -eq $PeerId
    )
}

function Resolve-ExpectedStrongModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$LiveConfig
    )

    $candidateRefs = @()
    foreach ($candidate in @($Config.multiAgent.strongAgent.candidateModelRefs)) {
        if ($candidate) {
            $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$candidate)
        }
    }
    if ($Config.multiAgent.strongAgent.modelRef) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$Config.multiAgent.strongAgent.modelRef)
    }

    $authReadyProviders = @()
    foreach ($profile in @($LiveConfig.auth.profiles.PSObject.Properties.Value)) {
        if ($profile.provider) {
            $authReadyProviders = Add-UniqueString -List $authReadyProviders -Value ([string]$profile.provider)
        }
    }

    foreach ($candidateRef in @($candidateRefs)) {
        if ($candidateRef -like "ollama/*") {
            if ($candidateRef -in @($LiveConfig.agents.defaults.models.PSObject.Properties.Name)) {
                return $candidateRef
            }
            continue
        }

        $providerId = ($candidateRef -split "/", 2)[0]
        if ($providerId -in @($authReadyProviders)) {
            return $candidateRef
        }
    }

    if ($Config.multiAgent.strongAgent.allowLocalFallback) {
        $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
        $defaultEndpointKey = if ($null -ne $defaultEndpoint) { [string]$defaultEndpoint.key } else { "local" }
        foreach ($model in @(Get-ToolkitEndpointModelCatalog -Config $Config -EndpointKey $defaultEndpointKey)) {
            if ($model.id) {
                $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $defaultEndpointKey
                if ($candidate -in @($LiveConfig.agents.defaults.models.PSObject.Properties.Name)) {
                    return $candidate
                }
            }
        }
    }

    return [string]$Config.multiAgent.strongAgent.modelRef
}

function Get-AuthReadyProvidersFromLiveConfig {
    param([Parameter(Mandatory = $true)]$LiveConfig)

    $providers = @()
    foreach ($profile in @($LiveConfig.auth.profiles.PSObject.Properties.Value)) {
        if ($profile.provider) {
            $providers = Add-UniqueString -List $providers -Value ([string]$profile.provider)
        }
    }

    return @($providers)
}

function Resolve-ExpectedHostedCandidateModelRef {
    param(
        [Parameter(Mandatory = $true)][string[]]$CandidateRefs,
        [Parameter(Mandatory = $true)][string[]]$AuthReadyProviders
    )

    $candidates = @()
    foreach ($candidateRef in @($CandidateRefs)) {
        $candidates = Add-UniqueString -List $candidates -Value ([string]$candidateRef)
    }

    foreach ($candidateRef in @($candidates)) {
        if ($candidateRef -like "ollama/*") {
            continue
        }

        $providerId = ($candidateRef -split "/", 2)[0]
        if ($providerId -in @($AuthReadyProviders)) {
            return $candidateRef
        }
    }

    if (@($candidates).Count -gt 0) {
        return [string](@($candidates)[0])
    }

    return $null
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$requiredConfigPaths = @(
    @{ Name = "repoPath"; Value = [string]$config.repoPath },
    @{ Name = "verification.healthUrl"; Value = [string]$config.verification.healthUrl },
    @{ Name = "verification.reportPath"; Value = [string]$config.verification.reportPath }
)
foreach ($requiredPath in $requiredConfigPaths) {
    if ([string]::IsNullOrWhiteSpace($requiredPath.Value)) {
        throw "Missing required bootstrap config value: $($requiredPath.Name)"
    }
}
if (-not (Test-Path $config.repoPath)) {
    throw "Configured repoPath does not exist: $($config.repoPath)"
}

$hostConfigPath = Join-Path (Get-HostConfigDir -Config $config) "openclaw.json"
$liveConfig = $null
if (Test-Path $hostConfigPath) {
    try {
        $liveConfig = Get-Content -Raw $hostConfigPath | ConvertFrom-Json -Depth 50
    }
    catch {
        $liveConfig = $null
    }
}

@(
    @{ Name = "curl.exe"; Required = (Test-CheckRequested -Names @("health")) },
    @{ Name = "docker"; Required = (Test-CheckRequested -Names @("docker", "models", "telegram", "voice", "local-model", "agent", "sandbox", "chat-write", "audit")) },
    @{ Name = "tailscale"; Required = (Test-CheckRequested -Names @("tailscale")) },
    @{ Name = "git"; Required = (Test-CheckRequested -Names @("git")) }
) | Where-Object { $_.Required } | ForEach-Object {
    $cmd = $_.Name
    if (-not (Test-CommandExists $cmd)) {
        throw "Missing required command: $cmd"
    }
}

Write-Step "Collecting OpenClaw verification data"
Write-Detail "Config: $ConfigPath"
Write-Detail "Host config: $hostConfigPath"
Write-Detail "Report: $($config.verification.reportPath)"
$health = New-SkippedExternalResult
if (Test-CheckRequested -Names @("health")) {
    $health = Invoke-LoggedExternal -Label "Gateway health check" -FilePath "curl.exe" -Arguments @("-s", $config.verification.healthUrl) -AllowFailure -SuccessSummary "Gateway health endpoint responded." -FailureSummary "Gateway health endpoint did not return success."
}
$dockerPs = New-SkippedExternalResult
if (Test-CheckRequested -Names @("docker")) {
    $dockerPs = Invoke-LoggedExternal -Label "Docker container status" -FilePath "docker" -Arguments @("ps", "--format", "table {{.Names}}`t{{.Status}}`t{{.Ports}}") -SuccessSummary "Docker responded with running container list."
}
$serveStatus = New-SkippedExternalResult
$funnelStatus = New-SkippedExternalResult
if (Test-CheckRequested -Names @("tailscale")) {
    $serveStatus = Invoke-LoggedExternal -Label "Tailscale Serve status" -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure -SuccessSummary "Collected Tailscale Serve status." -FailureSummary "Could not read Tailscale Serve status."
    $funnelStatus = Invoke-LoggedExternal -Label "Tailscale Funnel status" -FilePath "tailscale" -Arguments @("funnel", "status") -AllowFailure -SuccessSummary "Collected Tailscale Funnel status." -FailureSummary "Could not read Tailscale Funnel status."
}
$modelsList = New-SkippedExternalResult
$modelsStatus = New-SkippedExternalResult
if (Test-CheckRequested -Names @("models")) {
    $modelsList = Invoke-LoggedExternal -Label "OpenClaw model list" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "models", "list") -AllowFailure -SuccessSummary "Collected configured model list." -FailureSummary "Could not collect configured model list."
    $modelsStatus = Invoke-LoggedExternal -Label "OpenClaw model provider status" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "models", "status") -AllowFailure -SuccessSummary "Collected model provider status." -FailureSummary "Could not collect model provider status."
}
$telegramConfig = New-SkippedExternalResult
if (Test-CheckRequested -Names @("telegram")) {
    $telegramConfig = Invoke-LoggedExternal -Label "Telegram channel config" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "config", "get", "channels.telegram") -AllowFailure -SuccessSummary "Collected Telegram config." -FailureSummary "Could not collect Telegram config."
}
$audioConfig = New-SkippedExternalResult
$audioBackendProbe = New-SkippedExternalResult
if (Test-CheckRequested -Names @("voice")) {
    $audioConfig = Invoke-LoggedExternal -Label "Voice-notes config" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "config", "get", "tools.media.audio") -AllowFailure -SuccessSummary "Collected voice-note config." -FailureSummary "Could not collect voice-note config."
    $audioBackendProbe = Invoke-LoggedExternal -Label "Voice-note backend probe" -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "sh", "-lc",
        'for cmd in whisper whisper-cli sherpa-onnx-offline ffmpeg; do if command -v "$cmd" >/dev/null 2>&1; then printf "%s: %s\n" "$cmd" "$(command -v "$cmd")"; fi; done'
    ) -AllowFailure -SuccessSummary "Collected available voice backend binaries." -FailureSummary "Could not probe voice backend binaries."
}
$voiceSmokeTestOutput = "Voice smoke test skipped."
if ((Test-CheckRequested -Names @("voice")) -and $config.voiceNotes.enabled) {
    $voiceTestScript = Join-Path (Split-Path -Parent $PSCommandPath) "test-voice-notes.ps1"
    $voiceSmokeTestOutput = Invoke-LoggedScript -Label "Voice-note smoke test" -ScriptPath $voiceTestScript -SkipMessage "Voice smoke test skipped: script not found."
}
$localModelSmokeTestOutput = "Local model smoke test skipped."
if ((Test-CheckRequested -Names @("local-model")) -and $config.ollama.enabled -and (Test-ToolkitHasOllamaEndpoints -Config $config)) {
    $localModelScript = Join-Path (Split-Path -Parent $PSCommandPath) "test-local-models.ps1"
    $localModelSmokeTestOutput = Invoke-LoggedScript -Label "Local model smoke test" -ScriptPath $localModelScript -SkipMessage "Local model smoke test skipped: script not found."
}
$agentCapabilitiesSmokeTestOutput = "Agent capability smoke test skipped."
if ((Test-CheckRequested -Names @("agent")) -and $config.multiAgent -and $config.multiAgent.enabled) {
    $agentCapabilitiesScript = Join-Path (Split-Path -Parent $PSCommandPath) "test-agent-capabilities.ps1"
    $agentCapabilitiesParams = @{
        ConfigPath = $ConfigPath
    }
    $agentCapabilitiesSmokeTestOutput = Invoke-LoggedScript -Label "Agent capability smoke test" -ScriptPath $agentCapabilitiesScript -ScriptParameters $agentCapabilitiesParams -SkipMessage "Agent capability smoke test skipped: script not found."
}
$sandboxSmokeTestOutput = "Sandbox smoke test skipped."
if ((Test-CheckRequested -Names @("sandbox")) -and $config.sandbox.enabled) {
    $sandboxScript = Join-Path (Split-Path -Parent $PSCommandPath) "test-sandbox-smoke.ps1"
    $sandboxSmokeTestOutput = Invoke-LoggedScript -Label "Sandbox smoke test" -ScriptPath $sandboxScript -SkipMessage "Sandbox smoke test skipped: script not found."
}
$chatWorkspaceWriteSmokeTestOutput = "Chat workspace write smoke test skipped."
if ((Test-CheckRequested -Names @("chat-write")) -and $config.multiAgent -and $config.multiAgent.enabled -and $config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled) {
    $chatWorkspaceScript = Join-Path (Split-Path -Parent $PSCommandPath) "test-chat-workspace-write.ps1"
    $chatWorkspaceParams = @{}
    if ($config.multiAgent.localChatAgent.id) {
        $chatWorkspaceParams.AgentId = [string]$config.multiAgent.localChatAgent.id
    }
    $chatWorkspacePath = $null
    if ($config.multiAgent.sharedWorkspace -and $config.multiAgent.sharedWorkspace.enabled) {
        $chatWorkspacePath = if ($config.multiAgent.sharedWorkspace.path) { [string]$config.multiAgent.sharedWorkspace.path } else { "/home/node/.openclaw/workspace" }
    }
    elseif ($config.multiAgent.localChatAgent.workspace) {
        $chatWorkspacePath = [string]$config.multiAgent.localChatAgent.workspace
    }
    if ($chatWorkspacePath) {
        $chatWorkspaceHostPath = Resolve-HostWorkspacePath -Config $config -WorkspacePath $chatWorkspacePath
        $chatWorkspaceParams.WorkspaceHostPath = $chatWorkspaceHostPath
    }
    $chatWorkspaceWriteSmokeTestOutput = Invoke-LoggedScript -Label "Chat workspace write smoke test" -ScriptPath $chatWorkspaceScript -ScriptParameters $chatWorkspaceParams -SkipMessage "Chat workspace write smoke test skipped: script not found."
}
$localModelSmokeStructured = Get-SmokeStructuredResult -Output $localModelSmokeTestOutput
$agentCapabilitiesSmokeStructured = Get-SmokeStructuredResult -Output $agentCapabilitiesSmokeTestOutput
$sandboxExplain = New-SkippedExternalResult
if (Test-CheckRequested -Names @("sandbox")) {
    $sandboxExplain = Invoke-LoggedExternal -Label "Sandbox runtime summary" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "sandbox", "explain", "--json") -AllowFailure -SuccessSummary "Collected sandbox runtime summary." -FailureSummary "Could not collect sandbox runtime summary."
}
$audit = New-SkippedExternalResult
if (Test-CheckRequested -Names @("audit")) {
    $audit = Invoke-LoggedExternal -Label "Security audit" -FilePath "docker" -Arguments @("exec", "openclaw-openclaw-gateway-1", "node", "dist/index.js", "security", "audit", "--deep") -AllowFailure -SuccessSummary "Security audit completed." -FailureSummary "Security audit reported a command failure."
}
$gitStatus = New-SkippedExternalResult
if (Test-CheckRequested -Names @("git")) {
    $gitStatus = Invoke-LoggedExternal -Label "Git working tree status" -FilePath "git" -Arguments @("-C", $config.repoPath, "status", "--short") -AllowFailure -SuccessSummary "Collected git status." -FailureSummary "Could not collect git status."
}

$multiAgentVerification = @()
if (Test-CheckRequested -Names @("multi-agent")) {
    if ($config.multiAgent -and $config.multiAgent.enabled) {
        $multiAgentVerification += "Multi-agent starter layout: enabled"

        if ($null -eq $liveConfig) {
            $multiAgentVerification += "FAIL: Could not read live host config at $hostConfigPath"
        }
        else {
        $authReadyProviders = Get-AuthReadyProvidersFromLiveConfig -LiveConfig $liveConfig
        $expectedAgentIds = @()
        if ($config.multiAgent.strongAgent -and $config.multiAgent.strongAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.strongAgent.id)
        }
        if ($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled -and $config.multiAgent.researchAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.researchAgent.id)
        }
        if ($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled -and $config.multiAgent.localChatAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.localChatAgent.id)
        }
        if ($config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled -and $config.multiAgent.hostedTelegramAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.hostedTelegramAgent.id)
        }
        if ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled -and $config.multiAgent.localReviewAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.localReviewAgent.id)
        }
        if ($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled -and $config.multiAgent.localCoderAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.localCoderAgent.id)
        }
        if ($config.multiAgent.remoteReviewAgent -and $config.multiAgent.remoteReviewAgent.enabled -and $config.multiAgent.remoteReviewAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.remoteReviewAgent.id)
        }
        if ($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled -and $config.multiAgent.remoteCoderAgent.id) {
            $expectedAgentIds = Add-UniqueString -List $expectedAgentIds -Value ([string]$config.multiAgent.remoteCoderAgent.id)
        }

        $actualAgents = @($liveConfig.agents.list)
        $actualAgentIds = @($actualAgents | ForEach-Object { [string]$_.id })
        $expectedSharedWorkspace = $null
        if ($config.multiAgent.sharedWorkspace -and $config.multiAgent.sharedWorkspace.enabled) {
            $expectedSharedWorkspace = if ($config.multiAgent.sharedWorkspace.path) { [string]$config.multiAgent.sharedWorkspace.path } else { "/home/node/.openclaw/workspace" }
            $actualDefaultWorkspace = [string]$liveConfig.agents.defaults.workspace
            if ($actualDefaultWorkspace -eq $expectedSharedWorkspace) {
                $multiAgentVerification += "PASS: Shared default workspace is $actualDefaultWorkspace"
            }
            else {
                $multiAgentVerification += "FAIL: Shared default workspace mismatch. Expected $expectedSharedWorkspace, got $actualDefaultWorkspace"
            }
        }
        foreach ($agentId in $expectedAgentIds) {
            if ($agentId -in $actualAgentIds) {
                $multiAgentVerification += "PASS: Agent '$agentId' exists"
            }
            else {
                $multiAgentVerification += "FAIL: Agent '$agentId' is missing"
            }
        }

        if ($config.multiAgent.strongAgent.modelRef) {
            $expectedStrongDefault = Resolve-ExpectedStrongModelRef -Config $config -LiveConfig $liveConfig
            $actualStrongDefault = [string]$liveConfig.agents.defaults.model.primary
            if ($actualStrongDefault -eq $expectedStrongDefault) {
                $multiAgentVerification += "PASS: Strong default model is $actualStrongDefault"
            }
            else {
                $multiAgentVerification += "FAIL: Strong default model mismatch. Expected $expectedStrongDefault, got $actualStrongDefault"
            }
        }

        $expectedModelRefs = @()
        if ($config.multiAgent.strongAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$config.multiAgent.strongAgent.modelRef)
        }
        foreach ($candidateRef in @($config.multiAgent.strongAgent.candidateModelRefs)) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$candidateRef)
        }
        if ($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled) {
            if ($config.multiAgent.researchAgent.modelRef) {
                $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$config.multiAgent.researchAgent.modelRef)
            }
            foreach ($candidateRef in @($config.multiAgent.researchAgent.candidateModelRefs)) {
                $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$candidateRef)
            }
        }
        if ($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled -and $config.multiAgent.localChatAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localChatAgent -ModelRef ([string]$config.multiAgent.localChatAgent.modelRef))
        }
        if ($config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled) {
            if ($config.multiAgent.hostedTelegramAgent.modelRef) {
                $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$config.multiAgent.hostedTelegramAgent.modelRef)
            }
            foreach ($candidateRef in @($config.multiAgent.hostedTelegramAgent.candidateModelRefs)) {
                $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value ([string]$candidateRef)
            }
        }
        if ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled -and $config.multiAgent.localReviewAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localReviewAgent -ModelRef ([string]$config.multiAgent.localReviewAgent.modelRef))
        }
        if ($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled -and $config.multiAgent.localCoderAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localCoderAgent -ModelRef ([string]$config.multiAgent.localCoderAgent.modelRef))
        }
        if ($config.multiAgent.remoteReviewAgent -and $config.multiAgent.remoteReviewAgent.enabled -and $config.multiAgent.remoteReviewAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteReviewAgent -ModelRef ([string]$config.multiAgent.remoteReviewAgent.modelRef))
        }
        if ($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled -and $config.multiAgent.remoteCoderAgent.modelRef) {
            $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteCoderAgent -ModelRef ([string]$config.multiAgent.remoteCoderAgent.modelRef))
        }
        if ($config.ollama -and $config.ollama.enabled -and (Test-ToolkitHasOllamaEndpoints -Config $config)) {
            foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $config)) {
                foreach ($model in @(Get-ToolkitEndpointModelCatalog -Config $config -EndpointKey ([string]$endpoint.key))) {
                    if ($model.id) {
                        $expectedModelRefs = Add-UniqueString -List $expectedModelRefs -Value (Convert-ToolkitLocalModelIdToRef -Config $config -ModelId ([string]$model.id) -EndpointKey ([string]$endpoint.key))
                    }
                }
            }
        }

        $actualModelAllowlist = @()
        if ($liveConfig.agents.defaults.models) {
            $actualModelAllowlist = @($liveConfig.agents.defaults.models.PSObject.Properties.Name | ForEach-Object { [string]$_ })
        }
        foreach ($modelRef in $expectedModelRefs) {
            if ($modelRef -in $actualModelAllowlist) {
                $multiAgentVerification += "PASS: Managed allowlist includes $modelRef"
            }
            else {
                $multiAgentVerification += "FAIL: Managed allowlist is missing $modelRef"
            }
        }

        if ($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled) {
            $researchCandidates = @()
            foreach ($candidateRef in @($config.multiAgent.researchAgent.candidateModelRefs)) {
                $researchCandidates = Add-UniqueString -List $researchCandidates -Value ([string]$candidateRef)
            }
            if ($config.multiAgent.researchAgent.modelRef) {
                $researchCandidates = Add-UniqueString -List $researchCandidates -Value ([string]$config.multiAgent.researchAgent.modelRef)
            }

            $researchAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.researchAgent.id } | Select-Object -First 1
            $actualResearchModel = if ($researchAgent -and $researchAgent.model) { [string]$researchAgent.model.primary } else { "" }
            $expectedResearchModel = Resolve-ExpectedHostedCandidateModelRef -CandidateRefs $researchCandidates -AuthReadyProviders $authReadyProviders
            if ($actualResearchModel -eq $expectedResearchModel) {
                $multiAgentVerification += "PASS: research agent model is $actualResearchModel"
            }
            elseif ($actualResearchModel -in $researchCandidates) {
                $multiAgentVerification += "PASS: research agent is preconfigured for Gemini with $actualResearchModel"
            }
            else {
                $multiAgentVerification += "FAIL: research agent model mismatch. Expected $expectedResearchModel or another configured Gemini candidate, got $actualResearchModel"
            }

            if ($researchAgent) {
                $actualResearchWorkspace = if ($researchAgent.workspace) { [string]$researchAgent.workspace } else { [string]$liveConfig.agents.defaults.workspace }
                if ($expectedSharedWorkspace -and $actualResearchWorkspace -eq $expectedSharedWorkspace) {
                    $multiAgentVerification += "PASS: research agent uses shared workspace"
                }
            }

            if ("google" -in $authReadyProviders) {
                $multiAgentVerification += "PASS: Gemini provider auth is ready"
            }
            else {
                $multiAgentVerification += "INFO: Gemini provider auth is not ready yet. Run $(Join-Path $PSScriptRoot 'run-openclaw.cmd') gemini-auth"
            }
        }

        if ($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled) {
            $chatAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.localChatAgent.id } | Select-Object -First 1
            $actualChatModel = if ($chatAgent -and $chatAgent.model) { [string]$chatAgent.model.primary } else { "" }
            $desiredChatModel = [string]$config.multiAgent.localChatAgent.modelRef
            if ($actualChatModel -eq $desiredChatModel) {
                $multiAgentVerification += "PASS: chat-local model is $actualChatModel"
            }
            elseif ($actualChatModel -like "ollama/*" -and $actualChatModel -in $actualModelAllowlist) {
                $multiAgentVerification += "PASS: chat-local fell back from $desiredChatModel to available local model $actualChatModel"
            }
            else {
                $multiAgentVerification += "FAIL: chat-local model mismatch. Expected $desiredChatModel or another available ollama/* model, got $actualChatModel"
            }
            if ($chatAgent) {
                $actualChatWorkspace = if ($chatAgent.workspace) { [string]$chatAgent.workspace } else { [string]$liveConfig.agents.defaults.workspace }
                if ($expectedSharedWorkspace -and $actualChatWorkspace -eq $expectedSharedWorkspace) {
                    $multiAgentVerification += "PASS: chat-local uses shared workspace"
                }
            }

            $expectedChatSandboxMode = if ($config.multiAgent.localChatAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.localChatAgent.sandboxMode) {
                [string]$config.multiAgent.localChatAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualChatSandboxMode = if ($chatAgent -and $chatAgent.sandbox -and $chatAgent.sandbox.mode) {
                [string]$chatAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualChatSandboxMode -eq $expectedChatSandboxMode) {
                $multiAgentVerification += "PASS: chat-local sandbox mode is $actualChatSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: chat-local sandbox mode mismatch. Expected $expectedChatSandboxMode, got $actualChatSandboxMode"
            }
        }

        if ($config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled) {
            $hostedChatCandidates = @()
            foreach ($candidateRef in @($config.multiAgent.hostedTelegramAgent.candidateModelRefs)) {
                $hostedChatCandidates = Add-UniqueString -List $hostedChatCandidates -Value ([string]$candidateRef)
            }
            if ($config.multiAgent.hostedTelegramAgent.modelRef) {
                $hostedChatCandidates = Add-UniqueString -List $hostedChatCandidates -Value ([string]$config.multiAgent.hostedTelegramAgent.modelRef)
            }

            $hostedChatAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.hostedTelegramAgent.id } | Select-Object -First 1
            $actualHostedChatModel = if ($hostedChatAgent -and $hostedChatAgent.model) { [string]$hostedChatAgent.model.primary } else { "" }
            $expectedHostedChatModel = Resolve-ExpectedHostedCandidateModelRef -CandidateRefs $hostedChatCandidates -AuthReadyProviders $authReadyProviders
            if ($actualHostedChatModel -eq $expectedHostedChatModel) {
                $multiAgentVerification += "PASS: hosted Telegram agent model is $actualHostedChatModel"
            }
            elseif ($actualHostedChatModel -in $hostedChatCandidates) {
                $multiAgentVerification += "PASS: hosted Telegram agent is preconfigured with $actualHostedChatModel"
            }
            else {
                $multiAgentVerification += "FAIL: hosted Telegram agent model mismatch. Expected $expectedHostedChatModel or another configured hosted candidate, got $actualHostedChatModel"
            }
            if ($hostedChatAgent) {
                $actualHostedChatWorkspace = if ($hostedChatAgent.workspace) { [string]$hostedChatAgent.workspace } else { [string]$liveConfig.agents.defaults.workspace }
                if ($expectedSharedWorkspace -and $actualHostedChatWorkspace -eq $expectedSharedWorkspace) {
                    $multiAgentVerification += "PASS: hosted Telegram agent uses shared workspace"
                }
            }

            $expectedHostedChatSandboxMode = if ($config.multiAgent.hostedTelegramAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.hostedTelegramAgent.sandboxMode) {
                [string]$config.multiAgent.hostedTelegramAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualHostedChatSandboxMode = if ($hostedChatAgent -and $hostedChatAgent.sandbox -and $hostedChatAgent.sandbox.mode) {
                [string]$hostedChatAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualHostedChatSandboxMode -eq $expectedHostedChatSandboxMode) {
                $multiAgentVerification += "PASS: hosted Telegram agent sandbox mode is $actualHostedChatSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: hosted Telegram agent sandbox mode mismatch. Expected $expectedHostedChatSandboxMode, got $actualHostedChatSandboxMode"
            }
        }

        if ($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled) {
            $reviewAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.localReviewAgent.id } | Select-Object -First 1
            $actualReviewModel = if ($reviewAgent -and $reviewAgent.model) { [string]$reviewAgent.model.primary } else { "" }
            $desiredReviewModel = Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localReviewAgent -ModelRef ([string]$config.multiAgent.localReviewAgent.modelRef)
            if ($actualReviewModel -eq $desiredReviewModel) {
                $multiAgentVerification += "PASS: review-local model is $actualReviewModel"
            }
            elseif ($actualReviewModel -like "ollama/*" -and $actualReviewModel -in $actualModelAllowlist) {
                $multiAgentVerification += "PASS: review-local fell back from $desiredReviewModel to available local model $actualReviewModel"
            }
            else {
                $multiAgentVerification += "FAIL: review-local model mismatch. Expected $desiredReviewModel or another available ollama/* model, got $actualReviewModel"
            }
            if ($reviewAgent) {
                $actualReviewWorkspace = if ($reviewAgent.workspace) { [string]$reviewAgent.workspace } else { [string]$liveConfig.agents.defaults.workspace }
                if ($expectedSharedWorkspace -and $actualReviewWorkspace -eq $expectedSharedWorkspace) {
                    $multiAgentVerification += "PASS: review-local uses shared workspace"
                }
            }

            $expectedReviewSandboxMode = if ($config.multiAgent.localReviewAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.localReviewAgent.sandboxMode) {
                [string]$config.multiAgent.localReviewAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualReviewSandboxMode = if ($reviewAgent -and $reviewAgent.sandbox -and $reviewAgent.sandbox.mode) {
                [string]$reviewAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualReviewSandboxMode -eq $expectedReviewSandboxMode) {
                $multiAgentVerification += "PASS: review-local sandbox mode is $actualReviewSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: review-local sandbox mode mismatch. Expected $expectedReviewSandboxMode, got $actualReviewSandboxMode"
            }
        }

        if ($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled) {
            $coderAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.localCoderAgent.id } | Select-Object -First 1
            $actualCoderModel = if ($coderAgent -and $coderAgent.model) { [string]$coderAgent.model.primary } else { "" }
            $expectedCoderModels = @()
            foreach ($candidateRef in @($config.multiAgent.localCoderAgent.candidateModelRefs)) {
                $expectedCoderModels = Add-UniqueString -List $expectedCoderModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localCoderAgent -ModelRef ([string]$candidateRef))
            }
            if ($config.multiAgent.localCoderAgent.modelRef) {
                $expectedCoderModels = Add-UniqueString -List $expectedCoderModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.localCoderAgent -ModelRef ([string]$config.multiAgent.localCoderAgent.modelRef))
            }
            $desiredCoderModel = if (@($expectedCoderModels).Count -gt 0) { [string]$expectedCoderModels[0] } else { [string]$config.multiAgent.localCoderAgent.modelRef }
            if ($actualCoderModel -in @($expectedCoderModels)) {
                $multiAgentVerification += "PASS: coder-local model is $actualCoderModel"
            }
            elseif ($actualCoderModel -like "ollama/*" -and $actualCoderModel -in $actualModelAllowlist) {
                $multiAgentVerification += "PASS: coder-local fell back from $desiredCoderModel to available local model $actualCoderModel"
            }
            else {
                $multiAgentVerification += "FAIL: coder-local model mismatch. Expected one of $(@($expectedCoderModels) -join ', ') or another available ollama/* model, got $actualCoderModel"
            }
            if ($coderAgent) {
                $actualCoderWorkspace = if ($coderAgent.workspace) { [string]$coderAgent.workspace } else { [string]$liveConfig.agents.defaults.workspace }
                if ($expectedSharedWorkspace -and $actualCoderWorkspace -eq $expectedSharedWorkspace) {
                    $multiAgentVerification += "PASS: coder-local uses shared workspace"
                }
            }

            $expectedCoderSandboxMode = if ($config.multiAgent.localCoderAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.localCoderAgent.sandboxMode) {
                [string]$config.multiAgent.localCoderAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualCoderSandboxMode = if ($coderAgent -and $coderAgent.sandbox -and $coderAgent.sandbox.mode) {
                [string]$coderAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualCoderSandboxMode -eq $expectedCoderSandboxMode) {
                $multiAgentVerification += "PASS: coder-local sandbox mode is $actualCoderSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: coder-local sandbox mode mismatch. Expected $expectedCoderSandboxMode, got $actualCoderSandboxMode"
            }
        }

        if ($config.multiAgent.remoteReviewAgent -and $config.multiAgent.remoteReviewAgent.enabled) {
            $remoteReviewAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.remoteReviewAgent.id } | Select-Object -First 1
            if ($null -eq $remoteReviewAgent) {
                $multiAgentVerification += "FAIL: remoteReviewAgent '$($config.multiAgent.remoteReviewAgent.id)' is missing from agents.list"
            }
            else {
                $desiredRemoteReviewModel = Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteReviewAgent -ModelRef ([string]$config.multiAgent.remoteReviewAgent.modelRef)
                if ($remoteReviewAgent.model.primary -eq $desiredRemoteReviewModel) {
                    $multiAgentVerification += "PASS: review-remote model is $($remoteReviewAgent.model.primary)"
                }
            else {
                $multiAgentVerification += "FAIL: review-remote model mismatch. Expected $desiredRemoteReviewModel, got $($remoteReviewAgent.model.primary)"
            }
            }

            $expectedRemoteReviewSandboxMode = if ($config.multiAgent.remoteReviewAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.remoteReviewAgent.sandboxMode) {
                [string]$config.multiAgent.remoteReviewAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualRemoteReviewSandboxMode = if ($remoteReviewAgent -and $remoteReviewAgent.sandbox -and $remoteReviewAgent.sandbox.mode) {
                [string]$remoteReviewAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualRemoteReviewSandboxMode -eq $expectedRemoteReviewSandboxMode) {
                $multiAgentVerification += "PASS: review-remote sandbox mode is $actualRemoteReviewSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: review-remote sandbox mode mismatch. Expected $expectedRemoteReviewSandboxMode, got $actualRemoteReviewSandboxMode"
            }
        }

        if ($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled) {
            $remoteCoderAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.remoteCoderAgent.id } | Select-Object -First 1
            if ($null -eq $remoteCoderAgent) {
                $multiAgentVerification += "FAIL: remoteCoderAgent '$($config.multiAgent.remoteCoderAgent.id)' is missing from agents.list"
            }
            else {
                $expectedRemoteCoderModels = @()
                foreach ($candidateRef in @($config.multiAgent.remoteCoderAgent.candidateModelRefs)) {
                    $expectedRemoteCoderModels = Add-UniqueString -List $expectedRemoteCoderModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteCoderAgent -ModelRef ([string]$candidateRef))
                }
                if ($config.multiAgent.remoteCoderAgent.modelRef) {
                    $expectedRemoteCoderModels = Add-UniqueString -List $expectedRemoteCoderModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteCoderAgent -ModelRef ([string]$config.multiAgent.remoteCoderAgent.modelRef))
                }
                $desiredRemoteCoderModel = if (@($expectedRemoteCoderModels).Count -gt 0) { [string]$expectedRemoteCoderModels[0] } else { [string]$config.multiAgent.remoteCoderAgent.modelRef }
                if ($remoteCoderAgent.model.primary -in @($expectedRemoteCoderModels)) {
                    $multiAgentVerification += "PASS: coder-remote model is $($remoteCoderAgent.model.primary)"
                }
                else {
                    $multiAgentVerification += "FAIL: coder-remote model mismatch. Expected one of $(@($expectedRemoteCoderModels) -join ', '), got $($remoteCoderAgent.model.primary)"
                }
            }

            $expectedRemoteCoderSandboxMode = if ($config.multiAgent.remoteCoderAgent.PSObject.Properties.Name -contains "sandboxMode" -and $config.multiAgent.remoteCoderAgent.sandboxMode) {
                [string]$config.multiAgent.remoteCoderAgent.sandboxMode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            $actualRemoteCoderSandboxMode = if ($remoteCoderAgent -and $remoteCoderAgent.sandbox -and $remoteCoderAgent.sandbox.mode) {
                [string]$remoteCoderAgent.sandbox.mode
            }
            else {
                [string]$liveConfig.agents.defaults.sandbox.mode
            }
            if ($actualRemoteCoderSandboxMode -eq $expectedRemoteCoderSandboxMode) {
                $multiAgentVerification += "PASS: coder-remote sandbox mode is $actualRemoteCoderSandboxMode"
            }
            else {
                $multiAgentVerification += "FAIL: coder-remote sandbox mode mismatch. Expected $expectedRemoteCoderSandboxMode, got $actualRemoteCoderSandboxMode"
            }
        }

        if ($config.multiAgent.enableAgentToAgent) {
            $actualAgentToAgent = $liveConfig.tools.agentToAgent
            if ($actualAgentToAgent.enabled) {
                $multiAgentVerification += "PASS: agent-to-agent delegation is enabled"
            }
            else {
                $multiAgentVerification += "FAIL: agent-to-agent delegation is disabled"
            }

            $actualAllow = @($actualAgentToAgent.allow | ForEach-Object { [string]$_ })
            foreach ($agentId in $expectedAgentIds) {
                if ($agentId -in $actualAllow) {
                    $multiAgentVerification += "PASS: agent-to-agent allowlist includes '$agentId'"
                }
                else {
                    $multiAgentVerification += "FAIL: agent-to-agent allowlist is missing '$agentId'"
                }
            }
        }

        if ($config.multiAgent.strongAgent -and $config.multiAgent.strongAgent.subagents) {
            $mainAgent = $actualAgents | Where-Object { $_.id -eq [string]$config.multiAgent.strongAgent.id } | Select-Object -First 1
            $delegationEnabled = $true
            if ($config.multiAgent.strongAgent.subagents.PSObject.Properties.Name -contains "enabled") {
                $delegationEnabled = [bool]$config.multiAgent.strongAgent.subagents.enabled
            }
            $actualAllowAgents = @()
            if ($mainAgent -and $mainAgent.subagents -and $mainAgent.subagents.allowAgents) {
                $actualAllowAgents = @($mainAgent.subagents.allowAgents | ForEach-Object { [string]$_ })
            }

            if ($delegationEnabled) {
                $expectedAllowAgents = @($config.multiAgent.strongAgent.subagents.allowAgents | ForEach-Object { [string]$_ })
                foreach ($agentId in $expectedAllowAgents) {
                    if ($agentId -in $actualAllowAgents) {
                        $multiAgentVerification += "PASS: main subagent allowlist includes '$agentId'"
                    }
                    else {
                        $multiAgentVerification += "FAIL: main subagent allowlist is missing '$agentId'"
                    }
                }
            }
            else {
                if (@($actualAllowAgents).Count -eq 0) {
                    $multiAgentVerification += "PASS: main subagent delegation is disabled"
                }
                else {
                    $multiAgentVerification += "FAIL: main subagent delegation is disabled in config but live allowlist is not empty"
                }
            }

            $expectedRequireAgentId = $false
            if ($delegationEnabled -and $config.multiAgent.strongAgent.subagents.PSObject.Properties.Name -contains "requireAgentId") {
                $expectedRequireAgentId = [bool]$config.multiAgent.strongAgent.subagents.requireAgentId
            }
            $actualRequireAgentId = $false
            if ($mainAgent -and $mainAgent.subagents -and $mainAgent.subagents.PSObject.Properties.Name -contains "requireAgentId") {
                $actualRequireAgentId = [bool]$mainAgent.subagents.requireAgentId
            }
            if (-not $delegationEnabled -and -not ($mainAgent -and $mainAgent.subagents)) {
                $multiAgentVerification += "PASS: main has no per-agent subagent policy while delegation is disabled"
            }
            elseif ($actualRequireAgentId -eq $expectedRequireAgentId) {
                $multiAgentVerification += "PASS: main subagent requireAgentId is $actualRequireAgentId"
            }
            else {
                $multiAgentVerification += "FAIL: main subagent requireAgentId mismatch. Expected $expectedRequireAgentId, got $actualRequireAgentId"
            }
        }

        $actualBindings = @($liveConfig.bindings)
        $telegramRouteTargetAgentId = $null
        $routeTrustedTelegramGroups = $false
        $routeTrustedTelegramDms = $false
        if ($config.multiAgent.telegramRouting) {
            if ($config.multiAgent.telegramRouting.targetAgentId) {
                $telegramRouteTargetAgentId = [string]$config.multiAgent.telegramRouting.targetAgentId
            }
            if ($null -ne $config.multiAgent.telegramRouting.routeTrustedTelegramGroups) {
                $routeTrustedTelegramGroups = [bool]$config.multiAgent.telegramRouting.routeTrustedTelegramGroups
            }
            if ($null -ne $config.multiAgent.telegramRouting.routeTrustedTelegramDms) {
                $routeTrustedTelegramDms = [bool]$config.multiAgent.telegramRouting.routeTrustedTelegramDms
            }
        }
        elseif ($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled) {
            $telegramRouteTargetAgentId = if ($config.multiAgent.localChatAgent.id) { [string]$config.multiAgent.localChatAgent.id } else { "chat-local" }
            $routeTrustedTelegramGroups = [bool]$config.multiAgent.localChatAgent.routeTrustedTelegramGroups
            $routeTrustedTelegramDms = [bool]$config.multiAgent.localChatAgent.routeTrustedTelegramDms
        }

        if ($telegramRouteTargetAgentId) {
            if ($routeTrustedTelegramGroups) {
                foreach ($group in @($config.telegram.groups)) {
                    $groupId = [string]$group.id
                    $match = @($actualBindings | Where-Object {
                            Test-BindingMatch -Binding $_ -AgentId $telegramRouteTargetAgentId -Channel "telegram" -PeerKind "group" -PeerId $groupId
                        })
                    if ($match.Count -gt 0) {
                        $multiAgentVerification += "PASS: Telegram group $groupId routes to $telegramRouteTargetAgentId"
                    }
                    else {
                        $multiAgentVerification += "FAIL: Telegram group $groupId is not routed to $telegramRouteTargetAgentId"
                    }
                }
            }

            if ($routeTrustedTelegramDms) {
                foreach ($senderId in @($config.telegram.allowFrom)) {
                    $senderIdText = [string]$senderId
                    $match = @($actualBindings | Where-Object {
                            Test-BindingMatch -Binding $_ -AgentId $telegramRouteTargetAgentId -Channel "telegram" -PeerKind "direct" -PeerId $senderIdText
                        })
                    if ($match.Count -gt 0) {
                        $multiAgentVerification += "PASS: Telegram DM $senderIdText routes to $telegramRouteTargetAgentId"
                    }
                    else {
                        $multiAgentVerification += "FAIL: Telegram DM $senderIdText is not routed to $telegramRouteTargetAgentId"
                    }
                }
            }
        }

        if ($config.telegram -and $config.telegram.execApprovals) {
            $liveTelegramExecApprovals = $liveConfig.channels.telegram.execApprovals
            if ($null -eq $liveTelegramExecApprovals) {
                $multiAgentVerification += "FAIL: Telegram exec approvals are not configured in live config"
            }
            else {
                if ([bool]$liveTelegramExecApprovals.enabled -eq [bool]$config.telegram.execApprovals.enabled) {
                    $multiAgentVerification += "PASS: Telegram exec approvals enabled state matches managed config"
                }
                else {
                    $multiAgentVerification += "FAIL: Telegram exec approvals enabled state does not match managed config"
                }

                $expectedTelegramApprovers = @($config.telegram.execApprovals.approvers | ForEach-Object { [string]$_ })
                $actualTelegramApprovers = @($liveTelegramExecApprovals.approvers | ForEach-Object { [string]$_ })
                if ((Convert-NormalizedJson -Value $expectedTelegramApprovers) -eq (Convert-NormalizedJson -Value $actualTelegramApprovers)) {
                    $multiAgentVerification += "PASS: Telegram exec approval approvers match managed config"
                }
                else {
                    $multiAgentVerification += "FAIL: Telegram exec approval approvers do not match managed config"
                }

                $expectedTelegramTarget = [string]$config.telegram.execApprovals.target
                $actualTelegramTarget = [string]$liveTelegramExecApprovals.target
                if ($actualTelegramTarget -eq $expectedTelegramTarget) {
                    $multiAgentVerification += "PASS: Telegram exec approval target is $actualTelegramTarget"
                }
                else {
                    $multiAgentVerification += "FAIL: Telegram exec approval target mismatch. Expected $expectedTelegramTarget, got $actualTelegramTarget"
                }
            }
        }

        if ($config.multiAgent.manageWorkspaceAgentsMd) {
            $overlayDirName = "bootstrap"
            if ($config.PSObject.Properties.Name -contains "managedHooks" -and
                $config.managedHooks -and
                $config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
                $config.managedHooks.agentBootstrapOverlays -and
                $config.managedHooks.agentBootstrapOverlays.PSObject.Properties.Name -contains "overlayDirName" -and
                $config.managedHooks.agentBootstrapOverlays.overlayDirName) {
                $overlayDirName = [string]$config.managedHooks.agentBootstrapOverlays.overlayDirName
            }

            if ($config.multiAgent.sharedWorkspace -and $config.multiAgent.sharedWorkspace.enabled) {
                $sharedAgentsFilePath = Join-Path (Resolve-HostWorkspacePath -Config $config -WorkspacePath ([string]$config.multiAgent.sharedWorkspace.path)) "AGENTS.md"
                if (Test-Path $sharedAgentsFilePath) {
                    $multiAgentVerification += "PASS: Shared workspace AGENTS.md exists at $sharedAgentsFilePath"
                }
                else {
                    $multiAgentVerification += "FAIL: Shared workspace AGENTS.md is missing at $sharedAgentsFilePath"
                }

                $overlayChecks = @(
                    @{ Name = "main"; Enabled = $true; AgentId = if ($config.multiAgent.strongAgent) { [string]$config.multiAgent.strongAgent.id } else { "main" } },
                    @{ Name = "research"; Enabled = [bool]($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled); AgentId = if ($config.multiAgent.researchAgent) { [string]$config.multiAgent.researchAgent.id } else { "research" } },
                    @{ Name = "chat-local"; Enabled = [bool]($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled); AgentId = if ($config.multiAgent.localChatAgent) { [string]$config.multiAgent.localChatAgent.id } else { "chat-local" } },
                    @{ Name = "chat-openai"; Enabled = [bool]($config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled); AgentId = if ($config.multiAgent.hostedTelegramAgent) { [string]$config.multiAgent.hostedTelegramAgent.id } else { "chat-openai" } },
                    @{ Name = "review-local"; Enabled = [bool]($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled); AgentId = if ($config.multiAgent.localReviewAgent) { [string]$config.multiAgent.localReviewAgent.id } else { "review-local" } },
                    @{ Name = "coder-local"; Enabled = [bool]($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled); AgentId = if ($config.multiAgent.localCoderAgent) { [string]$config.multiAgent.localCoderAgent.id } else { "coder-local" } },
                    @{ Name = "review-remote"; Enabled = [bool]($config.multiAgent.remoteReviewAgent -and $config.multiAgent.remoteReviewAgent.enabled); AgentId = if ($config.multiAgent.remoteReviewAgent) { [string]$config.multiAgent.remoteReviewAgent.id } else { "review-remote" } },
                    @{ Name = "coder-remote"; Enabled = [bool]($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled); AgentId = if ($config.multiAgent.remoteCoderAgent) { [string]$config.multiAgent.remoteCoderAgent.id } else { "coder-remote" } }
                )

                foreach ($overlayCheck in $overlayChecks) {
                    if (-not $overlayCheck.Enabled) {
                        continue
                    }

                    $overlayAgentsPath = Join-Path (Join-Path (Join-Path (Join-Path (Get-HostConfigDir -Config $config) "agents") ([string]$overlayCheck.AgentId)) $overlayDirName) "AGENTS.md"
                    if (Test-Path $overlayAgentsPath) {
                        $multiAgentVerification += "PASS: Agent bootstrap overlay AGENTS.md exists for $($overlayCheck.Name) at $overlayAgentsPath"
                    }
                    else {
                        $multiAgentVerification += "FAIL: Agent bootstrap overlay AGENTS.md is missing for $($overlayCheck.Name) at $overlayAgentsPath"
                    }
                }
            }
            else {
                $workspaceChecks = @(
                    @{ Name = "main"; Enabled = $true; Workspace = $null },
                    @{ Name = "research"; Enabled = [bool]($config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled); Workspace = if ($config.multiAgent.researchAgent) { [string]$config.multiAgent.researchAgent.workspace } else { $null } },
                    @{ Name = "chat-local"; Enabled = [bool]($config.multiAgent.localChatAgent -and $config.multiAgent.localChatAgent.enabled); Workspace = if ($config.multiAgent.localChatAgent) { [string]$config.multiAgent.localChatAgent.workspace } else { $null } },
                    @{ Name = "chat-openai"; Enabled = [bool]($config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled); Workspace = if ($config.multiAgent.hostedTelegramAgent) { [string]$config.multiAgent.hostedTelegramAgent.workspace } else { $null } },
                    @{ Name = "review-local"; Enabled = [bool]($config.multiAgent.localReviewAgent -and $config.multiAgent.localReviewAgent.enabled); Workspace = if ($config.multiAgent.localReviewAgent) { [string]$config.multiAgent.localReviewAgent.workspace } else { $null } },
                    @{ Name = "coder-local"; Enabled = [bool]($config.multiAgent.localCoderAgent -and $config.multiAgent.localCoderAgent.enabled); Workspace = if ($config.multiAgent.localCoderAgent) { [string]$config.multiAgent.localCoderAgent.workspace } else { $null } },
                    @{ Name = "review-remote"; Enabled = [bool]($config.multiAgent.remoteReviewAgent -and $config.multiAgent.remoteReviewAgent.enabled); Workspace = if ($config.multiAgent.remoteReviewAgent) { [string]$config.multiAgent.remoteReviewAgent.workspace } else { $null } },
                    @{ Name = "coder-remote"; Enabled = [bool]($config.multiAgent.remoteCoderAgent -and $config.multiAgent.remoteCoderAgent.enabled); Workspace = if ($config.multiAgent.remoteCoderAgent) { [string]$config.multiAgent.remoteCoderAgent.workspace } else { $null } }
                )

                foreach ($workspaceCheck in $workspaceChecks) {
                    if (-not $workspaceCheck.Enabled) {
                        continue
                    }

                    $agentsFilePath = Join-Path (Resolve-HostWorkspacePath -Config $config -WorkspacePath ([string]$workspaceCheck.Workspace)) "AGENTS.md"
                    if (Test-Path $agentsFilePath) {
                        $multiAgentVerification += "PASS: Managed AGENTS.md exists for $($workspaceCheck.Name) at $agentsFilePath"
                    }
                    else {
                        $multiAgentVerification += "FAIL: Managed AGENTS.md is missing for $($workspaceCheck.Name) at $agentsFilePath"
                    }
                }
            }
        }

        if ($config.PSObject.Properties.Name -contains "managedHooks" -and
            $config.managedHooks -and
            $config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
            $config.managedHooks.agentBootstrapOverlays -and
            $config.managedHooks.agentBootstrapOverlays.enabled) {
            $liveHookEntry = $liveConfig.hooks.internal.entries."agent-bootstrap-overlays"
            if ($null -ne $liveHookEntry -and [bool]$liveHookEntry.enabled) {
                $multiAgentVerification += "PASS: Managed agent-bootstrap-overlays hook is enabled"
            }
            else {
                $multiAgentVerification += "FAIL: Managed agent-bootstrap-overlays hook is not enabled in live config"
            }
        }
        }
    }
    else {
        $multiAgentVerification += "Multi-agent starter layout: disabled"
    }
}
else {
    $multiAgentVerification += "Skipped: not requested."
}

$contextManagementVerification = @()
if (-not (Test-CheckRequested -Names @("context"))) {
    $contextManagementVerification += "Skipped: not requested."
}
elseif ($null -eq $liveConfig) {
    $contextManagementVerification += "FAIL: Could not read live host config at $hostConfigPath"
}
elseif ($config.contextManagement) {
    if ($config.contextManagement.compaction) {
        $expectedCompaction = Convert-NormalizedJson -Value $config.contextManagement.compaction
        $actualCompaction = Convert-NormalizedJson -Value $liveConfig.agents.defaults.compaction
        if ($expectedCompaction -eq $actualCompaction) {
            $contextManagementVerification += "PASS: Managed compaction policy is applied"
        }
        else {
            $contextManagementVerification += "FAIL: Managed compaction policy does not match live config"
        }
    }

    if ($config.contextManagement.contextPruning) {
        $expectedContextPruning = Convert-NormalizedJson -Value $config.contextManagement.contextPruning
        $actualContextPruning = Convert-NormalizedJson -Value $liveConfig.agents.defaults.contextPruning
        if ($expectedContextPruning -eq $actualContextPruning) {
            $contextManagementVerification += "PASS: Managed context pruning policy is applied"
        }
        else {
            $contextManagementVerification += "FAIL: Managed context pruning policy does not match live config"
        }
    }
}

$reportLines = New-Object System.Collections.Generic.List[string]
[void]$reportLines.Add("OpenClaw Bootstrap Verification")
[void]$reportLines.Add("Generated: $(Get-Date -Format s)")
[void]$reportLines.Add("Requested checks: $(@($script:RequestedChecks) -join ', ')")

if (Test-CheckRequested -Names @("health")) { Add-ReportSection -Lines $reportLines -Title "Health" -Content $health.Output }
if (Test-CheckRequested -Names @("docker")) { Add-ReportSection -Lines $reportLines -Title "Docker PS" -Content $dockerPs.Output }
if (Test-CheckRequested -Names @("tailscale")) {
    Add-ReportSection -Lines $reportLines -Title "Tailscale Serve" -Content $serveStatus.Output
    Add-ReportSection -Lines $reportLines -Title "Tailscale Funnel" -Content $funnelStatus.Output
}
if (Test-CheckRequested -Names @("models")) {
    Add-ReportSection -Lines $reportLines -Title "Models List" -Content $modelsList.Output
    Add-ReportSection -Lines $reportLines -Title "Models Status" -Content $modelsStatus.Output
}
if (Test-CheckRequested -Names @("telegram")) { Add-ReportSection -Lines $reportLines -Title "Telegram Config" -Content $telegramConfig.Output }
if (Test-CheckRequested -Names @("voice")) {
    Add-ReportSection -Lines $reportLines -Title "Voice Notes Config" -Content $audioConfig.Output
    Add-ReportSection -Lines $reportLines -Title "Voice Notes Backends" -Content $audioBackendProbe.Output
    Add-ReportSection -Lines $reportLines -Title "Voice Notes Smoke Test" -Content $voiceSmokeTestOutput
}
if (Test-CheckRequested -Names @("local-model")) { Add-ReportSection -Lines $reportLines -Title "Local Model Smoke Test" -Content $localModelSmokeTestOutput }
if (Test-CheckRequested -Names @("agent")) { Add-ReportSection -Lines $reportLines -Title "Agent Capability Smoke Test" -Content $agentCapabilitiesSmokeTestOutput }
if (Test-CheckRequested -Names @("chat-write")) { Add-ReportSection -Lines $reportLines -Title "Chat Workspace Write Smoke Test" -Content $chatWorkspaceWriteSmokeTestOutput }
if (Test-CheckRequested -Names @("multi-agent")) { Add-ReportSection -Lines $reportLines -Title "Multi-Agent Verification" -Content (@($multiAgentVerification) -join [Environment]::NewLine) }
if (Test-CheckRequested -Names @("context")) { Add-ReportSection -Lines $reportLines -Title "Context Management Verification" -Content (@($contextManagementVerification) -join [Environment]::NewLine) }
if (Test-CheckRequested -Names @("sandbox")) {
    Add-ReportSection -Lines $reportLines -Title "Sandbox Smoke Test" -Content $sandboxSmokeTestOutput
    Add-ReportSection -Lines $reportLines -Title "Sandbox Explain" -Content $sandboxExplain.Output
}
if (Test-CheckRequested -Names @("audit")) { Add-ReportSection -Lines $reportLines -Title "Security Audit" -Content $audit.Output }
if (Test-CheckRequested -Names @("git")) { Add-ReportSection -Lines $reportLines -Title "Git Status" -Content $gitStatus.Output }

$reportPath = $config.verification.reportPath
$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path $reportDir)) {
    New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$reportLines -join [Environment]::NewLine | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ""
Write-Host "==> Verification summary" -ForegroundColor Cyan
Write-Detail "Requested checks: $(@($script:RequestedChecks) -join ', ')"
if (Test-CheckRequested -Names @("health")) { Write-Detail "Health exit code: $($health.ExitCode)" }
if (Test-CheckRequested -Names @("voice")) { Write-Detail "Voice smoke test: $(Get-SmokeSummaryLabel -Output $voiceSmokeTestOutput -StructuredResult $null)" }
if (Test-CheckRequested -Names @("local-model")) {
    Write-Detail "Local model smoke test: $(Get-SmokeSummaryLabel -Output $localModelSmokeTestOutput -StructuredResult $localModelSmokeStructured)"
    if ($localModelSmokeStructured -and [string]$localModelSmokeStructured.status -eq "fail") {
        Write-Detail "Local model failure category: $($localModelSmokeStructured.category)" ([ConsoleColor]::Yellow)
        Write-Detail "Local model detail: $($localModelSmokeStructured.detail)" ([ConsoleColor]::Yellow)
    }
}
if (Test-CheckRequested -Names @("agent")) {
    Write-Detail "Agent capability smoke test: $(Get-SmokeSummaryLabel -Output $agentCapabilitiesSmokeTestOutput -StructuredResult $agentCapabilitiesSmokeStructured)"
    if ($agentCapabilitiesSmokeStructured -and $agentCapabilitiesSmokeStructured.checks) {
        foreach ($check in @($agentCapabilitiesSmokeStructured.checks)) {
            $label = ("Agent check {0} ({1})" -f $check.name, $check.agentId)
            $status = [string]$check.status
            if ($status -eq "fail") {
                Write-Detail ("{0}: FAIL [{1}]" -f $label, $check.category) ([ConsoleColor]::Yellow)
                if ($check.detail) {
                    Write-Detail "Reason: $($check.detail)" ([ConsoleColor]::Yellow)
                }
            }
            elseif ($status -eq "pass") {
                $runtimeSuffix = if ($check.runtime) { " via $($check.runtime)" } else { "" }
                Write-Detail ("{0}: PASS{1}" -f $label, $runtimeSuffix)
            }
            else {
                Write-Detail ("{0}: SKIP/INFO ({1})" -f $label, $check.detail)
            }
        }
    }
}
if (Test-CheckRequested -Names @("sandbox")) { Write-Detail "Sandbox smoke test: $(if ($sandboxSmokeTestOutput -match 'passed') { 'PASS' } elseif ($sandboxSmokeTestOutput -match 'failed') { 'FAIL' } else { 'SKIP/INFO' })" }
if (Test-CheckRequested -Names @("chat-write")) { Write-Detail "Chat workspace write smoke test: $(if ($chatWorkspaceWriteSmokeTestOutput -match 'passed') { 'PASS' } elseif ($chatWorkspaceWriteSmokeTestOutput -match 'failed') { 'FAIL' } else { 'SKIP/INFO' })" }
if (Test-CheckRequested -Names @("multi-agent")) { Write-Detail "Multi-agent verification: $(if ((@($multiAgentVerification) -join ' ') -match 'FAIL:') { 'FAIL' } elseif ((@($multiAgentVerification) -join ' ') -match 'PASS:') { 'PASS' } else { 'INFO' })" }
if (Test-CheckRequested -Names @("context")) { Write-Detail "Context management verification: $(if ((@($contextManagementVerification) -join ' ') -match 'FAIL:') { 'FAIL' } elseif ((@($contextManagementVerification) -join ' ') -match 'PASS:') { 'PASS' } else { 'INFO' })" }
Write-Host "Verification report written to $reportPath" -ForegroundColor Green


