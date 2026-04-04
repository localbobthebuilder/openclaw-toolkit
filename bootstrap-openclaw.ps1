[CmdletBinding()]
param(
    [string]$ConfigPath,
    [Alias("SkipPrerequisites")]
    [switch]$SkipFullPrerequisiteAudit
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-upstream-patches.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

$usingPowerShellCore = $PSVersionTable.PSEdition -eq "Core"
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $usingPowerShellCore -and $null -ne $pwshCommand) {
    Write-Host "INFO: Running under Windows PowerShell. 'pwsh' is installed and preferred for future runs." -ForegroundColor Yellow
    Write-Host "INFO: Next time, launch via run-bootstrap.cmd or run:" -ForegroundColor Yellow
    Write-Host "      pwsh -ExecutionPolicy Bypass -File $($MyInvocation.MyCommand.Path)" -ForegroundColor Yellow
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "WARNING: $Message" -ForegroundColor Yellow
}

function Write-InfoLine {
    param([string]$Message)
    Write-Host "INFO: $Message" -ForegroundColor DarkGray
}

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure,
        [switch]$StreamOutput,
        [switch]$Quiet
    )

    if (-not $Quiet) {
        Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
    }
    if ($StreamOutput) {
        $capturedLines = [System.Collections.Generic.List[string]]::new()
        Push-Location (Get-Location).Path
        try {
            & $FilePath @Arguments 2>&1 | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    $line = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { $_.ToString() }
                }
                else {
                    $line = $_.ToString()
                }
                $capturedLines.Add($line)
                if (-not $Quiet) {
                    Write-Host $line
                }
            }
            $exitCode = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }

        $text = ($capturedLines.ToArray() -join [Environment]::NewLine).Trim()
        if (-not $AllowFailure -and $exitCode -ne 0) {
            throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')"
        }

        return [pscustomobject]@{
            ExitCode = $exitCode
            Output   = $text
        }
    }

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

    if ($text -and -not $Quiet) {
        Write-Host $text
    }

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
    }
    finally {
        $sha.Dispose()
    }

    return -join ($hash | ForEach-Object { $_.ToString("x2") })
}

function Get-ManagedUpstreamPatchFingerprint {
    param([Parameter(Mandatory = $true)][object[]]$Patches)

    if ($Patches.Count -eq 0) {
        return ""
    }

    $parts = foreach ($patch in ($Patches | Sort-Object Name, Path)) {
        $hash = (Get-FileHash -LiteralPath $patch.Path -Algorithm SHA256).Hash.ToLowerInvariant()
        "$($patch.Name)|$($patch.Path)|$hash"
    }

    return Get-Sha256Hex -Text ($parts -join "`n")
}

function Get-DockerImageLabelValue {
    param(
        [Parameter(Mandatory = $true)][string]$ImageTag,
        [Parameter(Mandatory = $true)][string]$LabelName
    )

    $format = "{{ index .Config.Labels `"$LabelName`" }}"
    $probe = Invoke-External -FilePath "docker" -Arguments @("image", "inspect", "--format", $format, $ImageTag) -AllowFailure
    if ($probe.ExitCode -ne 0) {
        return ""
    }

    $value = ($probe.Output ?? "").Trim()
    if ($value -eq "<no value>") {
        return ""
    }

    return $value
}

function Backup-File {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (Test-Path $Path) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupRoot = Join-Path (Split-Path -Parent $PSCommandPath) "backups"
        if (-not (Test-Path $backupRoot)) {
            New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        }
        $backupName = "$(Split-Path -Leaf $Path).bootstrap-backup-$stamp"
        Copy-Item -LiteralPath $Path -Destination (Join-Path $backupRoot $backupName) -Force
    }
}

function New-RandomHexToken {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }

    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Convert-WindowsPathToDockerDesktop {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant()
        $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "/$drive"
        }
        return "/$drive/$rest"
    }

    return ($fullPath -replace '\\', '/')
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

function Ensure-RepoPresent {
    param([Parameter(Mandatory = $true)]$Config)

    if (Test-Path $Config.repoPath) {
        if (-not (Test-Path (Join-Path $Config.repoPath ".git"))) {
            throw "Repo path exists but is not a git checkout: $($Config.repoPath)"
        }

        Write-Host "OpenClaw repo already present at $($Config.repoPath)." -ForegroundColor Green
        return
    }

    $parentDir = Split-Path -Parent $Config.repoPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    Write-Step "Cloning OpenClaw repository"
    $cloneArgs = @("clone")
    if ($Config.repoCloneDepth) {
        $cloneArgs += @("--depth", [string]$Config.repoCloneDepth)
    }
    $cloneArgs += @([string]$Config.repoUrl, [string]$Config.repoPath)
    $null = Invoke-External -FilePath "git" -Arguments $cloneArgs
}

function Ensure-LocalhostDockerPorts {
    param(
        [Parameter(Mandatory = $true)][string]$ComposePath
    )

    $raw = Get-Content -Raw $ComposePath
    $updated = $raw
    $updated = [regex]::Replace(
        $updated,
        '(?m)^(\s*-\s*)"\$\{OPENCLAW_GATEWAY_PORT:-18789\}:18789"\s*$',
        '${1}"127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18789}:18789"'
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^(\s*-\s*)"\$\{OPENCLAW_BRIDGE_PORT:-18790\}:18790"\s*$',
        '${1}"127.0.0.1:${OPENCLAW_BRIDGE_PORT:-18790}:18790"'
    )

    if ($updated -ne $raw) {
        Backup-File -Path $ComposePath
        Set-Content -Path $ComposePath -Value $updated -Encoding UTF8
        Write-Host "Updated docker-compose port publishing to localhost-only." -ForegroundColor Green
    }
    else {
        Write-Host "Docker Compose already publishes OpenClaw on localhost only."
    }
}

function Ensure-SandboxComposeSupport {
    param(
        [Parameter(Mandatory = $true)][string]$ComposePath,
        [Parameter(Mandatory = $true)]$SandboxConfig
    )

    if (-not $SandboxConfig.enabled) {
        return
    }

    $raw = Get-Content -Raw $ComposePath
    $updated = $raw
    $socketMount = "      - $($SandboxConfig.dockerSocketSource):$($SandboxConfig.dockerSocketTarget)"
    $managedSocketComment = "      # Bootstrap-managed Windows Docker Desktop sandbox support."

    $updated = [regex]::Replace(
        $updated,
        "(?ms)^\s*## Uncomment the lines below to enable sandbox isolation\r?\n\s*## \(agents\.defaults\.sandbox\)\. Requires Docker CLI in the image\r?\n\s*## \(build with --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1\) or use\r?\n\s*## scripts/docker/setup\.sh with OPENCLAW_SANDBOX=1 for automated setup\.\r?\n\s*## Set DOCKER_GID to the host''s docker group GID \(run: stat -c ''%g'' /var/run/docker\.sock\)\.\r?\n\s*# - /var/run/docker\.sock:/var/run/docker\.sock\r?\n",
        "$managedSocketComment" + [Environment]::NewLine
    )

    if ($updated -notmatch [regex]::Escape($SandboxConfig.dockerSocketSource)) {
        $updated = [regex]::Replace(
            $updated,
            '(?m)^(\s*-\s*\$\{OPENCLAW_WORKSPACE_DIR\}:/home/node/\.openclaw/workspace\s*)$',
            '$1' + [Environment]::NewLine + $managedSocketComment + [Environment]::NewLine + $socketMount,
            1
        )
    }

    $desiredGroupAdd = '    group_add:' + [Environment]::NewLine + "      - `"$($SandboxConfig.dockerSocketGroup)`""
    if ($updated -match '(?ms)^\s*# group_add:\s*\r?\n\s*#\s+- "\$\{DOCKER_GID:-999\}"\s*$') {
        $updated = [regex]::Replace(
            $updated,
            '(?ms)^\s*# group_add:\s*\r?\n\s*#\s+- "\$\{DOCKER_GID:-999\}"\s*$',
            $desiredGroupAdd,
            1
        )
    }
    elseif ($updated -match '(?ms)^\s*group_add:\s*\r?\n\s*-\s*".*?"\s*$') {
        $updated = [regex]::Replace(
            $updated,
            '(?ms)^\s*group_add:\s*\r?\n\s*-\s*".*?"\s*$',
            $desiredGroupAdd,
            1
        )
    }
    else {
        $updated = [regex]::Replace(
            $updated,
            '(?m)^(\s*)ports:\s*$',
            $desiredGroupAdd + [Environment]::NewLine + '$1ports:',
            1
        )
    }

    if ($updated -ne $raw) {
        Backup-File -Path $ComposePath
        Set-Content -Path $ComposePath -Value $updated -Encoding UTF8
        Write-Host "Updated docker-compose for Docker-backed sandboxing." -ForegroundColor Green
    }
    else {
        Write-Host "Docker Compose already includes sandbox socket support."
    }
}

function Ensure-GatewayImageSupportsSandbox {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not $Config.sandbox.enabled -or -not $Config.sandbox.buildGatewayImageWithDockerCli) {
        return
    }

    $sourceVersion = Get-OpenClawRepoVersion -RepoPath $Config.repoPath
    $imageVersion = Get-OpenClawImageVersion -ImageTag ([string]$Config.sandbox.gatewayImageTag)
    $patchFingerprint = Get-ManagedUpstreamPatchFingerprint -Patches $managedUpstreamPatches
    $imagePatchFingerprint = Get-DockerImageLabelValue -ImageTag ([string]$Config.sandbox.gatewayImageTag) -LabelName "io.openclaw.toolkit.upstream-patches-sha"

    $dockerProbe = Invoke-External -FilePath "docker" -Arguments @(
        "run", "--rm", "--entrypoint", "sh", $Config.sandbox.gatewayImageTag,
        "-lc", "docker --version"
    ) -AllowFailure

    $needsRebuild = $dockerProbe.ExitCode -ne 0
    if (-not $needsRebuild -and $sourceVersion -and $imageVersion -and $sourceVersion -ne $imageVersion) {
        Write-WarnLine "Gateway image $($Config.sandbox.gatewayImageTag) is on OpenClaw $imageVersion but repo is $sourceVersion. Rebuilding."
        $needsRebuild = $true
    }
    if (-not $needsRebuild -and $patchFingerprint -ne $imagePatchFingerprint) {
        Write-WarnLine "Gateway image $($Config.sandbox.gatewayImageTag) is missing the current managed patch fingerprint. Rebuilding."
        $needsRebuild = $true
    }

    if (-not $needsRebuild) {
        Write-Host "Gateway image already includes Docker CLI support and matches repo version." -ForegroundColor Green
        return
    }

    Write-Step "Building gateway image with Docker CLI support"
    Push-Location $Config.repoPath
    try {
        $null = Invoke-External -FilePath "docker" -Arguments @(
            "build", "-t", $Config.sandbox.gatewayImageTag,
            "--label", "io.openclaw.toolkit.upstream-patches-sha=$patchFingerprint",
            "--build-arg", "OPENCLAW_INSTALL_DOCKER_CLI=1",
            "-f", "Dockerfile", "."
        ) -StreamOutput
    }
    finally {
        Pop-Location
    }
}

function Set-EnvVarValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $raw = if (Test-Path $Path) { Get-Content -Raw $Path } else { "" }
    $updated = $raw
    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    $replacement = "${Name}=${Value}"

    if ($updated -match $pattern) {
        $updated = [regex]::Replace($updated, $pattern, $replacement, 1)
    }
    else {
        $trimmed = $updated.TrimEnd("`r", "`n")
        if ($trimmed.Length -gt 0) {
            $updated = $trimmed + [Environment]::NewLine + $replacement + [Environment]::NewLine
        }
        else {
            $updated = $replacement + [Environment]::NewLine
        }
    }

    if ($updated -ne $raw) {
        Backup-File -Path $Path
        Set-Content -Path $Path -Value $updated -Encoding UTF8
        Write-Host "Updated $Name in $(Split-Path -Leaf $Path)." -ForegroundColor Green
    }
}

function Ensure-LocalWhisperGatewayImage {
    param([Parameter(Mandatory = $true)]$Config)

    if ($null -eq $Config.voiceNotes -or -not $Config.voiceNotes.enabled) {
        return
    }

    if ($Config.voiceNotes.mode -ne "local-whisper") {
        return
    }

    $targetImage = if ($Config.voiceNotes.gatewayImageTag) {
        [string]$Config.voiceNotes.gatewayImageTag
    }
    else {
        "openclaw:local-voice"
    }

    $sourceVersion = Get-OpenClawRepoVersion -RepoPath $Config.repoPath
    $imageVersion = Get-OpenClawImageVersion -ImageTag $targetImage
    $patchFingerprint = Get-ManagedUpstreamPatchFingerprint -Patches $managedUpstreamPatches
    $imagePatchFingerprint = Get-DockerImageLabelValue -ImageTag $targetImage -LabelName "io.openclaw.toolkit.upstream-patches-sha"

    $probe = Invoke-External -FilePath "docker" -Arguments @(
        "run", "--rm", "--entrypoint", "sh", $targetImage,
        "-lc", "whisper --help >/dev/null 2>&1 && ffmpeg -version >/dev/null 2>&1"
    ) -AllowFailure

    $needsRebuild = $probe.ExitCode -ne 0
    if (-not $needsRebuild -and $sourceVersion -and $imageVersion -and $sourceVersion -ne $imageVersion) {
        Write-WarnLine "Gateway image $targetImage is on OpenClaw $imageVersion but repo is $sourceVersion. Rebuilding."
        $needsRebuild = $true
    }
    if (-not $needsRebuild -and $patchFingerprint -ne $imagePatchFingerprint) {
        Write-WarnLine "Gateway image $targetImage is missing the current managed patch fingerprint. Rebuilding."
        $needsRebuild = $true
    }

    if ($needsRebuild) {
        $dockerfilePath = Join-Path (Split-Path -Parent $PSCommandPath) "Dockerfile.gateway-local-whisper"
        if (-not (Test-Path $dockerfilePath)) {
            throw "Local whisper Dockerfile not found: $dockerfilePath"
        }

        Write-Step "Building gateway image with local whisper support"
        $null = Invoke-External -FilePath "docker" -Arguments @(
            "build",
            "-t", $targetImage,
            "--label", "io.openclaw.toolkit.upstream-patches-sha=$patchFingerprint",
            "--build-arg", "BASE_IMAGE=$($Config.sandbox.gatewayImageTag)",
            "-f", $dockerfilePath,
            (Split-Path -Parent $dockerfilePath)
        ) -StreamOutput
    }
    else {
        Write-Host "Gateway image already includes local whisper support and matches repo version." -ForegroundColor Green
    }

    Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_IMAGE" -Value $targetImage
}

function Get-OpenClawRepoVersion {
    param([Parameter(Mandatory = $true)][string]$RepoPath)

    $packageJsonPath = Join-Path $RepoPath "package.json"
    if (-not (Test-Path $packageJsonPath)) {
        return $null
    }

    try {
        $pkg = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
        return [string]$pkg.version
    }
    catch {
        return $null
    }
}

function Get-OpenClawImageVersion {
    param([Parameter(Mandatory = $true)][string]$ImageTag)

    $probe = Invoke-External -FilePath "docker" -Arguments @(
        "run", "--rm", "--entrypoint", "sh", $ImageTag,
        "-lc", "sed -n '1,20p' /app/package.json"
    ) -AllowFailure

    if ($probe.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($probe.Output)) {
        return $null
    }

    $match = [regex]::Match($probe.Output, '"version"\s*:\s*"([^"]+)"')
    if ($match.Success) {
        return $match.Groups[1].Value
    }

    return $null
}

function Ensure-SandboxImages {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not $Config.sandbox.enabled) {
        return
    }

    $baseProbe = Invoke-External -FilePath "docker" -Arguments @("image", "inspect", $Config.sandbox.sandboxBaseImage) -AllowFailure
    if ($baseProbe.ExitCode -ne 0) {
        Write-Step "Building base sandbox image"
        Push-Location $Config.repoPath
        try {
            $null = Invoke-External -FilePath "docker" -Arguments @(
                "build", "-t", $Config.sandbox.sandboxBaseImage,
                "-f", "Dockerfile.sandbox", "."
            )
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host "Base sandbox image already exists."
    }

    $commonProbe = Invoke-External -FilePath "docker" -Arguments @("image", "inspect", $Config.sandbox.sandboxImage) -AllowFailure
    if ($commonProbe.ExitCode -ne 0) {
        Write-Step "Building common sandbox image"
        Push-Location $Config.repoPath
        try {
            $null = Invoke-External -FilePath "docker" -Arguments @(
                "build", "-t", $Config.sandbox.sandboxImage,
                "-f", "Dockerfile.sandbox-common",
                "--build-arg", "BASE_IMAGE=$($Config.sandbox.sandboxBaseImage)",
                "."
            )
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host "Common sandbox image already exists."
    }
}

function Wait-ForGateway {
    param(
        [Parameter(Mandatory = $true)][string]$HealthUrl,
        [int]$MaxAttempts = 20
    )

    for ($i = 1; $i -le $MaxAttempts; $i++) {
        $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $HealthUrl) -AllowFailure
        if ($result.ExitCode -eq 0 -and $result.Output -match '"ok"\s*:\s*true') {
            Write-Host "Gateway is healthy." -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 3
    }

    throw "Gateway never became healthy at $HealthUrl"
}

function Ensure-TailscaleServe {
    param(
        [Parameter(Mandatory = $true)]$Config
    )

    if (-not $Config.tailscale.enableServe) {
        Write-Host "Tailscale Serve bootstrap disabled in config."
        return
    }

    $serveStatus = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure
    if ($serveStatus.ExitCode -eq 0 -and $serveStatus.Output -match [regex]::Escape($Config.tailscale.proxyTarget)) {
        Write-Host "Tailscale Serve already points at $($Config.tailscale.proxyTarget)." -ForegroundColor Green
        return
    }

    $serveArgs = @("serve", "--bg", $Config.tailscale.proxyTarget)
    $apply = Invoke-External -FilePath "tailscale" -Arguments $serveArgs -AllowFailure
    if ($apply.ExitCode -eq 0) {
        Write-Host "Tailscale Serve configured." -ForegroundColor Green
        return
    }

    $statusJson = Invoke-External -FilePath "tailscale" -Arguments @("status", "--json")
    $status = $statusJson.Output | ConvertFrom-Json
    $nodeId = $status.Self.ID
    if (-not $nodeId) {
        throw "Could not determine Tailscale node id for Serve enablement."
    }

    $enableUrl = "https://login.tailscale.com/f/serve?node=$nodeId"
    Write-WarnLine "Tailscale Serve could not be enabled automatically."
    Write-Host "Open this page, enable HTTPS certificates and Serve, then return here:" -ForegroundColor Yellow
    Write-Host $enableUrl -ForegroundColor Yellow
    Start-Process $enableUrl | Out-Null
    Read-Host "Press Enter after you finish the Tailscale page"

    $retry = Invoke-External -FilePath "tailscale" -Arguments $serveArgs -AllowFailure
    if ($retry.ExitCode -ne 0) {
        throw "Tailscale Serve still failed after manual enablement."
    }

    Write-Host "Tailscale Serve configured after manual approval." -ForegroundColor Green
}

function Invoke-InteractiveDockerSetup {
    param(
        [Parameter(Mandatory = $true)]$Config
    )

    if (-not (Test-CommandExists "bash")) {
        throw "OpenClaw Docker setup has not run yet and 'bash' is not available. Install Git Bash/WSL or run the repo setup manually first."
    }

    $setupScriptPath = Join-Path $Config.repoPath $Config.dockerSetupScriptRelativePath
    if (-not (Test-Path $setupScriptPath)) {
        throw "Docker setup script not found: $setupScriptPath"
    }

    $answer = Read-Host "OpenClaw Docker onboarding has not run yet. Run bash scripts/docker/setup.sh now? (y/n)"
    if ($answer -notin @("y", "Y", "yes", "YES")) {
        throw "Bootstrap needs the repo Docker setup completed first."
    }

    Push-Location $Config.repoPath
    try {
        Invoke-External -FilePath "bash" -Arguments @($setupScriptPath)
    }
    finally {
        Pop-Location
    }
}

function Ensure-EnvFile {
    param([Parameter(Mandatory = $true)]$Config)

    if (Test-Path $Config.envFilePath) {
        Write-Host ".env already exists. Skipping env seeding."
        return
    }

    $envDir = Split-Path -Parent $Config.envFilePath
    if (-not (Test-Path $envDir)) {
        New-Item -ItemType Directory -Force -Path $envDir | Out-Null
    }

    if ($Config.PSObject.Properties.Name -contains "envTemplatePath" -and $Config.envTemplatePath -and (Test-Path $Config.envTemplatePath)) {
        Copy-Item -LiteralPath $Config.envTemplatePath -Destination $Config.envFilePath -Force
        Write-Host "Seeded .env from setup template." -ForegroundColor Green

        $hostConfigDir = Get-HostConfigDir -Config $Config
        $hostWorkspaceDir = Get-HostWorkspaceDir -Config $Config
        if (-not (Test-Path $hostConfigDir)) {
            New-Item -ItemType Directory -Force -Path $hostConfigDir | Out-Null
        }
        if (-not (Test-Path $hostWorkspaceDir)) {
            New-Item -ItemType Directory -Force -Path $hostWorkspaceDir | Out-Null
        }

        Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_CONFIG_DIR" -Value (Convert-WindowsPathToDockerDesktop -Path $hostConfigDir)
        Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_WORKSPACE_DIR" -Value (Convert-WindowsPathToDockerDesktop -Path $hostWorkspaceDir)
        Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_GATEWAY_PORT" -Value ([string]$Config.gatewayPort)
        Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_BRIDGE_PORT" -Value ([string]$Config.bridgePort)
        Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_GATEWAY_BIND" -Value ([string]$Config.gatewayBind)

        $rawEnv = Get-Content -Raw $Config.envFilePath
        if ($rawEnv -notmatch '(?m)^OPENCLAW_GATEWAY_TOKEN=.+$') {
            Set-EnvVarValue -Path $Config.envFilePath -Name "OPENCLAW_GATEWAY_TOKEN" -Value (New-RandomHexToken)
        }

        return
    }

    Write-WarnLine "No env template found at $($Config.envTemplatePath). Falling back to interactive setup."
    Invoke-InteractiveDockerSetup -Config $Config
}

function Set-OpenClawConfigJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [switch]$AsArray
    )

    if (($AsArray -or $Value -is [System.Array]) -and @($Value).Count -eq 0) {
        $json = "[]"
    }
    else {
        if ($AsArray -or $Value -is [System.Array]) {
            $json = @($Value) | ConvertTo-Json -AsArray -Depth 50 -Compress
        }
        else {
            $json = $Value | ConvertTo-Json -Depth 50 -Compress
        }
    }

    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "config", "set", $Path, $json, "--strict-json"
    )
}

function Remove-OpenClawConfigValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "config", "unset", $Path
    ) -AllowFailure
}

function Set-OpenClawConfigValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $null = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "config", "set", $Path, $Value
    )
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

function Ensure-ControlUiAllowedOrigins {
    param([Parameter(Mandatory = $true)]$Config)

    $origins = @()
    $origins = Add-UniqueString -List $origins -Value "http://localhost:$($Config.gatewayPort)"
    $origins = Add-UniqueString -List $origins -Value "http://127.0.0.1:$($Config.gatewayPort)"

    $serveStatus = Invoke-External -FilePath "tailscale" -Arguments @("serve", "status") -AllowFailure
    if ($serveStatus.ExitCode -eq 0) {
        $firstLine = ($serveStatus.Output -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
        if ($firstLine -match '^(https://\S+?)(?:\s+\(|$)') {
            $origins = Add-UniqueString -List $origins -Value $Matches[1].TrimEnd("/")
        }
    }

    Set-OpenClawConfigJson -Path "gateway.controlUi.allowedOrigins" -Value @($origins) -AsArray
    Write-Host "Configured Control UI allowed origins: $(@($origins) -join ', ')" -ForegroundColor Green
}

function Get-ManagedModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$ResolvedStrongModelRef,
        [string]$ResolvedResearchModelRef,
        [string]$ResolvedLocalChatModelRef,
        [string]$ResolvedHostedTelegramModelRef,
        [string]$ResolvedLocalReviewModelRef,
        [string]$ResolvedLocalCoderModelRef,
        [string]$ResolvedRemoteReviewModelRef,
        [string]$ResolvedRemoteCoderModelRef,
        [string[]]$ExtraRefs = @()
    )

    $refs = @()
    $availableLocalRefs = @($ExtraRefs | ForEach-Object { [string]$_ })

    function Add-RefIfUsable {
        param(
            [string[]]$List,
            [string]$ModelRef
        )

        if ([string]::IsNullOrWhiteSpace($ModelRef)) {
            return @($List)
        }

        $modelRefText = [string]$ModelRef
        if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $modelRefText) -and ($modelRefText -notin $availableLocalRefs)) {
            return @($List)
        }

        return @(Add-UniqueString -List $List -Value $modelRefText)
    }

    if ($Config.multiAgent -and $Config.multiAgent.enabled) {
        foreach ($ref in @(
                $ResolvedStrongModelRef,
                $ResolvedResearchModelRef,
                $ResolvedLocalChatModelRef,
                $ResolvedHostedTelegramModelRef,
                $ResolvedLocalReviewModelRef,
                $ResolvedLocalCoderModelRef,
                $ResolvedRemoteReviewModelRef,
                $ResolvedRemoteCoderModelRef
            )) {
            $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$ref)
        }

        $agentConfigs = @(
            $Config.multiAgent.strongAgent,
            $Config.multiAgent.researchAgent,
            $Config.multiAgent.localChatAgent,
            $Config.multiAgent.hostedTelegramAgent,
            $Config.multiAgent.localReviewAgent,
            $Config.multiAgent.localCoderAgent,
            $Config.multiAgent.remoteReviewAgent,
            $Config.multiAgent.remoteCoderAgent
        )

        foreach ($agentConfig in @($agentConfigs)) {
            if ($null -eq $agentConfig) {
                continue
            }
            if ($agentConfig.PSObject.Properties.Name -contains "enabled" -and -not [bool]$agentConfig.enabled) {
                continue
            }
            if ($agentConfig.modelRef) {
                $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$agentConfig.modelRef)
            }
            foreach ($candidateRef in @($agentConfig.candidateModelRefs)) {
                $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$candidateRef)
            }
        }
    }

    foreach ($ref in @($ExtraRefs)) {
        $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$ref)
    }

    return @($refs)
}

function Get-OllamaTags {
    param([Parameter(Mandatory = $true)]$Endpoint)

    $tagsUrl = (Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint).TrimEnd("/") + "/api/tags"
    $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "--connect-timeout", "5", "--max-time", "20", $tagsUrl) -AllowFailure -Quiet
    if ($result.ExitCode -eq 0 -and $result.Output -and $result.Output -match '"models"') {
        try {
            $parsed = $result.Output | ConvertFrom-Json -Depth 20
            return @($parsed.models)
        }
        catch {
        }
    }

    $listResult = Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("list") -AllowFailure
    if ($listResult.ExitCode -ne 0 -or -not $listResult.Output) {
        return @()
    }

    Write-InfoLine "Falling back to 'ollama list' for endpoint '$($Endpoint.key)' because /api/tags was slow or unavailable."
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($line in @($listResult.Output -split "(`r`n|`n|`r)")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed -match '^NAME\s+') {
            continue
        }

        $modelId = ($trimmed -replace '\s{2,}.*$', '').Trim()
        if ([string]::IsNullOrWhiteSpace($modelId)) {
            continue
        }

        $entries.Add([pscustomobject]@{
                model   = $modelId
                name    = $modelId
                details = [pscustomobject]@{
                    family   = ""
                    families = @()
                }
            })
    }

    return @($entries)
}

function Refresh-OllamaTags {
    param([Parameter(Mandatory = $true)]$Endpoint)

    Write-InfoLine "Refreshing Ollama model catalog for endpoint '$($Endpoint.key)'..."
    $tags = @(Get-OllamaTags -Endpoint $Endpoint)
    if ($tags.Count -eq 0) {
        Write-InfoLine "No Ollama models were reported for endpoint '$($Endpoint.key)' during this refresh."
    }
    return @($tags)
}

function Convert-OllamaTagToProviderModel {
    param([Parameter(Mandatory = $true)]$Tag)

    $inputKinds = @("text")
    $tagText = ([string]::Join(" ", @(
                [string]$Tag.model,
                [string]$Tag.name,
                [string]$Tag.details.family,
                [string]::Join(" ", @($Tag.details.families))
            ))).ToLowerInvariant()
    if ($tagText -match 'vision|vl|llava|minicpm-v|qwen2\.5-vl|qwen-vl|gemma3') {
        $inputKinds = @("text", "image")
    }

    return [ordered]@{
        id    = [string]$Tag.model
        name  = if ($Tag.name) { [string]$Tag.name } else { [string]$Tag.model }
        input = $inputKinds
        cost  = [ordered]@{
            input      = 0
            output     = 0
            cacheRead  = 0
            cacheWrite = 0
        }
    }
}

function Convert-ConfiguredLocalModelToProviderModel {
    param([Parameter(Mandatory = $true)]$Model)

    $entry = [ordered]@{
        id    = [string]$Model.id
        name  = if ($Model.name) { [string]$Model.name } else { [string]$Model.id }
        input = @($Model.input)
        cost  = [ordered]@{
            input      = 0
            output     = 0
            cacheRead  = 0
            cacheWrite = 0
        }
    }

    if ($Model.PSObject.Properties.Name -contains "reasoning" -and $Model.reasoning) {
        $entry.reasoning = $true
    }
    if ($Model.PSObject.Properties.Name -contains "contextWindow" -and $Model.contextWindow) {
        $entry.contextWindow = [int]$Model.contextWindow
    }
    if ($Model.PSObject.Properties.Name -contains "maxTokens" -and $Model.maxTokens) {
        $entry.maxTokens = [int]$Model.maxTokens
    }
    if ($Model.PSObject.Properties.Name -contains "cost" -and $Model.cost) {
        $entry.cost = [ordered]@{
            input      = if ($Model.cost.input -ne $null) { $Model.cost.input } else { 0 }
            output     = if ($Model.cost.output -ne $null) { $Model.cost.output } else { 0 }
            cacheRead  = if ($Model.cost.cacheRead -ne $null) { $Model.cost.cacheRead } else { 0 }
            cacheWrite = if ($Model.cost.cacheWrite -ne $null) { $Model.cost.cacheWrite } else { 0 }
        }
    }

    return $entry
}

function Invoke-OllamaCli {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "The 'ollama' CLI is required."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        $output = & $command.Source @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }

    $text = (@($output) | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): ollama $($Arguments -join ' ')`n$text"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Invoke-OllamaCliStreaming {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "The 'ollama' CLI is required."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        & $command.Source @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }

    if ($exitCode -ne 0) {
        throw "Command failed ($exitCode): ollama $($Arguments -join ' ')"
    }
}

function Get-AgentOllamaEndpointKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "endpointKey" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.endpointKey)) {
        return [string]$AgentConfig.endpointKey
    }

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    if ($null -ne $defaultEndpoint) {
        return [string]$defaultEndpoint.key
    }

    return "local"
}

function Resolve-OllamaModelRef {
    param(
        [string]$DesiredRef,
        [string[]]$AvailableRefs = @(),
        [Parameter(Mandatory = $true)]$Config,
        [string]$Purpose,
        [string]$EndpointKey
    )

    if ([string]::IsNullOrWhiteSpace($DesiredRef) -or (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $DesiredRef) -and -not $DesiredRef.StartsWith("ollama/"))) {
        return $DesiredRef
    }

    $desiredResolvedRef = Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $DesiredRef -EndpointKey $EndpointKey
    if ($desiredResolvedRef -in @($AvailableRefs)) {
        return $desiredResolvedRef
    }

    foreach ($model in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
        if ($model.id) {
            $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $EndpointKey
            if ($candidate -in @($AvailableRefs)) {
                Write-WarnLine "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $candidate."
                return $candidate
            }
        }
    }

    if (@($AvailableRefs).Count -gt 0) {
        Write-WarnLine "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $($AvailableRefs[0])."
        return [string]$AvailableRefs[0]
    }

    Write-WarnLine "Preferred $Purpose model $desiredResolvedRef is unavailable and no local Ollama fallback is present."
    return $desiredResolvedRef
}

function Ensure-OllamaState {
    param([Parameter(Mandatory = $true)]$Config)

    $state = [ordered]@{
        Reachable                 = $false
        EndpointStates            = @{}
        AvailableRefs             = @()
        ProviderEntries           = @{}
        ResolvedLocalChatModelRef = $null
        ResolvedHostedTelegramModelRef = $null
        ResolvedLocalReviewModelRef = $null
        ResolvedLocalCoderModelRef = $null
        ResolvedRemoteReviewModelRef = $null
        ResolvedRemoteCoderModelRef = $null
    }

    $referencedLocalModels = New-Object System.Collections.Generic.List[object]
    $referencedLocalModelKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($agentConfig in @(
            $Config.multiAgent.localChatAgent,
            $Config.multiAgent.localReviewAgent,
            $Config.multiAgent.localCoderAgent,
            $Config.multiAgent.remoteReviewAgent,
            $Config.multiAgent.remoteCoderAgent
        )) {
        if ($null -eq $agentConfig -or -not ($agentConfig.PSObject.Properties.Name -contains "enabled") -or -not $agentConfig.enabled) {
            continue
        }
        $modelSource = if ($agentConfig.PSObject.Properties.Name -contains "modelSource" -and $agentConfig.modelSource) {
            ([string]$agentConfig.modelSource).ToLowerInvariant()
        }
        else {
            "static"
        }
        if ($modelSource -ne "local") {
            continue
        }

        $endpointKey = Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $agentConfig
        foreach ($candidate in @($agentConfig.candidateModelRefs)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$candidate) -and ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef ([string]$candidate)) -or ([string]$candidate).StartsWith("ollama/"))) {
                $modelId = Get-ToolkitModelIdFromRef -ModelRef ([string]$candidate)
                $requestKey = "$endpointKey::$modelId"
                if ($referencedLocalModelKeys.Add($requestKey)) {
                    $referencedLocalModels.Add([pscustomobject]@{ endpointKey = $endpointKey; modelId = $modelId })
                }
            }
        }
        if ($agentConfig.modelRef -and ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef ([string]$agentConfig.modelRef)) -or ([string]$agentConfig.modelRef).StartsWith("ollama/"))) {
            $modelId = Get-ToolkitModelIdFromRef -ModelRef ([string]$agentConfig.modelRef)
            $requestKey = "$endpointKey::$modelId"
            if ($referencedLocalModelKeys.Add($requestKey)) {
                $referencedLocalModels.Add([pscustomobject]@{ endpointKey = $endpointKey; modelId = $modelId })
            }
        }
    }

    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        foreach ($desiredModelId in @($endpoint.desiredModelIds)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$desiredModelId)) {
                $requestKey = "$([string]$endpoint.key)::$([string]$desiredModelId)"
                if ($referencedLocalModelKeys.Add($requestKey)) {
                    $referencedLocalModels.Add([pscustomobject]@{
                            endpointKey = [string]$endpoint.key
                            modelId     = [string]$desiredModelId
                        })
                }
            }
        }

        $tags = @(Refresh-OllamaTags -Endpoint $endpoint)
        $availableIds = @($tags | ForEach-Object { [string]$_.model })

        if ($endpoint.autoPullMissingModels) {
            foreach ($request in @($referencedLocalModels | Where-Object { $_.endpointKey -eq $endpoint.key })) {
                if ($request.modelId -in $availableIds) {
                    continue
                }

                Write-Step "Pulling missing Ollama model $($request.modelId) on endpoint $($endpoint.key)"
                try {
                    Invoke-OllamaCliStreaming -Endpoint $endpoint -Arguments @("pull", [string]$request.modelId)
                    Write-InfoLine "Pull finished for model '$($request.modelId)' on endpoint '$($endpoint.key)'."
                }
                catch {
                    Write-WarnLine "Failed to pull Ollama model '$($request.modelId)' on endpoint '$($endpoint.key)'. Bootstrap will use another available local model if possible."
                }
            }

            $tags = @(Refresh-OllamaTags -Endpoint $endpoint)
            $availableIds = @($tags | ForEach-Object { [string]$_.model })
        }

        if ($tags.Count -gt 0) {
            $state.Reachable = $true
        }

        $availableRefs = @()
        foreach ($tag in $tags) {
            if ($tag.model) {
                $availableRefs = Add-UniqueString -List $availableRefs -Value (Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$tag.model) -EndpointKey ([string]$endpoint.key))
            }
        }

        foreach ($ref in @($availableRefs)) {
            $state.AvailableRefs = Add-UniqueString -List $state.AvailableRefs -Value $ref
        }

        $providerModels = @()
        $configuredIds = @()
        foreach ($configuredModel in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
            if (-not $configuredModel.id) {
                continue
            }
            $configuredIds = Add-UniqueString -List $configuredIds -Value ([string]$configuredModel.id)
            if ([string]$configuredModel.id -in $availableIds) {
                $effectiveConfiguredModel = Get-ToolkitEffectiveLocalModelEntry -Config $Config -ModelId ([string]$configuredModel.id) -EndpointKey ([string]$endpoint.key)
                if ($null -ne $effectiveConfiguredModel) {
                    $providerModels += (Convert-ConfiguredLocalModelToProviderModel -Model $effectiveConfiguredModel)
                }
            }
        }

        foreach ($tag in $tags) {
            $tagId = [string]$tag.model
            if ($tagId -notin $configuredIds) {
                $providerModels += (Convert-OllamaTagToProviderModel -Tag $tag)
            }
        }

        $state.EndpointStates[$endpoint.key] = [ordered]@{
            endpoint      = $endpoint
            tags          = @($tags)
            availableRefs = @($availableRefs)
        }
        $state.ProviderEntries[$endpoint.providerId] = [ordered]@{
            baseUrl = Get-ToolkitOllamaProviderBaseUrl -Endpoint $endpoint
            apiKey  = [string]$endpoint.apiKey
            api     = "ollama"
            models  = @($providerModels)
        }
    }

    if ($Config.multiAgent -and $Config.multiAgent.localChatAgent -and $Config.multiAgent.localChatAgent.enabled) {
        $state.ResolvedLocalChatModelRef = Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.localChatAgent -AvailableOllamaRefs $state.AvailableRefs -Purpose "chat-local" -FallbackToFirstCandidate
    }
    if ($Config.multiAgent -and $Config.multiAgent.localReviewAgent -and $Config.multiAgent.localReviewAgent.enabled) {
        $state.ResolvedLocalReviewModelRef = Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.localReviewAgent -AvailableOllamaRefs $state.AvailableRefs -Purpose "review-local" -FallbackToFirstCandidate
    }
    if ($Config.multiAgent -and $Config.multiAgent.localCoderAgent -and $Config.multiAgent.localCoderAgent.enabled) {
        $state.ResolvedLocalCoderModelRef = Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.localCoderAgent -AvailableOllamaRefs $state.AvailableRefs -Purpose "coder-local" -FallbackToFirstCandidate
    }
    if ($Config.multiAgent -and $Config.multiAgent.remoteReviewAgent -and $Config.multiAgent.remoteReviewAgent.enabled) {
        $state.ResolvedRemoteReviewModelRef = Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.remoteReviewAgent -AvailableOllamaRefs $state.AvailableRefs -Purpose "review-remote" -FallbackToFirstCandidate
    }
    if ($Config.multiAgent -and $Config.multiAgent.remoteCoderAgent -and $Config.multiAgent.remoteCoderAgent.enabled) {
        $state.ResolvedRemoteCoderModelRef = Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.remoteCoderAgent -AvailableOllamaRefs $state.AvailableRefs -Purpose "coder-remote" -FallbackToFirstCandidate
    }

    return [pscustomobject]$state
}

function Get-AuthReadyHostedProviders {
    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "models", "status", "--json"
    ) -AllowFailure

    $providers = @()
    if ($result.ExitCode -eq 0 -and $result.Output) {
        try {
            $parsed = $result.Output | ConvertFrom-Json -Depth 50
            foreach ($providerEntry in @($parsed.auth.providers)) {
                if ($providerEntry.provider -and $providerEntry.provider -ne "ollama" -and $providerEntry.effective.kind -and $providerEntry.effective.kind -ne "missing") {
                    $providers = Add-UniqueString -List $providers -Value ([string]$providerEntry.provider)
                }
            }
        }
        catch {
        }
    }

    return @($providers)
}

function Get-PreferredLocalFallbackRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AvailableOllamaRefs = @()
    )

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    $defaultEndpointKey = if ($null -ne $defaultEndpoint) { [string]$defaultEndpoint.key } else { "local" }
    foreach ($model in @(Get-ToolkitLocalModelCatalog -Config $Config)) {
        if ($model.id) {
            $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $defaultEndpointKey
            if ($candidate -in @($AvailableOllamaRefs)) {
                return $candidate
            }
        }
    }

    if (@($AvailableOllamaRefs).Count -gt 0) {
        return [string]$AvailableOllamaRefs[0]
    }

    return $null
}

function Resolve-StrongModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AvailableOllamaRefs = @()
    )
    return (Resolve-AgentPreferredModelRef -Config $Config -AgentConfig $Config.multiAgent.strongAgent -AvailableOllamaRefs $AvailableOllamaRefs -Purpose "strong agent" -FallbackToFirstCandidate)
}

function Resolve-HostedModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string[]]$CandidateRefs,
        [Parameter(Mandatory = $true)][string]$Purpose,
        [switch]$FallbackToFirstCandidate
    )

    $candidateList = @()
    foreach ($candidateRef in @($CandidateRefs)) {
        $candidateList = Add-UniqueString -List $candidateList -Value ([string]$candidateRef)
    }

    if (@($candidateList).Count -eq 0) {
        return $null
    }

    $authReadyProviders = Get-AuthReadyHostedProviders
    foreach ($candidateRef in @($candidateList)) {
        if ($candidateRef -like "ollama/*") {
            continue
        }

        $providerId = ($candidateRef -split "/", 2)[0]
        if ($providerId -in @($authReadyProviders)) {
            return $candidateRef
        }
    }

    if ($FallbackToFirstCandidate) {
        $fallbackCandidate = [string](@($candidateList)[0])
        Write-WarnLine "No authenticated hosted provider is ready for $Purpose. Keeping preferred model ref $fallbackCandidate until auth is completed."
        return $fallbackCandidate
    }

    return $null
}

function Resolve-AgentPreferredModelRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [string[]]$AvailableOllamaRefs = @(),
        [Parameter(Mandatory = $true)][string]$Purpose,
        [switch]$FallbackToFirstCandidate
    )

    $candidateRefs = @()
    foreach ($candidateRef in @($AgentConfig.candidateModelRefs)) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$candidateRef)
    }
    if ($AgentConfig.modelRef) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$AgentConfig.modelRef)
    }

    $modelSource = if ($AgentConfig.PSObject.Properties.Name -contains "modelSource" -and $AgentConfig.modelSource) {
        ([string]$AgentConfig.modelSource).ToLowerInvariant()
    }
    else {
        "static"
    }

    if ($modelSource -eq "hosted") {
        $authReadyProviders = Get-AuthReadyHostedProviders
        foreach ($candidateRef in @($candidateRefs)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef -like "ollama/*") {
                $endpointKey = Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig
                $resolvedLocalCandidate = Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $candidateRef -EndpointKey $endpointKey
                if ($resolvedLocalCandidate -in @($AvailableOllamaRefs) -and $AgentConfig.PSObject.Properties.Name -contains "allowLocalFallback" -and [bool]$AgentConfig.allowLocalFallback) {
                    return $resolvedLocalCandidate
                }
                continue
            }

            $providerId = ($candidateRef -split "/", 2)[0]
            if ($providerId -in @($authReadyProviders)) {
                return $candidateRef
            }
        }

        if ($AgentConfig.PSObject.Properties.Name -contains "allowLocalFallback" -and [bool]$AgentConfig.allowLocalFallback) {
            foreach ($candidateRef in @($candidateRefs)) {
                if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef -like "ollama/*") {
                    return (Resolve-OllamaModelRef -DesiredRef $candidateRef -AvailableRefs $AvailableOllamaRefs -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig))
                }
            }
            $localFallbackRef = Get-PreferredLocalFallbackRef -Config $Config -AvailableOllamaRefs $AvailableOllamaRefs
            if ($localFallbackRef) {
                Write-WarnLine "No authenticated hosted provider is ready for $Purpose. Falling back to local model $localFallbackRef."
                return $localFallbackRef
            }
        }

        if ($FallbackToFirstCandidate -and @($candidateRefs).Count -gt 0) {
            $fallbackCandidate = [string](@($candidateRefs)[0])
            Write-WarnLine "No authenticated preferred provider is ready for $Purpose. Keeping preferred model ref $fallbackCandidate until auth is completed."
            return $fallbackCandidate
        }

        return $null
    }

    if ($modelSource -eq "local") {
        foreach ($candidateRef in @($candidateRefs)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef -like "ollama/*") {
                return (Resolve-OllamaModelRef -DesiredRef $candidateRef -AvailableRefs $AvailableOllamaRefs -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig))
            }
        }

        return $null
    }

    if ($FallbackToFirstCandidate -and @($candidateRefs).Count -gt 0) {
        $fallbackCandidate = [string](@($candidateRefs)[0])
        Write-WarnLine "No authenticated preferred provider is ready for $Purpose. Keeping preferred model ref $fallbackCandidate until auth is completed."
        return $fallbackCandidate
    }

    return $null
}

function Get-OpenClawConfigJsonValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "config", "get", $Path
    ) -AllowFailure

    if ($result.ExitCode -ne 0) {
        return $null
    }

    $raw = $result.Output.Trim()
    if (-not $raw) {
        return $null
    }

    try {
        return $raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Unset-OpenClawConfigPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = Invoke-External -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "node", "dist/index.js",
        "config", "unset", $Path
    ) -AllowFailure

    if ($result.ExitCode -eq 0) {
        return
    }

    if ($result.Output -match "Config path not found") {
        return
    }

    throw "Failed to unset config path '$Path'.`n$($result.Output)"
}

function Clear-RedundantNodeDenyCommands {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not $Config.clearRedundantDangerousNodeDenyCommands) {
        return
    }

    $nodesConfig = Get-OpenClawConfigJsonValue -Path "gateway.nodes"
    if ($null -eq $nodesConfig) {
        return
    }

    $allowCommands = @($nodesConfig.allowCommands | Where-Object {
            $null -ne $_ -and $_.ToString().Trim().Length -gt 0
        })
    if ($allowCommands.Count -gt 0) {
        Write-Host "Keeping gateway.nodes.denyCommands because custom allowCommands are configured."
        return
    }

    $denyCommands = @($nodesConfig.denyCommands | Where-Object {
            $null -ne $_ -and $_.ToString().Trim().Length -gt 0
        })
    if ($denyCommands.Count -eq 0) {
        return
    }

    $dangerousCommands = @(
        "camera.snap",
        "camera.clip",
        "screen.record",
        "contacts.add",
        "calendar.add",
        "reminders.add",
        "sms.send",
        "sms.search"
    )

    $customEntries = @($denyCommands | Where-Object { $_ -notin $dangerousCommands })
    if ($customEntries.Count -gt 0) {
        Write-WarnLine "Keeping gateway.nodes.denyCommands because it contains custom entries: $($customEntries -join ', ')"
        return
    }

    Unset-OpenClawConfigPath -Path "gateway.nodes.denyCommands"
    Write-Host "Removed redundant gateway.nodes.denyCommands entries." -ForegroundColor Green
}

function Configure-TelegramSurface {
    param([Parameter(Mandatory = $true)]$Config)

    if ($null -eq $Config.telegram -or -not $Config.telegram.enabled) {
        return
    }

    $telegramConfig = Get-OpenClawConfigJsonValue -Path "channels.telegram"
    if ($null -eq $telegramConfig) {
        return
    }

    if (-not $telegramConfig.enabled) {
        return
    }

    if ($Config.telegram.dmPolicy) {
        Set-OpenClawConfigValue -Path "channels.telegram.dmPolicy" -Value $Config.telegram.dmPolicy
    }

    if ($null -ne $Config.telegram.allowFrom) {
        Set-OpenClawConfigJson -Path "channels.telegram.allowFrom" -Value @($Config.telegram.allowFrom) -AsArray
    }

    if ($Config.telegram.groupPolicy) {
        Set-OpenClawConfigValue -Path "channels.telegram.groupPolicy" -Value $Config.telegram.groupPolicy
    }

    if ($Config.telegram.execApprovals) {
        $execApprovals = [ordered]@{}
        if ($null -ne $Config.telegram.execApprovals.enabled) {
            $execApprovals.enabled = [bool]$Config.telegram.execApprovals.enabled
        }
        if ($null -ne $Config.telegram.execApprovals.approvers) {
            $execApprovals.approvers = @($Config.telegram.execApprovals.approvers | ForEach-Object { [string]$_ })
        }
        if ($Config.telegram.execApprovals.target) {
            $execApprovals.target = [string]$Config.telegram.execApprovals.target
        }
        if ($null -ne $Config.telegram.execApprovals.agentFilter) {
            $execApprovals.agentFilter = @($Config.telegram.execApprovals.agentFilter | ForEach-Object { [string]$_ })
        }
        if ($null -ne $Config.telegram.execApprovals.sessionFilter) {
            $execApprovals.sessionFilter = @($Config.telegram.execApprovals.sessionFilter | ForEach-Object { [string]$_ })
        }
        Set-OpenClawConfigJson -Path "channels.telegram.execApprovals" -Value $execApprovals
    }

    $configuredGroups = @($Config.telegram.groups)
    if ($configuredGroups.Count -gt 0) {
        $groupsMap = [ordered]@{}
        foreach ($group in $configuredGroups) {
            if (-not $group.id) {
                continue
            }

            $groupEntry = [ordered]@{}
            if ($null -ne $group.requireMention) {
                $groupEntry.requireMention = [bool]$group.requireMention
            }
            if ($null -ne $group.allowFrom) {
                $groupEntry.allowFrom = @($group.allowFrom)
            }
            $groupsMap[$group.id] = $groupEntry
        }

        if ($groupsMap.Count -gt 0) {
            Set-OpenClawConfigJson -Path "channels.telegram.groups" -Value $groupsMap
        }
    }
    elseif ($telegramConfig.groups) {
        Unset-OpenClawConfigPath -Path "channels.telegram.groups"
    }

    Write-Host "Applied trusted Telegram allowlist configuration." -ForegroundColor Green
}

function Configure-VoiceNotes {
    param([Parameter(Mandatory = $true)]$Config)

    if ($null -eq $Config.voiceNotes) {
        return
    }

    if (-not $Config.voiceNotes.enabled) {
        Set-OpenClawConfigValue -Path "tools.media.audio.enabled" -Value "false"
        Write-Host "Voice-note transcription disabled by bootstrap config."
        return
    }

    $audioConfig = [ordered]@{
        enabled = $true
    }

    if ($null -ne $Config.voiceNotes.maxBytes) {
        $audioConfig.maxBytes = [int]$Config.voiceNotes.maxBytes
    }

    if ($null -ne $Config.voiceNotes.echoTranscript) {
        $audioConfig.echoTranscript = [bool]$Config.voiceNotes.echoTranscript
    }

    if ($Config.voiceNotes.language) {
        $audioConfig.language = $Config.voiceNotes.language
    }

    $modelEntries = @()
    if ($Config.voiceNotes.mode -eq "local-whisper") {
        $whisperModel = if ($Config.voiceNotes.whisperModel) {
            [string]$Config.voiceNotes.whisperModel
        }
        else {
            "base"
        }

        $entry = [ordered]@{
            type    = "cli"
            command = "whisper"
            args    = @("--model", $whisperModel, "{{MediaPath}}")
        }
        if ($null -ne $Config.voiceNotes.timeoutSeconds) {
            $entry.timeoutSeconds = [int]$Config.voiceNotes.timeoutSeconds
        }
        $modelEntries += $entry
    }
    elseif ($Config.voiceNotes.provider -and $Config.voiceNotes.model) {
        $modelEntries += [ordered]@{
            provider = $Config.voiceNotes.provider
            model    = $Config.voiceNotes.model
        }
    }

    if ($modelEntries.Count -gt 0) {
        $audioConfig.models = $modelEntries
    }

    Set-OpenClawConfigJson -Path "tools.media.audio" -Value $audioConfig
    Write-Host "Configured voice-note transcription." -ForegroundColor Green
}

function Configure-ToolPolicy {
    param([Parameter(Mandatory = $true)]$Config)

    if ($null -eq $Config.toolPolicy) {
        return
    }

    if ($Config.toolPolicy.globalProfile) {
        Set-OpenClawConfigValue -Path "tools.profile" -Value ([string]$Config.toolPolicy.globalProfile)
    }

    if ($Config.toolPolicy.PSObject.Properties.Name -contains "globalAllow") {
        Unset-OpenClawConfigPath -Path "tools.allow"
        Set-OpenClawConfigJson -Path "tools.alsoAllow" -Value @($Config.toolPolicy.globalAllow) -AsArray
    }
    elseif ($Config.toolPolicy.PSObject.Properties.Name -contains "globalAlsoAllow") {
        Unset-OpenClawConfigPath -Path "tools.allow"
        Set-OpenClawConfigJson -Path "tools.alsoAllow" -Value @($Config.toolPolicy.globalAlsoAllow) -AsArray
    }

    if ($Config.toolPolicy.PSObject.Properties.Name -contains "globalDeny") {
        Set-OpenClawConfigJson -Path "tools.deny" -Value @($Config.toolPolicy.globalDeny) -AsArray
    }

    Write-Host "Configured managed tool policy baseline." -ForegroundColor Green
}

function Sync-ManagedHookDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    if (-not (Test-Path $SourceDir)) {
        throw "Managed hook source directory not found: $SourceDir"
    }

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Get-ChildItem -LiteralPath $SourceDir -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
        $destinationPath = Join-Path $TargetDir $relativePath
        $destinationDir = Split-Path -Parent $destinationPath
        if (-not (Test-Path $destinationDir)) {
            New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Force
    }
}

function Ensure-AgentBootstrapOverlayHook {
    param([Parameter(Mandatory = $true)]$Config)

    if (-not ($Config.PSObject.Properties.Name -contains "managedHooks") -or
        $null -eq $Config.managedHooks -or
        -not ($Config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays") -or
        $null -eq $Config.managedHooks.agentBootstrapOverlays -or
        -not $Config.managedHooks.agentBootstrapOverlays.enabled) {
        return
    }

    $hookName = "agent-bootstrap-overlays"
    $toolkitHookDir = Join-Path (Split-Path -Parent $PSCommandPath) (Join-Path "managed-hooks" $hookName)
    $managedHooksRoot = Join-Path (Get-HostConfigDir -Config $Config) "hooks"
    $managedHookDir = Join-Path $managedHooksRoot $hookName
    Sync-ManagedHookDirectory -SourceDir $toolkitHookDir -TargetDir $managedHookDir

    $hookEntry = [ordered]@{
        enabled = $true
    }
    if ($Config.managedHooks.agentBootstrapOverlays.PSObject.Properties.Name -contains "overlayDirName" -and
        $Config.managedHooks.agentBootstrapOverlays.overlayDirName) {
        $hookEntry.overlayDirName = [string]$Config.managedHooks.agentBootstrapOverlays.overlayDirName
    }

    Set-OpenClawConfigJson -Path "hooks.internal.entries.agent-bootstrap-overlays" -Value $hookEntry
    Write-Host "Configured managed hook: $hookName" -ForegroundColor Green
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$configBaseDir = Split-Path -Parent $ConfigPath
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir $configBaseDir
$managedUpstreamPatches = @(Get-ManagedUpstreamPatches -Config $config -BaseDir $configBaseDir)

Write-Step "Preparing Windows prerequisites"
if ($SkipFullPrerequisiteAudit) {
    & (Join-Path (Split-Path -Parent $PSCommandPath) "ensure-windows-prereqs.ps1") -ConfigPath $ConfigPath -ServicesOnly
}
else {
    & (Join-Path (Split-Path -Parent $PSCommandPath) "ensure-windows-prereqs.ps1") -ConfigPath $ConfigPath
}

Write-Step "Preflight"

foreach ($cmd in @("git", "docker", "tailscale", "curl.exe")) {
    if (-not (Test-CommandExists $cmd)) {
        throw "Missing required command: $cmd"
    }
}

Ensure-RepoPresent -Config $config

if ($managedUpstreamPatches.Count -gt 0) {
    Write-Step "Applying managed OpenClaw source patches"
    Invoke-ApplyManagedUpstreamPatches -RepoPath $config.repoPath -Patches $managedUpstreamPatches -InvokeExternal ${function:Invoke-External} -WriteStatus {
        param([string]$Message)
        Write-Host $Message -ForegroundColor Green
    }
}

if (-not (Test-Path $config.composeFilePath)) {
    throw "Compose file not found: $($config.composeFilePath)"
}

Ensure-EnvFile -Config $config

$hostConfigJson = Join-Path (Get-HostConfigDir -Config $config) "openclaw.json"
if (-not (Test-Path $hostConfigJson)) {
    Write-WarnLine "Host OpenClaw state is not initialized yet at $hostConfigJson."
    Write-WarnLine "Bootstrap can still continue, but you may need dashboard sign-in or other first-run onboarding on this machine."
}

Write-Step "Locking Docker host exposure to localhost"
if ($config.requireLocalhostPublishedPorts) {
    Ensure-LocalhostDockerPorts -ComposePath $config.composeFilePath
}

if ($config.sandbox.enabled) {
    Write-Step "Enabling Docker Desktop sandbox runtime support"
    Ensure-SandboxComposeSupport -ComposePath $config.composeFilePath -SandboxConfig $config.sandbox
    Ensure-GatewayImageSupportsSandbox -Config $config
    Ensure-SandboxImages -Config $config
}

Ensure-LocalWhisperGatewayImage -Config $config

Write-Step "Starting the OpenClaw gateway container"
    Push-Location $config.repoPath
    try {
        $null = Invoke-External -FilePath "docker" -Arguments @("compose", "up", "-d", "--force-recreate", "openclaw-gateway")
    }
    finally {
        Pop-Location
}

Write-Step "Waiting for gateway health"
Wait-ForGateway -HealthUrl $config.verification.healthUrl

Write-Step "Applying security configuration"
Set-OpenClawConfigValue -Path "gateway.bind" -Value $config.gatewayBind
Set-OpenClawConfigValue -Path "gateway.auth.mode" -Value "token"
Set-OpenClawConfigJson -Path "gateway.auth.rateLimit" -Value $config.gatewayAuthRateLimit

if ($config.disableInsecureControlUiAuth) {
Set-OpenClawConfigValue -Path "gateway.controlUi.allowInsecureAuth" -Value "false"
}
Ensure-ControlUiAllowedOrigins -Config $config

Configure-ToolPolicy -Config $config
Ensure-AgentBootstrapOverlayHook -Config $config

Set-OpenClawConfigValue -Path "models.mode" -Value "merge"

$ollamaState = $null
if ($config.ollama.enabled) {
    $ollamaState = Ensure-OllamaState -Config $config
}

$resolvedStrongModelRef = $null
if ($config.multiAgent -and $config.multiAgent.enabled -and $config.multiAgent.strongAgent) {
    $resolvedStrongModelRef = Resolve-StrongModelRef -Config $config -AvailableOllamaRefs $ollamaState.AvailableRefs
}

$resolvedResearchModelRef = $null
if ($config.multiAgent -and $config.multiAgent.enabled -and $config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled) {
    $resolvedResearchModelRef = Resolve-AgentPreferredModelRef -Config $config -AgentConfig $config.multiAgent.researchAgent -AvailableOllamaRefs $ollamaState.AvailableRefs -Purpose "research agent" -FallbackToFirstCandidate
}

$resolvedHostedTelegramModelRef = $null
if ($config.multiAgent -and $config.multiAgent.enabled -and $config.multiAgent.hostedTelegramAgent -and $config.multiAgent.hostedTelegramAgent.enabled) {
    $resolvedHostedTelegramModelRef = Resolve-AgentPreferredModelRef -Config $config -AgentConfig $config.multiAgent.hostedTelegramAgent -AvailableOllamaRefs $ollamaState.AvailableRefs -Purpose "hosted Telegram agent" -FallbackToFirstCandidate
}

$managedModelRefs = Get-ManagedModelRefs -Config $config -ResolvedStrongModelRef $resolvedStrongModelRef -ResolvedResearchModelRef $resolvedResearchModelRef -ResolvedLocalChatModelRef $ollamaState.ResolvedLocalChatModelRef -ResolvedHostedTelegramModelRef $resolvedHostedTelegramModelRef -ResolvedLocalReviewModelRef $ollamaState.ResolvedLocalReviewModelRef -ResolvedLocalCoderModelRef $ollamaState.ResolvedLocalCoderModelRef -ResolvedRemoteReviewModelRef $ollamaState.ResolvedRemoteReviewModelRef -ResolvedRemoteCoderModelRef $ollamaState.ResolvedRemoteCoderModelRef -ExtraRefs $ollamaState.AvailableRefs
if (@($managedModelRefs).Count -gt 0) {
    $modelsAllowlist = [ordered]@{}
    foreach ($modelRef in @($managedModelRefs)) {
        $modelsAllowlist[$modelRef] = [ordered]@{}
    }
    Remove-OpenClawConfigValue -Path "agents.defaults.models"
    Set-OpenClawConfigJson -Path "agents.defaults.models" -Value $modelsAllowlist
    Write-Host "Configured managed model allowlist: $(@($managedModelRefs) -join ', ')" -ForegroundColor Green
}

if ($resolvedStrongModelRef) {
    $strongPrimary = [ordered]@{
        primary   = [string]$resolvedStrongModelRef
        fallbacks = @()
    }
    Set-OpenClawConfigJson -Path "agents.defaults.model" -Value $strongPrimary
    Write-Host "Configured strong default model: $resolvedStrongModelRef" -ForegroundColor Green
}

if ($config.multiAgent -and $config.multiAgent.enabled -and $config.multiAgent.sharedWorkspace -and $config.multiAgent.sharedWorkspace.enabled -and $config.multiAgent.sharedWorkspace.path) {
    Set-OpenClawConfigValue -Path "agents.defaults.workspace" -Value ([string]$config.multiAgent.sharedWorkspace.path)
    Write-Host "Configured shared default agent workspace: $($config.multiAgent.sharedWorkspace.path)" -ForegroundColor Green
}

if ($config.contextManagement) {
    if ($config.contextManagement.compaction) {
        Set-OpenClawConfigJson -Path "agents.defaults.compaction" -Value $config.contextManagement.compaction
        Write-Host "Configured session compaction policy." -ForegroundColor Green
    }

    if ($config.contextManagement.contextPruning) {
        Set-OpenClawConfigJson -Path "agents.defaults.contextPruning" -Value $config.contextManagement.contextPruning
        Write-Host "Configured context pruning policy." -ForegroundColor Green
    }
}

if ($config.ollama.enabled) {
    if ($ollamaState -and $ollamaState.Reachable) {
        foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $config)) {
            if ($ollamaState.ProviderEntries.Contains($endpoint.providerId)) {
                Set-OpenClawConfigJson -Path ("models.providers." + [string]$endpoint.providerId) -Value $ollamaState.ProviderEntries[$endpoint.providerId]
            }
        }
        if ($config.ollama.clearFallbacks) {
            Set-OpenClawConfigJson -Path "agents.defaults.model.fallbacks" -Value @()
        }
        if ($config.ollama.setAsDefaultModel -and @($ollamaState.AvailableRefs).Count -gt 0) {
            $defaultModelId = [string]$ollamaState.AvailableRefs[0]
            $null = Invoke-External -FilePath "docker" -Arguments @(
                "exec", "openclaw-openclaw-gateway-1",
                "node", "dist/index.js",
                "models", "set", $defaultModelId
            )
        }
    }
    else {
        Write-WarnLine "Ollama is not reachable on the Windows host right now. Skipping provider configuration."
    }
}

if ($config.sandbox.enabled) {
    Set-OpenClawConfigValue -Path "agents.defaults.sandbox.mode" -Value $config.sandbox.mode
    Set-OpenClawConfigValue -Path "agents.defaults.sandbox.scope" -Value $config.sandbox.scope
    Set-OpenClawConfigValue -Path "agents.defaults.sandbox.workspaceAccess" -Value $config.sandbox.workspaceAccess
    Set-OpenClawConfigValue -Path "agents.defaults.sandbox.docker.image" -Value $config.sandbox.sandboxImage
    if ($config.sandbox.toolsFsWorkspaceOnly) {
        Set-OpenClawConfigValue -Path "tools.fs.workspaceOnly" -Value "true"
    }
    if ($config.sandbox.applyPatchWorkspaceOnly) {
        Set-OpenClawConfigValue -Path "tools.exec.applyPatch.workspaceOnly" -Value "true"
    }
}

Clear-RedundantNodeDenyCommands -Config $config
Configure-TelegramSurface -Config $config
Configure-VoiceNotes -Config $config
& (Join-Path (Split-Path -Parent $PSCommandPath) "configure-agent-layout.ps1") -ConfigPath $ConfigPath -NoRestart -StrongModelRef $resolvedStrongModelRef -ResearchModelRef $resolvedResearchModelRef -LocalChatModelRef $ollamaState.ResolvedLocalChatModelRef -HostedTelegramModelRef $resolvedHostedTelegramModelRef -LocalReviewModelRef $ollamaState.ResolvedLocalReviewModelRef -LocalCoderModelRef $ollamaState.ResolvedLocalCoderModelRef -RemoteReviewModelRef $ollamaState.ResolvedRemoteReviewModelRef -RemoteCoderModelRef $ollamaState.ResolvedRemoteCoderModelRef

Write-Step "Restarting gateway after config changes"
Push-Location $config.repoPath
try {
    $null = Invoke-External -FilePath "docker" -Arguments @("compose", "restart", "openclaw-gateway")
}
finally {
    Pop-Location
}

Wait-ForGateway -HealthUrl $config.verification.healthUrl

Write-Step "Configuring Tailscale Serve"
Ensure-TailscaleServe -Config $config

Write-Step "Running verification"
& (Join-Path (Split-Path -Parent $PSCommandPath) "verify-openclaw.ps1") -ConfigPath $ConfigPath

if ($config.PSObject.Properties.Name -contains "watchdog" -and $config.watchdog.installScheduledTask) {
    Write-Step "Installing watchdog scheduled task"
    $watchdogArgs = @("-EveryMinutes", [string]$config.watchdog.everyMinutes)
    if ($config.watchdog.restartOnFailure) {
        $watchdogArgs += "-RestartOnFailure"
    }
    if ($config.watchdog.alertOnFailure) {
        $watchdogArgs += "-AlertOnFailure"
    }
    if ($config.watchdog.skipInternetCheck) {
        $watchdogArgs += "-SkipInternetCheck"
    }
    & (Join-Path (Split-Path -Parent $PSCommandPath) "install-watchdog-task.ps1") @watchdogArgs
}

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
Write-Host "Private dashboard: $(tailscale serve status | Select-Object -First 1)"
Write-Host ""
Write-Host "Recommended next commands:" -ForegroundColor Cyan
Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd help"
Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd start"
Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd update"
Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd dashboard"
Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd status"
if ($config.PSObject.Properties.Name -contains "watchdog" -and -not $config.watchdog.installScheduledTask) {
    Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd install-watchdog" -ForegroundColor DarkGray
}
if ($config.multiAgent -and $config.multiAgent.researchAgent -and $config.multiAgent.researchAgent.enabled) {
    $authReadyProviders = Get-AuthReadyHostedProviders
    if ("google" -notin @($authReadyProviders)) {
        Write-Host "  D:\openclaw\openclaw-toolkit\run-openclaw.cmd gemini-auth" -ForegroundColor Yellow
        Write-WarnLine "Gemini is configured as an optional hosted provider, but OpenClaw is not authenticated with Gemini yet."
    }
}


