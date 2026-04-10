[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [string]$StrongModelRef,
    [string]$ResearchModelRef,
    [string]$LocalChatModelRef,
    [string]$HostedTelegramModelRef,
    [string]$LocalReviewModelRef,
    [string]$LocalCoderModelRef,
    [string]$RemoteReviewModelRef,
    [string]$RemoteCoderModelRef,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-gateway-cli-startup.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-openclaw-config.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-toolkit-logging.ps1")

Enable-ToolkitTimestampedOutput
Initialize-ToolkitOpenClawConfigBatch

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "WARNING: $Message" -ForegroundColor Yellow
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

    try {
        $null = $process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdoutTask.Wait()
        $stderrTask.Wait()
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }

    $text = (($stdout, $stderr) | Where-Object { $_ -and $_.Trim().Length -gt 0 }) -join [Environment]::NewLine

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Set-OpenClawConfigJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [switch]$AsArray
    )

    Add-ToolkitOpenClawConfigSetOperation -Path $Path -Value $Value -AsArray:$AsArray
}

function Remove-OpenClawConfigJson {
    param([Parameter(Mandatory = $true)][string]$Path)

    Add-ToolkitOpenClawConfigUnsetOperation -Path $Path
}

function Flush-OpenClawConfigChanges {
    if (-not (Test-ToolkitOpenClawConfigBatchPending)) {
        return
    }

    Write-Host "Writing batched OpenClaw config changes..." -ForegroundColor DarkGray
    $result = Invoke-ToolkitOpenClawConfigBatch -InvokeExternal ${function:Invoke-External} -ContainerName $ContainerName
    if ($result.ExitCode -ne 0) {
        $detail = if ($result.Output) { "`n$($result.Output)" } else { "" }
        throw "Failed to write batched OpenClaw config changes.$detail"
    }
}

function Get-OpenClawConfigDocument {
    $configFile = Join-Path (Get-HostConfigDir -Config $config) "openclaw.json"
    if (-not (Test-Path $configFile)) {
        return $null
    }

    try {
        $raw = (Get-Content -Raw $configFile).Trim()
        if (-not $raw) {
            return $null
        }

        try {
            return $raw | ConvertFrom-Json -Depth 50
        }
        catch {
            $repaired = ($raw -replace '(?:\\r\\n|\\n|\\r)+$', '').Trim()
            if (-not $repaired) {
                return $null
            }

            return $repaired | ConvertFrom-Json -Depth 50
        }
    }
    catch {
        return $null
    }
}

function Get-OpenClawConfigJsonValue {
    param([Parameter(Mandatory = $true)][string]$Path)

    $document = Get-OpenClawConfigDocument
    if ($null -eq $document) {
        return $null
    }

    $current = $document
    foreach ($segment in @($Path -split '\.')) {
        if ($null -eq $current) {
            return $null
        }

        if ($current -is [System.Collections.IList] -and $segment -match '^\d+$') {
            $index = [int]$segment
            if ($index -lt 0 -or $index -ge $current.Count) {
                return $null
            }
            $current = $current[$index]
            continue
        }

        if (-not ($current.PSObject.Properties.Name -contains $segment)) {
            return $null
        }

        $current = $current.$segment
    }

    if ($null -eq $current) {
        return $null
    }

    return $current
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

function Get-AgentCandidateModelRefs {
    param([Parameter(Mandatory = $true)]$AgentConfig)

    $candidateRefs = @()
    foreach ($candidateRef in @($AgentConfig.candidateModelRefs)) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$candidateRef)
    }
    if ($AgentConfig.modelRef) {
        $candidateRefs = Add-UniqueString -List $candidateRefs -Value ([string]$AgentConfig.modelRef)
    }

    return @($candidateRefs)
}

function Resolve-ConfiguredLocalFallbackRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [string]$CandidateRef,
        [string[]]$AvailableOllamaRefs = @()
    )

    $candidateRefText = [string]$CandidateRef
    if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
        return $null
    }

    if (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -and -not $candidateRefText.StartsWith("ollama/")) {
        return $null
    }

    $endpointKey = Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig
    if ([string]::IsNullOrWhiteSpace($endpointKey)) {
        return $null
    }

    if ($candidateRefText.StartsWith("ollama/")) {
        $candidateRefText = Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $candidateRefText -EndpointKey $endpointKey
    }

    if ($candidateRefText -in @($AvailableOllamaRefs)) {
        return $candidateRefText
    }

    return $null
}

function Get-AgentEntryId {
    param($AgentEntry)

    if ($null -eq $AgentEntry) {
        return $null
    }

    if ($AgentEntry -is [System.Collections.IDictionary] -and $AgentEntry.Contains("id")) {
        return [string]$AgentEntry["id"]
    }

    if ($AgentEntry.PSObject.Properties.Name -contains "id" -and $AgentEntry.id) {
        return [string]$AgentEntry.id
    }

    return $null
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

function Ensure-WorkspaceAgentsFile {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$WorkspacePath,
        [string[]]$ContentLines
    )

    if (@($ContentLines).Count -eq 0) {
        return $null
    }

    $hostWorkspacePath = Resolve-HostWorkspacePath -Config $Config -WorkspacePath $WorkspacePath
    if (-not (Test-Path $hostWorkspacePath)) {
        New-Item -ItemType Directory -Force -Path $hostWorkspacePath | Out-Null
    }

    $agentsPath = Join-Path $hostWorkspacePath "AGENTS.md"
    $content = (@($ContentLines) -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine
    $current = if (Test-Path $agentsPath) { Get-Content -Raw $agentsPath } else { $null }
    if ($current -ne $content) {
        Set-Content -Path $agentsPath -Value $content -Encoding UTF8
    }

    return $agentsPath
}

function Ensure-ManagedTextFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$ContentLines
    )

    if (@($ContentLines).Count -eq 0) {
        return $null
    }

    $parentDir = Split-Path -Parent $Path
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    $content = (@($ContentLines) -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine
    $current = if (Test-Path $Path) { Get-Content -Raw $Path } else { $null }
    if ($current -ne $content) {
        Set-Content -Path $Path -Value $content -Encoding UTF8
    }

    return $Path
}

function Remove-ManagedTextFileIfPresent {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Remove-Item -LiteralPath $Path -Force
}

$script:ManagedAgentBootstrapOverlayFiles = @("AGENTS.md", "TOOLS.md", "SOUL.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "MEMORY.md")
$script:ManagedWorkspaceMarkdownFiles = @("AGENTS.md", "TOOLS.md", "SOUL.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "MEMORY.md", "BOOT.md")
$script:ManagedWorkspaceSeedOnceMarkdownFiles = @("BOOTSTRAP.md")

function Get-ToolkitAgentBootstrapTemplateDir {
    param([Parameter(Mandatory = $true)][string]$AgentId)

    return (Join-Path (Join-Path (Join-Path $PSScriptRoot "agents") $AgentId) "bootstrap")
}

function Get-ToolkitWorkspaceMarkdownTemplateDir {
    param([Parameter(Mandatory = $true)][string]$WorkspaceId)

    return (Join-Path (Join-Path (Join-Path $PSScriptRoot "workspaces") $WorkspaceId) "markdown")
}

function Get-ToolkitMarkdownTemplateLibraryDir {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("agents", "workspaces")][string]$Scope,
        [Parameter(Mandatory = $true)][string]$FileName
    )

    $folderName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    return (Join-Path (Join-Path (Join-Path $PSScriptRoot "markdown-templates") $Scope) $folderName)
}

function Get-MarkdownTemplateSelectionKey {
    param(
        [Parameter(Mandatory = $true)]$OwnerConfig,
        [Parameter(Mandatory = $true)][string]$FileName
    )

    if ($null -eq $OwnerConfig -or -not ($OwnerConfig.PSObject.Properties.Name -contains "markdownTemplateKeys")) {
        return $null
    }

    $selectionRoot = $OwnerConfig.markdownTemplateKeys
    if ($null -eq $selectionRoot -or -not ($selectionRoot.PSObject.Properties.Name -contains $FileName)) {
        return $null
    }

    $selectedKey = [string]$selectionRoot.$FileName
    if ([string]::IsNullOrWhiteSpace($selectedKey)) {
        return $null
    }

    return $selectedKey.Trim()
}

function Get-MarkdownTemplateLibraryLines {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("agents", "workspaces")][string]$Scope,
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$TemplateKey
    )

    $libraryDir = Get-ToolkitMarkdownTemplateLibraryDir -Scope $Scope -FileName $FileName
    $templatePath = Join-Path $libraryDir "$TemplateKey.md"
    if (Test-Path -LiteralPath $templatePath) {
        return @(Get-Content -LiteralPath $templatePath)
    }

    return @()
}

function Resolve-EffectiveManagedMarkdownTemplateMap {
    param(
        $OwnerConfig,
        [Parameter(Mandatory = $true)][ValidateSet("agents", "workspaces")][string]$Scope,
        $CustomTemplateMap,
        [string[]]$AllowedFileNames,
        [string]$WorkspacePath,
        [string[]]$SharedWorkspacePaths = @(),
        [switch]$IncludeSharedWorkspaceAccess
    )

    $effectiveTemplateMap = [ordered]@{}
    foreach ($fileName in @($AllowedFileNames)) {
        $selectedTemplateKey = if ($null -ne $OwnerConfig) {
            Get-MarkdownTemplateSelectionKey -OwnerConfig $OwnerConfig -FileName $fileName
        }
        else {
            $null
        }

        if (-not [string]::IsNullOrWhiteSpace([string]$selectedTemplateKey)) {
            $templateLines = @(Get-MarkdownTemplateLibraryLines -Scope $Scope -FileName $fileName -TemplateKey ([string]$selectedTemplateKey))
            if (@($templateLines).Count -gt 0) {
                $resolvedTemplateLines = @(Expand-ManagedMarkdownLines -Lines $templateLines -WorkspacePath $WorkspacePath -SharedWorkspacePaths $SharedWorkspacePaths -IncludeSharedWorkspaceAccess:(($IncludeSharedWorkspaceAccess.IsPresent) -and $fileName -eq "AGENTS.md"))
                $effectiveTemplateMap[$fileName] = @($resolvedTemplateLines)
                continue
            }
        }

        if ($null -ne $CustomTemplateMap -and $CustomTemplateMap.Contains($fileName)) {
            $resolvedCustomLines = @(Expand-ManagedMarkdownLines -Lines @($CustomTemplateMap[$fileName]) -WorkspacePath $WorkspacePath -SharedWorkspacePaths $SharedWorkspacePaths -IncludeSharedWorkspaceAccess:(($IncludeSharedWorkspaceAccess.IsPresent) -and $fileName -eq "AGENTS.md"))
            $effectiveTemplateMap[$fileName] = @($resolvedCustomLines)
        }
    }

    return $effectiveTemplateMap
}

function Get-ManagedMarkdownTemplateMap {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [string[]]$FileNames = $script:ManagedAgentBootstrapOverlayFiles
    )

    $templateMap = [ordered]@{}
    if (-not (Test-Path -LiteralPath $SourceDir)) {
        return $templateMap
    }

    foreach ($fileName in @($FileNames)) {
        $filePath = Join-Path $SourceDir $fileName
        if (-not (Test-Path -LiteralPath $filePath)) {
            continue
        }

        $templateMap[$fileName] = @(Get-Content -LiteralPath $filePath)
    }

    return $templateMap
}

function Ensure-ManagedMarkdownFiles {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir,
        $TemplateMap,
        [string[]]$AllowedFileNames = $script:ManagedAgentBootstrapOverlayFiles
    )

    $writtenPaths = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $TargetDir)) {
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    }

    foreach ($fileName in @($AllowedFileNames)) {
        $targetPath = Join-Path $TargetDir $fileName
        $contentLines = @()
        if ($null -ne $TemplateMap -and $TemplateMap.Contains($fileName)) {
            $contentLines = @($TemplateMap[$fileName])
        }

        $hasMeaningfulContent = @($contentLines | Where-Object { $null -ne $_ }).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace((@($contentLines) -join ""))
        if ($hasMeaningfulContent) {
            $writtenPath = Ensure-ManagedTextFile -Path $targetPath -ContentLines @($contentLines)
            if ($writtenPath) {
                $writtenPaths.Add($writtenPath)
            }
        }
        else {
            Remove-ManagedTextFileIfPresent -Path $targetPath
        }
    }

    return @($writtenPaths.ToArray())
}

function Get-WorkspaceBootstrapStatePath {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    return (Join-Path (Join-Path $TargetDir ".openclaw") "workspace-state.json")
}

function Get-WorkspaceBootstrapState {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    $state = [pscustomobject][ordered]@{
        version           = 1
        bootstrapSeededAt = $null
        setupCompletedAt  = $null
    }

    $statePath = Get-WorkspaceBootstrapStatePath -TargetDir $TargetDir
    if (-not (Test-Path -LiteralPath $statePath)) {
        return $state
    }

    try {
        $rawState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($null -ne $rawState) {
            if ($rawState.PSObject.Properties.Name -contains "version" -and $rawState.version) {
                $state.version = [int]$rawState.version
            }
            if ($rawState.PSObject.Properties.Name -contains "bootstrapSeededAt" -and $rawState.bootstrapSeededAt) {
                $state.bootstrapSeededAt = [string]$rawState.bootstrapSeededAt
            }
            if ($rawState.PSObject.Properties.Name -contains "setupCompletedAt" -and $rawState.setupCompletedAt) {
                $state.setupCompletedAt = [string]$rawState.setupCompletedAt
            }
        }
    }
    catch {
    }

    return $state
}

function Save-WorkspaceBootstrapState {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir,
        [Parameter(Mandatory = $true)]$State
    )

    $statePath = Get-WorkspaceBootstrapStatePath -TargetDir $TargetDir
    $stateDir = Split-Path -Parent $statePath
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    }

    Set-Content -LiteralPath $statePath -Value ($State | ConvertTo-Json -Depth 10) -Encoding UTF8
}

function Update-WorkspaceBootstrapStateFromLiveFiles {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    $state = Get-WorkspaceBootstrapState -TargetDir $TargetDir
    $bootstrapPath = Join-Path $TargetDir "BOOTSTRAP.md"
    $stateChanged = $false
    $nowIso = (Get-Date).ToString("o")

    if ((Test-Path -LiteralPath $bootstrapPath) -and [string]::IsNullOrWhiteSpace([string]$state.bootstrapSeededAt)) {
        $state.bootstrapSeededAt = $nowIso
        $stateChanged = $true
    }

    if (-not (Test-Path -LiteralPath $bootstrapPath) -and
        -not [string]::IsNullOrWhiteSpace([string]$state.bootstrapSeededAt) -and
        [string]::IsNullOrWhiteSpace([string]$state.setupCompletedAt)) {
        $state.setupCompletedAt = $nowIso
        $stateChanged = $true
    }

    if ($stateChanged) {
        Save-WorkspaceBootstrapState -TargetDir $TargetDir -State $state
    }
}

function Test-WorkspaceCanSeedOneTimeMarkdown {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    $state = Get-WorkspaceBootstrapState -TargetDir $TargetDir
    if (-not [string]::IsNullOrWhiteSpace([string]$state.bootstrapSeededAt) -or
        -not [string]::IsNullOrWhiteSpace([string]$state.setupCompletedAt)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $TargetDir)) {
        return $true
    }

    $meaningfulEntries = @(
        Get-ChildItem -LiteralPath $TargetDir -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne ".openclaw" }
    )
    return @($meaningfulEntries).Count -eq 0
}

function Ensure-ManagedSeedOnceMarkdownFiles {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir,
        $TemplateMap,
        [string[]]$AllowedFileNames = $script:ManagedWorkspaceSeedOnceMarkdownFiles
    )

    $writtenPaths = New-Object System.Collections.Generic.List[string]
    $targetDirCanSeed = Test-WorkspaceCanSeedOneTimeMarkdown -TargetDir $TargetDir

    foreach ($fileName in @($AllowedFileNames)) {
        if ($null -eq $TemplateMap -or -not $TemplateMap.Contains($fileName)) {
            continue
        }

        $contentLines = @($TemplateMap[$fileName])
        $hasMeaningfulContent = @($contentLines | Where-Object { $null -ne $_ }).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace((@($contentLines) -join ""))
        if (-not $hasMeaningfulContent) {
            continue
        }

        $targetPath = Join-Path $TargetDir $fileName
        if ((-not (Test-Path -LiteralPath $targetPath)) -and -not $targetDirCanSeed) {
            continue
        }

        $writtenPath = Ensure-ManagedTextFile -Path $targetPath -ContentLines @($contentLines)
        Update-WorkspaceBootstrapStateFromLiveFiles -TargetDir $TargetDir
        if ($writtenPath) {
            $writtenPaths.Add($writtenPath)
        }
    }

    return @($writtenPaths.ToArray())
}

function Get-DefaultPrivateWorkspaceTemplateLines {
    param(
        [Parameter(Mandatory = $true)][string]$WorkspaceName,
        [Parameter(Mandatory = $true)][string]$WorkspacePath,
        [string]$AgentName,
        [string[]]$SharedWorkspacePaths = @()
    )

    $displayAgentName = if ([string]::IsNullOrWhiteSpace($AgentName)) { "one agent" } else { $AgentName }
    $lines = @(
        "# AGENTS.md - $WorkspaceName",
        "",
        "## Workspace Role",
        "- This is a private workspace used by $displayAgentName.",
        "- Keep drafts, scratch work, temporary notes, and agent-specific artifacts here.",
        "- Agent-specific bootstrap markdown files are injected separately from the agent bootstrap folder."
    )

    $accessibleSharedPaths = @($SharedWorkspacePaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($accessibleSharedPaths.Count -eq 1) {
        $lines += @(
            "",
            "## Shared Project Access",
            "- This private workspace lives at ``$WorkspacePath``.",
            "- A shared collaboration workspace also exists at ``$($accessibleSharedPaths[0])``.",
            "- Use the shared workspace for durable repos, collaborative code, and handoff artifacts."
        )
    }
    elseif ($accessibleSharedPaths.Count -gt 1) {
        $lines += @(
            "",
            "## Shared Project Access",
            "- This private workspace lives at ``$WorkspacePath``.",
            "- Shared collaboration workspaces available from here:"
        )
        foreach ($sharedWorkspacePath in $accessibleSharedPaths) {
            $lines += "- ``$sharedWorkspacePath``"
        }
        $lines += "- Use those shared workspaces for durable repos, collaborative code, and handoff artifacts."
    }

    return @($lines)
}

function Get-AgentBootstrapTemplateMap {
    param(
        $AgentConfig,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [string]$WorkspacePath,
        [string[]]$SharedWorkspacePaths = @(),
        [switch]$IncludeSharedWorkspaceAccess
    )

    $customTemplateMap = Get-ManagedMarkdownTemplateMap -SourceDir (Get-ToolkitAgentBootstrapTemplateDir -AgentId $AgentId) -FileNames $script:ManagedAgentBootstrapOverlayFiles
    $templateMap = Resolve-EffectiveManagedMarkdownTemplateMap -OwnerConfig $AgentConfig -Scope "agents" -CustomTemplateMap $customTemplateMap -AllowedFileNames $script:ManagedAgentBootstrapOverlayFiles -WorkspacePath $WorkspacePath -SharedWorkspacePaths $SharedWorkspacePaths -IncludeSharedWorkspaceAccess:$IncludeSharedWorkspaceAccess

    return $templateMap
}

function Get-WorkspaceMarkdownTemplateMap {
    param(
        [Parameter(Mandatory = $true)]$Workspace,
        [Parameter(Mandatory = $true)][string]$WorkspacePath,
        [string]$AgentName,
        [string[]]$SharedWorkspacePaths = @()
    )

    $workspaceId = if ($Workspace.PSObject.Properties.Name -contains "id" -and $Workspace.id) { [string]$Workspace.id } else { $null }
    $customTemplateMap = if ($workspaceId) {
        Get-ManagedMarkdownTemplateMap -SourceDir (Get-ToolkitWorkspaceMarkdownTemplateDir -WorkspaceId $workspaceId) -FileNames @($script:ManagedWorkspaceMarkdownFiles + $script:ManagedWorkspaceSeedOnceMarkdownFiles)
    }
    else {
        [ordered]@{}
    }
    $templateMap = Resolve-EffectiveManagedMarkdownTemplateMap -OwnerConfig $Workspace -Scope "workspaces" -CustomTemplateMap $customTemplateMap -AllowedFileNames @($script:ManagedWorkspaceMarkdownFiles + $script:ManagedWorkspaceSeedOnceMarkdownFiles) -WorkspacePath $WorkspacePath -SharedWorkspacePaths $SharedWorkspacePaths

    if (-not $templateMap.Contains("AGENTS.md")) {
        if (-not ($Workspace.PSObject.Properties.Name -contains "mode" -and [string]$Workspace.mode -eq "shared")) {
            $workspaceName = if ($Workspace.PSObject.Properties.Name -contains "name" -and $Workspace.name) { [string]$Workspace.name } else { "Private Workspace" }
            $templateMap["AGENTS.md"] = @(Get-DefaultPrivateWorkspaceTemplateLines -WorkspaceName $workspaceName -WorkspacePath $WorkspacePath -AgentName $AgentName -SharedWorkspacePaths $SharedWorkspacePaths)
        }
    }

    return $templateMap
}

function Get-AgentBootstrapOverlayDir {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [string]$OverlayDirName = "bootstrap"
    )

    return (Join-Path (Join-Path (Join-Path (Get-HostConfigDir -Config $Config) "agents") $AgentId) $OverlayDirName)
}

function Ensure-AgentBootstrapOverlayFile {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$FileName,
        [string[]]$ContentLines,
        [string]$OverlayDirName = "bootstrap"
    )

    $overlayDir = Get-AgentBootstrapOverlayDir -Config $Config -AgentId $AgentId -OverlayDirName $OverlayDirName
    return (Ensure-ManagedTextFile -Path (Join-Path $overlayDir $FileName) -ContentLines $ContentLines)
}

function Get-AgentOverlayDirName {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "managedHooks" -and
        $Config.managedHooks -and
        $Config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
        $Config.managedHooks.agentBootstrapOverlays -and
        $Config.managedHooks.agentBootstrapOverlays.PSObject.Properties.Name -contains "overlayDirName" -and
        $Config.managedHooks.agentBootstrapOverlays.overlayDirName) {
        return [string]$Config.managedHooks.agentBootstrapOverlays.overlayDirName
    }

    return "bootstrap"
}

function Get-ManagedExtraAgentMarkerPath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [string]$OverlayDirName = "bootstrap"
    )

    return (Join-Path (Get-AgentBootstrapOverlayDir -Config $Config -AgentId $AgentId -OverlayDirName $OverlayDirName) "toolkit-extra-agent.marker")
}

function Get-PreviouslyManagedExtraAgentIds {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$OverlayDirName = "bootstrap"
    )

    $agentsRoot = Join-Path (Get-HostConfigDir -Config $Config) "agents"
    if (-not (Test-Path -LiteralPath $agentsRoot)) {
        return @()
    }

    return @(
        Get-ChildItem -LiteralPath $agentsRoot -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object {
                Test-Path -LiteralPath (Join-Path $_.FullName (Join-Path $OverlayDirName "toolkit-extra-agent.marker"))
            } |
            ForEach-Object { [string]$_.Name }
    )
}

function New-AgentEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Workspace,
        [string]$ModelRef,
        [string[]]$FallbackRefs = @(),
        [bool]$IsDefault = $false,
        $Tools,
        $Sandbox,
        $Subagents,
        [string[]]$Skills
    )

    $entry = [ordered]@{
        id   = $Id
        name = $Name
    }

    if ($Workspace) {
        $entry.workspace = $Workspace
    }
    if ($ModelRef) {
        $entry.model = [ordered]@{
            primary   = $ModelRef
            fallbacks = @(
                foreach ($fallbackRef in @($FallbackRefs)) {
                    if (-not [string]::IsNullOrWhiteSpace([string]$fallbackRef) -and [string]$fallbackRef -ne $ModelRef) {
                        [string]$fallbackRef
                    }
                }
            )
        }
    }
    if ($IsDefault) {
        $entry.default = $true
    }
    if ($null -ne $Tools) {
        $entry.tools = $Tools
    }
    if ($null -ne $Sandbox) {
        $entry.sandbox = $Sandbox
    }
    if ($null -ne $Subagents) {
        $entry.subagents = $Subagents
    }
    if ($null -ne $Skills) {
        $entry.skills = @(
            $Skills |
                ForEach-Object { [string]$_ } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    }

    return $entry
}

function Get-AgentSubagentPolicy {
    param($AgentConfig)

    if ($null -eq $AgentConfig) {
        return $null
    }
    if (-not ($AgentConfig.PSObject.Properties.Name -contains "subagents")) {
        return $null
    }

    $subagents = $AgentConfig.subagents
    if ($null -eq $subagents) {
        return $null
    }

    if ($subagents.PSObject.Properties.Name -contains "enabled" -and -not [bool]$subagents.enabled) {
        return $null
    }

    $entry = [ordered]@{}
    if ($subagents.PSObject.Properties.Name -contains "requireAgentId") {
        $entry.requireAgentId = [bool]$subagents.requireAgentId
    }
    if ($subagents.PSObject.Properties.Name -contains "allowAgents") {
        $entry.allowAgents = @($subagents.allowAgents | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    if ($entry.Count -eq 0) {
        return $null
    }

    return $entry
}

function Get-AgentSkillsOverride {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "skills" -and
        $null -ne $Config.skills -and
        $Config.skills.PSObject.Properties.Name -contains "enableAll" -and
        $null -ne $Config.skills.enableAll -and
        -not [bool]$Config.skills.enableAll) {
        return @()
    }

    return $null
}

function Get-SharedWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config
    )

    $sharedWorkspace = Get-ToolkitPrimarySharedWorkspace -Config $Config
    if ($null -ne $sharedWorkspace) {
        return (Get-ToolkitWorkspacePathValue -Workspace $sharedWorkspace -DefaultPath "/home/node/.openclaw/workspace")
    }

    return $null
}

function Get-DefaultPrivateWorkspacePath {
    param(
        [string]$AgentId
    )

    if ([string]::IsNullOrWhiteSpace($AgentId) -or $AgentId -eq "main") {
        return "/home/node/.openclaw/workspace"
    }

    return "/home/node/.openclaw/workspace-$AgentId"
}

function Get-AgentWorkspaceMode {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    return (Get-ToolkitAgentWorkspaceMode -Config $Config -AgentConfig $AgentConfig)
}

function Test-AgentUsesSharedWorkspace {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    return ((Get-AgentWorkspaceMode -Config $Config -AgentConfig $AgentConfig) -eq "shared")
}

function Get-AgentWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    return (Get-ToolkitAgentWorkspacePath -Config $Config -AgentConfig $AgentConfig)
}

function Get-AgentAccessibleSharedWorkspacePaths {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    return @(
        foreach ($workspace in @(Get-ToolkitAccessibleSharedWorkspaceList -Config $Config -AgentConfig $AgentConfig)) {
            Get-ToolkitWorkspacePathValue -Workspace $workspace -DefaultPath "/home/node/.openclaw/workspace"
        }
    )
}

function Test-AgentCanAccessSharedWorkspace {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    if (Test-AgentUsesSharedWorkspace -Config $Config -AgentConfig $AgentConfig) {
        return $false
    }

    return @(Get-AgentAccessibleSharedWorkspacePaths -Config $Config -AgentConfig $AgentConfig).Count -gt 0
}

function Expand-PolicyTemplateLines {
    param(
        [string[]]$Lines,
        [string]$WorkspacePath,
        [string]$SharedWorkspacePath
    )

    return @(
        foreach ($line in @($Lines)) {
            $expanded = [string]$line
            $expanded = $expanded.Replace("{{WORKSPACE_PATH}}", [string]$WorkspacePath)
            $expanded = $expanded.Replace("{{SHARED_WORKSPACE_PATH}}", [string]$SharedWorkspacePath)
            $expanded
        }
    )
}

function Get-SharedWorkspaceAccessLines {
    param(
        [string]$WorkspacePath,
        [string[]]$SharedWorkspacePaths = @()
    )

    $accessibleSharedPaths = @($SharedWorkspacePaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($accessibleSharedPaths.Count -eq 0) {
        return @()
    }

    $resolvedWorkspacePath = if ($WorkspacePath) { [string]$WorkspacePath } else { "/home/node/.openclaw/workspace" }

    $lines = @(
        "",
        "## Shared Project Access",
        "- Your private home workspace is ``$resolvedWorkspacePath``.",
        "- Use your private workspace for agent-specific notes, drafts, and scratch files.",
        "- Use shared collaboration workspaces for collaborative repos, code, durable project notes, and handoff artifacts."
    )

    if ($accessibleSharedPaths.Count -eq 1) {
        $lines += @(
            "- A shared collaboration workspace also exists at ``$($accessibleSharedPaths[0])``.",
            "- When you need to work in the shared project area, use exact absolute paths there and set exec ``workdir`` to ``$($accessibleSharedPaths[0])`` explicitly."
        )
    }
    else {
        $lines += "- Shared collaboration workspaces available from here:"
        foreach ($sharedWorkspacePath in $accessibleSharedPaths) {
            $lines += "- ``$sharedWorkspacePath``"
        }
        $lines += "- When you need to work in a shared project area, use exact absolute paths there and set exec ``workdir`` to the specific shared workspace path explicitly."
    }

    return @($lines)
}

function Expand-ManagedMarkdownLines {
    param(
        [string[]]$Lines,
        [string]$WorkspacePath,
        [string[]]$SharedWorkspacePaths = @(),
        [switch]$IncludeSharedWorkspaceAccess
    )

    $resolvedSharedWorkspacePaths = @($SharedWorkspacePaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $primarySharedWorkspacePath = if ($resolvedSharedWorkspacePaths.Count -gt 0) { [string]$resolvedSharedWorkspacePaths[0] } else { "" }
    $lines = @(Expand-PolicyTemplateLines -Lines $Lines -WorkspacePath $WorkspacePath -SharedWorkspacePath $primarySharedWorkspacePath)

    if ($IncludeSharedWorkspaceAccess) {
        $lines += @(Get-SharedWorkspaceAccessLines -WorkspacePath $WorkspacePath -SharedWorkspacePaths $resolvedSharedWorkspacePaths)
    }

    return @($lines)
}

function Get-ManagedAgentConfigRecord {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AgentId
    )

    $agentConfig = Get-ToolkitAgentById -Config $Config -AgentId $AgentId
    if ($null -ne $agentConfig) {
        return [pscustomobject]@{
            AgentConfig = $agentConfig
        }
    }

    return $null
}

function Get-EnabledExtraAgents {
    param(
        [Parameter(Mandatory = $true)]$Config
    )

    $managedKeys = @(
        "strongAgent",
        "researchAgent",
        "localChatAgent",
        "hostedTelegramAgent",
        "localReviewAgent",
        "localCoderAgent",
        "remoteReviewAgent",
        "remoteCoderAgent"
    )

    return @(
        foreach ($agent in @(Get-ToolkitAgentList -Config $Config)) {
            if ($null -eq $agent) {
                continue
            }

            if (-not ($agent.PSObject.Properties.Name -contains "id") -or [string]::IsNullOrWhiteSpace([string]$agent.id)) {
                continue
            }

            $agentKey = if ($agent.PSObject.Properties.Name -contains "key" -and $agent.key) {
                [string]$agent.key
            }
            else {
                ""
            }
            if (-not [string]::IsNullOrWhiteSpace($agentKey) -and $agentKey -in $managedKeys) {
                continue
            }

            if (Test-ToolkitAgentEnabled -AgentConfig $agent) {
                $agent
            }
        }
    )
}

function Get-ToolkitToolsetByKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Key
    )

    if (-not ($Config.PSObject.Properties.Name -contains "toolsets") -or
        $null -eq $Config.toolsets -or
        -not ($Config.toolsets.PSObject.Properties.Name -contains "list") -or
        $null -eq $Config.toolsets.list) {
        return $null
    }

    foreach ($toolset in @($Config.toolsets.list)) {
        if ($null -eq $toolset -or -not ($toolset.PSObject.Properties.Name -contains "key")) {
            continue
        }
        if ([string]$toolset.key -eq $Key) {
            return $toolset
        }
    }

    return $null
}

function Get-AgentToolsetKeys {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $keys = New-Object System.Collections.Generic.List[string]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($candidateKey in @("minimal")) {
        if ($seen.Add($candidateKey) -and $null -ne (Get-ToolkitToolsetByKey -Config $Config -Key $candidateKey)) {
            $keys.Add($candidateKey)
        }
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "toolsetKeys" -and $null -ne $AgentConfig.toolsetKeys) {
        foreach ($rawKey in @($AgentConfig.toolsetKeys)) {
            $key = ([string]$rawKey).Trim()
            if ([string]::IsNullOrWhiteSpace($key) -or -not $seen.Add($key)) {
                continue
            }
            if ($null -eq (Get-ToolkitToolsetByKey -Config $Config -Key $key)) {
                continue
            }
            $keys.Add($key)
        }
    }

    return @($keys.ToArray())
}

function Resolve-AgentToolsetToolsOverride {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $appliedToolsetKeys = @(Get-AgentToolsetKeys -Config $Config -AgentConfig $AgentConfig)
    $toolStates = [ordered]@{}
    foreach ($toolsetKey in @($appliedToolsetKeys)) {
        $toolset = Get-ToolkitToolsetByKey -Config $Config -Key $toolsetKey
        if ($null -eq $toolset) {
            continue
        }

        $allowSource = if ($toolset.PSObject.Properties.Name -contains "allow") { $toolset.allow } else { @() }
        $denySource = if ($toolset.PSObject.Properties.Name -contains "deny") { $toolset.deny } else { @() }
        foreach ($toolName in @(Normalize-ToolkitToolNameList -ToolNames $allowSource)) {
            $toolStates[$toolName] = "allow"
        }
        foreach ($toolName in @(Normalize-ToolkitToolNameList -ToolNames $denySource)) {
            $toolStates[$toolName] = "deny"
        }
    }

    $directToolOverrides = $null
    if ($AgentConfig.PSObject.Properties.Name -contains "toolOverrides" -and $null -ne $AgentConfig.toolOverrides) {
        $directToolOverrides = $AgentConfig.toolOverrides
        $overrideAllow = if ($directToolOverrides.PSObject.Properties.Name -contains "allow") { $directToolOverrides.allow } else { @() }
        $overrideDeny = if ($directToolOverrides.PSObject.Properties.Name -contains "deny") { $directToolOverrides.deny } else { @() }
        foreach ($toolName in @(Normalize-ToolkitToolNameList -ToolNames $overrideAllow)) {
            $toolStates[$toolName] = "allow"
        }
        foreach ($toolName in @(Normalize-ToolkitToolNameList -ToolNames $overrideDeny)) {
            $toolStates[$toolName] = "deny"
        }
    }

    $hasDirectOverrides = $null -ne $directToolOverrides -and (
        ($directToolOverrides.PSObject.Properties.Name -contains "allow" -and @($directToolOverrides.allow).Count -gt 0) -or
        ($directToolOverrides.PSObject.Properties.Name -contains "deny" -and @($directToolOverrides.deny).Count -gt 0)
    )
    if (@($appliedToolsetKeys).Count -eq 0 -and -not $hasDirectOverrides -and $toolStates.Count -eq 0) {
        return $null
    }

    $allow = New-Object System.Collections.Generic.List[string]
    $deny = New-Object System.Collections.Generic.List[string]
    foreach ($toolName in @($toolStates.Keys)) {
        switch ($toolStates[$toolName]) {
            "allow" { $allow.Add($toolName) }
            "deny" { $deny.Add($toolName) }
        }
    }

    $resolved = [ordered]@{}
    if ($allow.Count -gt 0) {
        $resolved.allow = @($allow.ToArray())
    }
    else {
        $resolved.deny = @("*")
    }

    if ($deny.Count -gt 0 -and $allow.Count -gt 0) {
        $resolved.deny = @($deny.ToArray())
    }

    return $resolved
}

function Merge-AgentToolsOverride {
    param(
        $BaseTools,
        $ExplicitTools
    )

    if ($null -eq $BaseTools) {
        return $ExplicitTools
    }
    if ($null -eq $ExplicitTools) {
        return $BaseTools
    }

    $merged = [ordered]@{}
    foreach ($propertyName in @($BaseTools.PSObject.Properties.Name)) {
        $merged[$propertyName] = $BaseTools.$propertyName
    }
    foreach ($propertyName in @($ExplicitTools.PSObject.Properties.Name)) {
        $merged[$propertyName] = $ExplicitTools.$propertyName
    }

    return $merged
}

function Get-AgentToolsOverride {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    $toolsetOverride = Resolve-AgentToolsetToolsOverride -Config $Config -AgentConfig $AgentConfig
    $explicitOverride = if ($AgentConfig.PSObject.Properties.Name -contains "tools" -and $null -ne $AgentConfig.tools) {
        $AgentConfig.tools
    }
    else {
        $null
    }

    return (Merge-AgentToolsOverride -BaseTools $toolsetOverride -ExplicitTools $explicitOverride)
}

function Get-AgentSandboxOverride {
    param(
        [Parameter(Mandatory = $true)]$AgentConfig
    )

    if ($AgentConfig.PSObject.Properties.Name -contains "sandbox" -and $null -ne $AgentConfig.sandbox) {
        return $AgentConfig.sandbox
    }

    if ($AgentConfig.PSObject.Properties.Name -contains "sandboxMode" -and $AgentConfig.sandboxMode) {
        return [ordered]@{
            mode = [string]$AgentConfig.sandboxMode
        }
    }

    return $null
}

function Add-DesiredAgentFromConfig {
    param(
        [object[]]$DesiredAgents = @(),
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [string]$ModelOverrideRef,
        [bool]$IsDefault = $false
    )

    if (-not (Test-ToolkitAgentAssigned -Config $Config -AgentConfig $AgentConfig)) {
        return @($DesiredAgents)
    }

    $agentId = [string]$AgentConfig.id
    $agentName = if ($AgentConfig.PSObject.Properties.Name -contains "name" -and $AgentConfig.name) { [string]$AgentConfig.name } else { $agentId }
    $useAvailableRefsOnly = $false
    if (-not [string]::IsNullOrWhiteSpace($ModelOverrideRef)) {
        $resolvedModelRef = [string]$ModelOverrideRef
        $useAvailableRefsOnly = $true
    }
    else {
        $resolvedModelRef = Resolve-PreferredAgentModelRef -ExplicitRef $ModelOverrideRef -AgentConfig $AgentConfig -Config $Config -Purpose $agentId
    }
    $resolvedFallbackRefs = Resolve-AgentFallbackModelRefs -Config $Config -AgentConfig $AgentConfig -PrimaryModelRef $resolvedModelRef -Purpose $agentId -UseAvailableRefsOnly:$useAvailableRefsOnly
    $workspacePath = Get-AgentWorkspacePath -Config $Config -AgentConfig $AgentConfig
    $toolsOverride = Get-AgentToolsOverride -Config $Config -AgentConfig $AgentConfig
    $sandboxOverride = Get-AgentSandboxOverride -AgentConfig $AgentConfig
    $subagentPolicy = Get-AgentSubagentPolicy -AgentConfig $AgentConfig
    $skillsOverride = Get-AgentSkillsOverride -Config $Config

    $entry = New-AgentEntry -Id $agentId -Name $agentName -Workspace $workspacePath -ModelRef $resolvedModelRef -FallbackRefs $resolvedFallbackRefs -IsDefault $IsDefault -Tools $toolsOverride -Sandbox $sandboxOverride -Subagents $subagentPolicy -Skills $skillsOverride
    return @(@($DesiredAgents) + $entry)
}

function Merge-AgentEntry {
    param(
        [Parameter(Mandatory = $true)]$Existing,
        [Parameter(Mandatory = $true)]$Desired
    )

    $merged = [ordered]@{}

    foreach ($prop in $Existing.PSObject.Properties.Name) {
        $merged[$prop] = $Existing.$prop
    }

    foreach ($prop in $Desired.Keys) {
        $merged[$prop] = $Desired[$prop]
    }

    # Managed agent fields should be removable when the desired entry omits them.
    # This lets config toggles like subagents.enabled=false clear stale live state.
    $managedOptionalProps = @(
        "model",
        "tools",
        "sandbox",
        "subagents",
        "skills"
    )
    foreach ($prop in $managedOptionalProps) {
        if (($Existing.PSObject.Properties.Name -contains $prop) -and -not ($Desired.Keys -contains $prop)) {
            $merged.Remove($prop) | Out-Null
        }
    }

    return $merged
}

function Add-BindingIfMissing {
    param(
        [object[]]$Bindings = @(),
        [Parameter(Mandatory = $true)]$Binding
    )

    $items = @(@($Bindings) | Where-Object { $null -ne $_ })
    $targetJson = $Binding | ConvertTo-Json -Depth 50 -Compress
    foreach ($existing in $items) {
        if (($existing | ConvertTo-Json -Depth 50 -Compress) -eq $targetJson) {
            return $items
        }
    }

    $result = @($items)
    $result += ,$Binding
    return $result
}

function Remove-TelegramManagedBindings {
    param(
        [object[]]$Bindings = @(),
        [object[]]$ManagedBindingSpecs = @(),
        [string]$DefaultAccountId = "default"
    )

    $result = @()
    foreach ($binding in @($Bindings)) {
        if ($null -eq $binding) {
            continue
        }

        $isManagedTelegramBinding = $false
        if ($binding.match.channel -eq "telegram" -and $null -ne $binding.match.peer) {
            $bindingAccountId = if ($binding.match.PSObject.Properties.Name -contains "accountId" -and -not [string]::IsNullOrWhiteSpace([string]$binding.match.accountId)) {
                [string]$binding.match.accountId
            }
            else {
                $DefaultAccountId
            }

            foreach ($bindingSpec in @($ManagedBindingSpecs)) {
                if ($null -eq $bindingSpec) {
                    continue
                }

                if ([string]$bindingSpec.accountId -ne $bindingAccountId) {
                    continue
                }

                if ([string]$binding.match.peer.kind -eq [string]$bindingSpec.peerKind -and [string]$binding.match.peer.id -eq [string]$bindingSpec.peerId) {
                    $isManagedTelegramBinding = $true
                    break
                }
            }
        }

        if (-not $isManagedTelegramBinding) {
            $result += ,$binding
        }
    }

    return $result
}

function Get-OllamaAvailableModelRefs {
    param([Parameter(Mandatory = $true)]$Config)

    if ($script:ToolkitOllamaAvailableRefsCacheValid) {
        return @($script:ToolkitOllamaAvailableRefsCache)
    }

    $refs = @()
    foreach ($endpoint in @(Get-ToolkitOllamaEndpoints -Config $Config)) {
        if (-not (Test-ToolkitOllamaEndpointReachable -Endpoint $endpoint -TimeoutSeconds 5)) {
            Write-WarnLine "Skipping local model refresh for endpoint '$($endpoint.key)' because it is not reachable."
            continue
        }

        $url = (Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint).TrimEnd("/") + "/api/tags"
        $result = Invoke-External -FilePath "curl.exe" -Arguments @("-s", "--connect-timeout", "5", "--max-time", "10", $url) -AllowFailure
        if ($result.ExitCode -ne 0 -or -not $result.Output) {
            continue
        }

        try {
            $parsed = $result.Output | ConvertFrom-Json -Depth 20
        }
        catch {
            continue
        }

        foreach ($model in @($parsed.models)) {
            if ($model.model) {
                $refs = Add-UniqueString -List $refs -Value (Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.model) -EndpointKey ([string]$endpoint.key))
            }
        }
    }

    $script:ToolkitOllamaAvailableRefsCache = @($refs)
    $script:ToolkitOllamaAvailableRefsCacheValid = $true
    return @($script:ToolkitOllamaAvailableRefsCache)
}

function Try-PullOllamaModel {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string]$ModelId
    )

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        return $false
    }

    if (-not (Test-ToolkitOllamaEndpointReachable -Endpoint $Endpoint -TimeoutSeconds 5)) {
        Write-WarnLine "Skipping pull of '$ModelId' on endpoint '$($Endpoint.key)' because the endpoint is not reachable."
        return $false
    }

    Write-Host "Ollama model missing on endpoint $($Endpoint.key), pulling: $ModelId" -ForegroundColor Yellow
    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        $pull = Invoke-External -FilePath $ollamaCommand.Source -Arguments @("pull", $ModelId) -AllowFailure
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }
    if ($pull.ExitCode -eq 0) {
        $script:ToolkitOllamaAvailableRefsCacheValid = $false
        return $true
    }

    return $false
}

function Get-AgentOllamaEndpointKey {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AgentConfig
    )

    $resolvedEndpointKey = Get-ToolkitAgentEndpointKey -Config $Config -AgentConfig $AgentConfig
    if (-not [string]::IsNullOrWhiteSpace($resolvedEndpointKey)) {
        return $resolvedEndpointKey
    }

    return $null
}

function Resolve-OllamaModelRef {
    param(
        [string]$DesiredRef,
        [Parameter(Mandatory = $true)]$Config,
        [string]$Purpose,
        [string]$EndpointKey
    )

    if ([string]::IsNullOrWhiteSpace($DesiredRef) -or (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $DesiredRef) -and -not $DesiredRef.StartsWith("ollama/"))) {
        return $DesiredRef
    }

    $endpoint = Get-ToolkitOllamaEndpoint -Config $Config -EndpointKey $EndpointKey
    $desiredResolvedRef = Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $DesiredRef -EndpointKey $EndpointKey
    $availableRefs = Get-OllamaAvailableModelRefs -Config $Config
    if ($desiredResolvedRef -in $availableRefs) {
        return $desiredResolvedRef
    }

    $desiredModelId = Get-ToolkitModelIdFromRef -ModelRef $DesiredRef
    $shouldAttemptPull = $true
    if ($null -eq $endpoint) {
        $shouldAttemptPull = $false
    }
    elseif ($endpoint.PSObject.Properties.Name -contains "autoPullMissingModels" -and
        -not [bool]$endpoint.autoPullMissingModels) {
        $shouldAttemptPull = $false
        Write-WarnLine "Skipping pull of '$desiredModelId' on endpoint '$($endpoint.key)' because autoPullMissingModels is disabled."
    }
    elseif (-not (Test-ToolkitOllamaEndpointReachable -Endpoint $endpoint -TimeoutSeconds 5)) {
        $shouldAttemptPull = $false
        Write-WarnLine "Skipping pull of '$desiredModelId' on endpoint '$($endpoint.key)' because the endpoint is not reachable."
    }

    if ($shouldAttemptPull -and $null -ne $endpoint) {
        $pullBudgetFraction = Get-ToolkitOllamaPullVramBudgetFraction -Config $Config
        $pullBudgetPercent = [int][math]::Round($pullBudgetFraction * 100)
        $vramBudgetMiB = Get-ToolkitEndpointVramBudgetMiB -Endpoint $endpoint -Config $Config
        if ($null -ne $vramBudgetMiB) {
            $estimateMiB = Get-ToolkitLocalModelPullEstimateMiB -Config $Config -ModelId $desiredModelId -EndpointKey $EndpointKey
            if ($null -ne $estimateMiB -and $estimateMiB -gt $vramBudgetMiB) {
                $gpuTotalMiB = [int][math]::Round($vramBudgetMiB / $pullBudgetFraction)
                Write-WarnLine "Skipping pull of '$desiredModelId' on endpoint '$($endpoint.key)': $estimateMiB MiB exceeds VRAM budget of $vramBudgetMiB MiB ($pullBudgetPercent% of $gpuTotalMiB MiB total)."
                $shouldAttemptPull = $false
            }
        }
    }

    $pulled = $false
    if ($shouldAttemptPull) {
        $pulled = Try-PullOllamaModel -Endpoint $endpoint -ModelId $desiredModelId
    }
    if ($pulled) {
        $availableRefs = Get-OllamaAvailableModelRefs -Config $Config
        if ($desiredResolvedRef -in $availableRefs) {
            return $desiredResolvedRef
        }
    }

    foreach ($model in @(Get-ToolkitEndpointModelCatalog -Config $Config -EndpointKey $EndpointKey)) {
        if ($model.id) {
            $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $EndpointKey
            if ($candidate -in $availableRefs) {
                Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $candidate." -ForegroundColor Yellow
                return $candidate
            }
        }
    }

    if ($availableRefs.Count -gt 0) {
        Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable. Falling back to $($availableRefs[0])." -ForegroundColor Yellow
        return [string]$availableRefs[0]
    }

    Write-Host "Preferred $Purpose model $desiredResolvedRef is unavailable and no local Ollama fallback is present." -ForegroundColor Yellow
    return $desiredResolvedRef
}

function Get-AuthReadyHostedProviders {
    if ($script:ToolkitHostedAuthReadyProvidersLoaded) {
        return @($script:ToolkitHostedAuthReadyProviders)
    }

    $providers = @()
    $liveConfig = Get-OpenClawConfigDocument
    if ($null -ne $liveConfig -and
        $liveConfig.PSObject.Properties.Name -contains "auth" -and
        $null -ne $liveConfig.auth -and
        $liveConfig.auth.PSObject.Properties.Name -contains "profiles" -and
        $null -ne $liveConfig.auth.profiles) {
        foreach ($profile in @($liveConfig.auth.profiles.PSObject.Properties.Value)) {
            if ($profile -and $profile.provider -and [string]$profile.provider -ne "ollama") {
                $providers = Add-UniqueString -List $providers -Value ([string]$profile.provider)
            }
        }
    }

    $script:ToolkitHostedAuthReadyProviders = @($providers)
    $script:ToolkitHostedAuthReadyProvidersLoaded = $true
    return @($script:ToolkitHostedAuthReadyProviders)
}

function Resolve-UsableLocalModelCandidate {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [Parameter(Mandatory = $true)][string]$Purpose,
        [string[]]$CandidateRefs = @(),
        [string[]]$AvailableOllamaRefs = @()
    )

    $endpointKey = Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig
    foreach ($candidateRef in @($CandidateRefs)) {
        $candidateRefText = [string]$candidateRef
        if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
            continue
        }
        if (-not (Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -and -not $candidateRefText.StartsWith("ollama/")) {
            continue
        }

        $resolvedLocalRef = Resolve-OllamaModelRef -DesiredRef $candidateRefText -Config $Config -Purpose $Purpose -EndpointKey $endpointKey
        if (-not [string]::IsNullOrWhiteSpace($resolvedLocalRef) -and $resolvedLocalRef -in @($AvailableOllamaRefs)) {
            return $resolvedLocalRef
        }
    }

    return $null
}

function Resolve-PreferredAgentModelRef {
    param(
        [string]$ExplicitRef,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Purpose
    )

    $modelSource = Get-ToolkitAgentModelPreference -Config $Config -AgentConfig $AgentConfig

    if (-not [string]::IsNullOrWhiteSpace($ExplicitRef)) {
        if ($modelSource -eq "local" -and ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $ExplicitRef) -or $ExplicitRef.StartsWith("ollama/"))) {
            $resolvedExplicitLocalRef = Resolve-UsableLocalModelCandidate -Config $Config -AgentConfig $AgentConfig -Purpose $Purpose -CandidateRefs @($ExplicitRef) -AvailableOllamaRefs (Get-OllamaAvailableModelRefs -Config $Config)
            if (-not [string]::IsNullOrWhiteSpace($resolvedExplicitLocalRef)) {
                return $resolvedExplicitLocalRef
            }
        }
        return $ExplicitRef
    }

    $candidateRefs = @(Get-AgentCandidateModelRefs -AgentConfig $AgentConfig)

    if ($modelSource -eq "hosted") {
        $allowLocalFallback = [bool]($AgentConfig.PSObject.Properties.Name -contains "allowLocalFallback" -and $AgentConfig.allowLocalFallback)
        $hostedCandidateRefs = @(
            foreach ($candidateRef in @($candidateRefs)) {
                $candidateRefText = [string]$candidateRef
                if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                    continue
                }
                if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                    continue
                }

                $candidateRefText
            }
        )
        if (-not $allowLocalFallback -and @($hostedCandidateRefs).Count -le 1) {
            foreach ($candidateRef in @($hostedCandidateRefs)) {
                return [string]$candidateRef
            }
        }

        $authReadyProviders = Get-AuthReadyHostedProviders
        foreach ($candidateRef in @($candidateRefs)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRef) -or $candidateRef.StartsWith("ollama/")) {
                continue
            }

            $providerId = ($candidateRef -split "/", 2)[0]
            if ($providerId -in @($authReadyProviders)) {
                return $candidateRef
            }
        }

        foreach ($candidateRef in @($candidateRefs)) {
            if (-not $candidateRef.StartsWith("ollama/")) {
                return $candidateRef
            }
        }
    }

    if ($modelSource -eq "local") {
        $resolvedLocalCandidate = Resolve-UsableLocalModelCandidate -Config $Config -AgentConfig $AgentConfig -Purpose $Purpose -CandidateRefs $candidateRefs -AvailableOllamaRefs (Get-OllamaAvailableModelRefs -Config $Config)
        if (-not [string]::IsNullOrWhiteSpace($resolvedLocalCandidate)) {
            return $resolvedLocalCandidate
        }
    }

    foreach ($candidateRef in @($candidateRefs)) {
        return $candidateRef
    }

    return $null
}

function Get-PreferredLocalFallbackRef {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string[]]$AvailableRefs = @()
    )

    $defaultEndpoint = Get-ToolkitDefaultOllamaEndpoint -Config $Config
    $defaultEndpointKey = if ($null -ne $defaultEndpoint) { [string]$defaultEndpoint.key } else { "local" }
    foreach ($model in @(Get-ToolkitEndpointModelCatalog -Config $Config -EndpointKey $defaultEndpointKey)) {
        if (-not $model.id) {
            continue
        }

        $candidate = Convert-ToolkitLocalModelIdToRef -Config $Config -ModelId ([string]$model.id) -EndpointKey $defaultEndpointKey
        if ($candidate -in @($AvailableRefs)) {
            return $candidate
        }
    }

    if (@($AvailableRefs).Count -gt 0) {
        return [string]$AvailableRefs[0]
    }

    return $null
}

function Resolve-AgentFallbackModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$AgentConfig,
        [string]$PrimaryModelRef,
        [Parameter(Mandatory = $true)][string]$Purpose,
        [switch]$UseAvailableRefsOnly
    )

    if ([string]::IsNullOrWhiteSpace($PrimaryModelRef)) {
        return @()
    }

    $availableOllamaRefs = @(Get-OllamaAvailableModelRefs -Config $Config)
    $candidateRefs = @(Get-AgentCandidateModelRefs -AgentConfig $AgentConfig)

    $modelSource = Get-ToolkitAgentModelPreference -Config $Config -AgentConfig $AgentConfig
    $endpointSpecificFallbackRefs = @(Resolve-ToolkitEndpointModelFallbackRefs -Config $Config -AgentConfig $AgentConfig -ModelRef $PrimaryModelRef -AvailableOllamaRefs $availableOllamaRefs -UseAvailableRefsOnly:$UseAvailableRefsOnly)

    $fallbacks = @()
    if ($modelSource -eq "hosted") {
        $allowLocalFallback = [bool]($AgentConfig.PSObject.Properties.Name -contains "allowLocalFallback" -and $AgentConfig.allowLocalFallback)
        $hostedFallbackCandidates = @(
            foreach ($candidateRef in @($candidateRefs)) {
                $candidateRefText = [string]$candidateRef
                if ([string]::IsNullOrWhiteSpace($candidateRefText) -or $candidateRefText -eq $PrimaryModelRef) {
                    continue
                }
                if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                    continue
                }

                $candidateRefText
            }
        )
        if (-not $UseAvailableRefsOnly -and -not $allowLocalFallback -and @($hostedFallbackCandidates).Count -eq 0) {
            return @()
        }

        if ($UseAvailableRefsOnly) {
            foreach ($candidateRefText in @($hostedFallbackCandidates)) {
                $fallbacks = Add-UniqueString -List $fallbacks -Value $candidateRefText
            }
        }
        else {
            $authReadyProviders = Get-AuthReadyHostedProviders
            foreach ($candidateRefText in @($hostedFallbackCandidates)) {
                $providerId = ($candidateRefText -split "/", 2)[0]
                if ($providerId -in @($authReadyProviders)) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value $candidateRefText
                }
            }
        }

        if ($allowLocalFallback) {
            foreach ($fallbackRef in @($endpointSpecificFallbackRefs)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$fallbackRef) -and [string]$fallbackRef -ne $PrimaryModelRef) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value ([string]$fallbackRef)
                }
            }

            foreach ($candidateRef in @($candidateRefs)) {
                $candidateRefText = [string]$candidateRef
                if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                    continue
                }

                if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                    if ($UseAvailableRefsOnly) {
                        $resolvedLocalFallback = Resolve-ConfiguredLocalFallbackRef -Config $Config -AgentConfig $AgentConfig -CandidateRef $candidateRefText -AvailableOllamaRefs $availableOllamaRefs
                    }
                    else {
                        $resolvedLocalFallback = Resolve-OllamaModelRef -DesiredRef $candidateRefText -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig)
                    }
                    if (-not [string]::IsNullOrWhiteSpace($resolvedLocalFallback) -and $resolvedLocalFallback -ne $PrimaryModelRef -and $resolvedLocalFallback -in @($availableOllamaRefs)) {
                        $fallbacks = Add-UniqueString -List $fallbacks -Value $resolvedLocalFallback
                    }
                }
            }

            if (@($fallbacks).Count -eq 0 -or -not (@($fallbacks) | Where-Object { $_ -like "ollama*" })) {
                $preferredLocalFallback = Get-PreferredLocalFallbackRef -Config $Config -AvailableRefs $availableOllamaRefs
                if (-not [string]::IsNullOrWhiteSpace($preferredLocalFallback) -and $preferredLocalFallback -ne $PrimaryModelRef) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value $preferredLocalFallback
                }
            }
        }
    }
    elseif ($modelSource -eq "local") {
        foreach ($fallbackRef in @($endpointSpecificFallbackRefs)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$fallbackRef) -and [string]$fallbackRef -ne $PrimaryModelRef) {
                $fallbacks = Add-UniqueString -List $fallbacks -Value ([string]$fallbackRef)
            }
        }

        foreach ($candidateRef in @($candidateRefs)) {
            $candidateRefText = [string]$candidateRef
            if ([string]::IsNullOrWhiteSpace($candidateRefText)) {
                continue
            }

            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $candidateRefText) -or $candidateRefText.StartsWith("ollama/")) {
                if ($UseAvailableRefsOnly) {
                    $resolvedLocalFallback = Resolve-ConfiguredLocalFallbackRef -Config $Config -AgentConfig $AgentConfig -CandidateRef $candidateRefText -AvailableOllamaRefs $availableOllamaRefs
                }
                else {
                    $resolvedLocalFallback = Resolve-OllamaModelRef -DesiredRef $candidateRefText -Config $Config -Purpose $Purpose -EndpointKey (Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig)
                }
                if (-not [string]::IsNullOrWhiteSpace($resolvedLocalFallback) -and $resolvedLocalFallback -ne $PrimaryModelRef -and $resolvedLocalFallback -in @($availableOllamaRefs)) {
                    $fallbacks = Add-UniqueString -List $fallbacks -Value $resolvedLocalFallback
                }
            }
        }
    }

    return @($fallbacks)
}

function Wait-ForGateway {
    param(
        [string]$HealthUrl = "http://127.0.0.1:18789/healthz",
        [int]$MaxAttempts = 45,
        [int]$DelaySeconds = 2
    )

    $lastOutput = ""
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        $health = Invoke-External -FilePath "curl.exe" -Arguments @("-s", $HealthUrl) -AllowFailure
        if ($health.ExitCode -eq 0 -and $health.Output -match '"ok"\s*:\s*true') {
            return
        }

        if (-not [string]::IsNullOrWhiteSpace($health.Output)) {
            $lastOutput = $health.Output.Trim()
        }
        Start-Sleep -Seconds $DelaySeconds
    }

    $detail = if ([string]::IsNullOrWhiteSpace($lastOutput)) { "" } else { "`nLast health response/output: $lastOutput" }
    throw "Gateway did not become healthy after restart at $HealthUrl after $($MaxAttempts * $DelaySeconds)s.$detail"
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$strongAgent = Get-ToolkitAgentByKey -Config $config -Key "strongAgent"
$researchAgent = Get-ToolkitAgentByKey -Config $config -Key "researchAgent"
$localChatAgent = Get-ToolkitAgentByKey -Config $config -Key "localChatAgent"
$localReviewAgent = Get-ToolkitAgentByKey -Config $config -Key "localReviewAgent"
$hostedTelegramAgent = Get-ToolkitAgentByKey -Config $config -Key "hostedTelegramAgent"
$localCoderAgent = Get-ToolkitAgentByKey -Config $config -Key "localCoderAgent"
$remoteReviewAgent = Get-ToolkitAgentByKey -Config $config -Key "remoteReviewAgent"
$remoteCoderAgent = Get-ToolkitAgentByKey -Config $config -Key "remoteCoderAgent"
$telegramRouting = Get-ToolkitTelegramRouting -Config $config
$agentToAgentEnabled = @(
    foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $config)) {
        if (Test-ToolkitWorkspaceAllowsAgentToAgent -Config $config -Workspace $workspace) {
            $true
        }
    }
).Count -gt 0

if ($null -eq $strongAgent) {
    Write-Host "Multi-agent starter layout is not configured in openclaw-bootstrap.config.json." -ForegroundColor Yellow
    exit 0
}

Write-Step "Configuring starter multi-agent layout"

$currentAgents = @()
$existingAgentsRaw = Get-OpenClawConfigJsonValue -Path "agents.list"
if ($existingAgentsRaw) {
    $currentAgents = @($existingAgentsRaw)
}

$currentBindings = @()
$existingBindingsRaw = Get-OpenClawConfigJsonValue -Path "bindings"
if ($existingBindingsRaw) {
    $currentBindings = @($existingBindingsRaw)
}

$overlayDirName = Get-AgentOverlayDirName -Config $config

$desiredAgents = @()
$configuredManagedAgentIds = @(Get-ToolkitConfiguredAgentIds -Config $config)
$strongId = [string]$strongAgent.id
if ($strongAgent -and (Test-ToolkitAgentEnabled -AgentConfig $strongAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $strongAgent -ModelOverrideRef $StrongModelRef -IsDefault ([bool]$strongAgent.default)
}

if ($researchAgent -and (Test-ToolkitAgentEnabled -AgentConfig $researchAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $researchAgent -ModelOverrideRef $ResearchModelRef
}

$chatAgentId = $null
if ($localChatAgent -and (Test-ToolkitAgentEnabled -AgentConfig $localChatAgent)) {
    $chatAgentId = [string]$localChatAgent.id
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $localChatAgent -ModelOverrideRef $LocalChatModelRef
    if (-not (Test-ToolkitAgentAssigned -Config $config -AgentConfig $localChatAgent)) {
        $chatAgentId = $null
    }
}

if ($localReviewAgent -and (Test-ToolkitAgentEnabled -AgentConfig $localReviewAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $localReviewAgent -ModelOverrideRef $LocalReviewModelRef
}

if ($hostedTelegramAgent -and (Test-ToolkitAgentEnabled -AgentConfig $hostedTelegramAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $hostedTelegramAgent -ModelOverrideRef $HostedTelegramModelRef
}

if ($localCoderAgent -and (Test-ToolkitAgentEnabled -AgentConfig $localCoderAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $localCoderAgent -ModelOverrideRef $LocalCoderModelRef
}

if ($remoteReviewAgent -and (Test-ToolkitAgentEnabled -AgentConfig $remoteReviewAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $remoteReviewAgent -ModelOverrideRef $RemoteReviewModelRef
}

if ($remoteCoderAgent -and (Test-ToolkitAgentEnabled -AgentConfig $remoteCoderAgent)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $remoteCoderAgent -ModelOverrideRef $RemoteCoderModelRef
}

foreach ($extraAgent in @(Get-EnabledExtraAgents -Config $config)) {
    $desiredAgents = Add-DesiredAgentFromConfig -DesiredAgents $desiredAgents -Config $config -AgentConfig $extraAgent
}

$currentManagedExtraAgentIds = @(
    foreach ($extraAgent in @(Get-EnabledExtraAgents -Config $config)) {
        [string]$extraAgent.id
    }
)
$previousManagedExtraAgentIds = @(Get-PreviouslyManagedExtraAgentIds -Config $config -OverlayDirName $overlayDirName)
$staleManagedExtraAgentIds = @(
    foreach ($agentId in @($previousManagedExtraAgentIds)) {
        if ($agentId -notin @($currentManagedExtraAgentIds)) {
            [string]$agentId
        }
    }
)

$duplicateAgentIds = @(
    @(
        foreach ($desiredAgent in @($desiredAgents)) {
            if ($desiredAgent -is [System.Collections.IDictionary] -and $desiredAgent.Contains("id")) {
                [string]$desiredAgent["id"]
                continue
            }

            if ($null -ne $desiredAgent -and $desiredAgent.id) {
                [string]$desiredAgent.id
            }
        }
    ) |
        Group-Object |
        Where-Object { $_.Count -gt 1 } |
        Select-Object -ExpandProperty Name
)
if (@($duplicateAgentIds).Count -gt 0) {
    throw "Managed multi-agent config contains duplicate agent ids: $($duplicateAgentIds -join ', ')"
}

$mergedAgents = @()
foreach ($desired in $desiredAgents) {
    $desiredAgentId = Get-AgentEntryId -AgentEntry $desired
    $existing = $currentAgents | Where-Object { (Get-AgentEntryId -AgentEntry $_) -eq $desiredAgentId } | Select-Object -First 1
    if ($null -ne $existing) {
        $mergedAgents += (Merge-AgentEntry -Existing $existing -Desired $desired)
    }
    else {
        $mergedAgents += $desired
    }
}

foreach ($existing in $currentAgents) {
    $existingAgentId = Get-AgentEntryId -AgentEntry $existing
    if ($existingAgentId -in @($staleManagedExtraAgentIds) -or $existingAgentId -in @($configuredManagedAgentIds)) {
        continue
    }

    if (-not (@($mergedAgents) | Where-Object { (Get-AgentEntryId -AgentEntry $_) -eq $existingAgentId })) {
        $mergedAgents += $existing
    }
}

$defaultTelegramAccountId = Get-ToolkitTelegramDefaultAccountId -Config $config
$telegramRoutes = @(Get-ToolkitTelegramRouteList -Config $config)
if ($telegramRoutes.Count -eq 0 -and $chatAgentId -and $localChatAgent) {
    $legacyFallbackRoutes = New-Object System.Collections.Generic.List[object]
    if ([bool]$localChatAgent.routeTrustedTelegramGroups) {
        $legacyFallbackRoutes.Add([pscustomobject][ordered]@{
                accountId     = $defaultTelegramAccountId
                targetAgentId = $chatAgentId
                matchType     = "trusted-groups"
                peerId        = ""
            })
    }
    if ([bool]$localChatAgent.routeTrustedTelegramDms) {
        $legacyFallbackRoutes.Add([pscustomobject][ordered]@{
                accountId     = $defaultTelegramAccountId
                targetAgentId = $chatAgentId
                matchType     = "trusted-dms"
                peerId        = ""
            })
    }
    $telegramRoutes = @($legacyFallbackRoutes.ToArray())
}

$managedTelegramRoutes = New-Object System.Collections.Generic.List[object]
$validatedTelegramRoutes = New-Object System.Collections.Generic.List[object]
foreach ($telegramRoute in @($telegramRoutes)) {
    foreach ($normalizedRoute in @(Normalize-ToolkitTelegramRouteRecord -RouteRecord $telegramRoute -DefaultAccountId $defaultTelegramAccountId)) {
        if ($null -eq $normalizedRoute) {
            continue
        }

        $managedTelegramRoutes.Add($normalizedRoute)
        if ([string]::IsNullOrWhiteSpace([string]$normalizedRoute.targetAgentId)) {
            continue
        }

        $targetAgent = Get-ToolkitAgentById -Config $config -AgentId ([string]$normalizedRoute.targetAgentId)
        if ($null -eq $targetAgent -or -not (Test-ToolkitAgentEnabled -AgentConfig $targetAgent) -or -not (Test-ToolkitAgentAssigned -Config $config -AgentConfig $targetAgent)) {
            continue
        }

        $validatedTelegramRoutes.Add($normalizedRoute)
    }
}

$telegramConfig = Get-OpenClawConfigJsonValue -Path "channels.telegram"
$managedTelegramBindingSpecs = @(Get-ToolkitTelegramRouteBindingSpecs -Config $config -Routes @($managedTelegramRoutes.ToArray()) -DefaultAccountId $defaultTelegramAccountId)
$validatedTelegramBindingSpecs = @(Get-ToolkitTelegramRouteBindingSpecs -Config $config -Routes @($validatedTelegramRoutes.ToArray()) -DefaultAccountId $defaultTelegramAccountId)
$currentBindings = @(Remove-TelegramManagedBindings -Bindings $currentBindings -ManagedBindingSpecs $managedTelegramBindingSpecs -DefaultAccountId $defaultTelegramAccountId)
if ($null -ne $telegramConfig) {
    foreach ($bindingSpec in @($validatedTelegramBindingSpecs)) {
        $binding = [ordered]@{
            agentId = [string]$bindingSpec.targetAgentId
            match   = [ordered]@{
                channel   = "telegram"
                accountId = [string]$bindingSpec.accountId
                peer      = [ordered]@{
                    kind = [string]$bindingSpec.peerKind
                    id   = [string]$bindingSpec.peerId
                }
            }
        }
        $currentBindings = Add-BindingIfMissing -Bindings $currentBindings -Binding $binding
    }
}

Set-OpenClawConfigJson -Path "agents.list" -Value @($mergedAgents) -AsArray

$managedOptionalAgentProps = @(
    "model",
    "tools",
    "sandbox",
    "subagents",
    "skills"
)

for ($index = 0; $index -lt @($desiredAgents).Count; $index++) {
    $desiredAgent = $desiredAgents[$index]
    $desiredAgentId = Get-AgentEntryId -AgentEntry $desiredAgent
    $existingAgent = $currentAgents | Where-Object { (Get-AgentEntryId -AgentEntry $_) -eq $desiredAgentId } | Select-Object -First 1
    if ($null -eq $existingAgent) {
        continue
    }

    foreach ($prop in $managedOptionalAgentProps) {
        $desiredHasProp = $desiredAgent.Keys -contains $prop
        $existingHasProp = $existingAgent.PSObject.Properties.Name -contains $prop
        if ($existingHasProp -and -not $desiredHasProp) {
            Remove-OpenClawConfigJson -Path ("agents.list.{0}.{1}" -f $index, $prop)
        }
    }
}

if (@($currentBindings).Count -gt 0) {
    Set-OpenClawConfigJson -Path "bindings" -Value @($currentBindings) -AsArray
}

if ($agentToAgentEnabled) {
    $allow = @()
    foreach ($agent in @($mergedAgents)) {
        $allow = Add-UniqueString -List $allow -Value ([string]$agent.id)
    }
    $agentToAgent = [ordered]@{
        enabled = $true
        allow   = @($allow)
    }
    Set-OpenClawConfigJson -Path "tools.agentToAgent" -Value $agentToAgent
}

Flush-OpenClawConfigChanges

$managedAgentsFiles = @()
foreach ($staleExtraAgentId in @($staleManagedExtraAgentIds)) {
    $staleMarkerPath = Get-ManagedExtraAgentMarkerPath -Config $config -AgentId ([string]$staleExtraAgentId) -OverlayDirName $overlayDirName
    Remove-ManagedTextFileIfPresent -Path $staleMarkerPath
}

foreach ($managedExtraAgentId in @($currentManagedExtraAgentIds)) {
    $markerPath = Ensure-ManagedTextFile -Path (Get-ManagedExtraAgentMarkerPath -Config $config -AgentId ([string]$managedExtraAgentId) -OverlayDirName $overlayDirName) -ContentLines @("managed-extra-agent")
    if ($markerPath) { $managedAgentsFiles += $markerPath }
}

$sharedWorkspacePath = Get-SharedWorkspacePath -Config $config
foreach ($staleExtraAgentId in @($staleManagedExtraAgentIds)) {
    $staleOverlayDir = Get-AgentBootstrapOverlayDir -Config $config -AgentId ([string]$staleExtraAgentId) -OverlayDirName $overlayDirName
    foreach ($fileName in @($script:ManagedAgentBootstrapOverlayFiles)) {
        Remove-ManagedTextFileIfPresent -Path (Join-Path $staleOverlayDir $fileName)
    }
}

foreach ($desiredAgent in @($desiredAgents)) {
    $agentRecord = Get-ManagedAgentConfigRecord -Config $config -AgentId ([string]$desiredAgent.id)
    if ($null -eq $agentRecord -or $null -eq $agentRecord.AgentConfig) {
        continue
    }

    $agentConfig = $agentRecord.AgentConfig
    $effectiveWorkspacePath = if ($desiredAgent.PSObject.Properties.Name -contains "workspace" -and $desiredAgent.workspace) {
        [string]$desiredAgent.workspace
    }
    else {
        Get-AgentWorkspacePath -Config $config -AgentConfig $agentConfig
    }
    $agentSharedWorkspacePaths = @(Get-AgentAccessibleSharedWorkspacePaths -Config $config -AgentConfig $agentConfig)
    $agentCanAccessSharedWorkspace = Test-AgentCanAccessSharedWorkspace -Config $config -AgentConfig $agentConfig
    $agentTemplateMap = Get-AgentBootstrapTemplateMap -AgentConfig $desiredAgent -AgentId ([string]$desiredAgent.id) -WorkspacePath $effectiveWorkspacePath -SharedWorkspacePaths $agentSharedWorkspacePaths -IncludeSharedWorkspaceAccess:$agentCanAccessSharedWorkspace
    $managedAgentsFiles += @(Ensure-ManagedMarkdownFiles -TargetDir (Get-AgentBootstrapOverlayDir -Config $config -AgentId ([string]$desiredAgent.id) -OverlayDirName $overlayDirName) -TemplateMap $agentTemplateMap -AllowedFileNames $script:ManagedAgentBootstrapOverlayFiles)
}

foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $config)) {
    if ($null -eq $workspace -or -not (Test-ToolkitWorkspaceManagesAgentsMd -Config $config -Workspace $workspace)) {
        continue
    }

    foreach ($staleExtraAgentId in @($staleManagedExtraAgentIds)) {
        $staleExistingAgent = $currentAgents | Where-Object { $_.id -eq $staleExtraAgentId } | Select-Object -First 1
        if ($null -eq $staleExistingAgent) {
            $staleExistingAgent = $currentAgents | Where-Object { (Get-AgentEntryId -AgentEntry $_) -eq $staleExtraAgentId } | Select-Object -First 1
        }
        if ($null -ne $staleExistingAgent -and $staleExistingAgent.workspace) {
            $staleWorkspacePath = [string]$staleExistingAgent.workspace
            if ([string]::IsNullOrWhiteSpace($sharedWorkspacePath) -or $staleWorkspacePath -ne $sharedWorkspacePath) {
                $staleWorkspaceDir = Resolve-HostWorkspacePath -Config $config -WorkspacePath $staleWorkspacePath
                foreach ($fileName in @($script:ManagedWorkspaceMarkdownFiles + $script:ManagedWorkspaceSeedOnceMarkdownFiles)) {
                    Remove-ManagedTextFileIfPresent -Path (Join-Path $staleWorkspaceDir $fileName)
                }
            }
        }
    }
    $workspaceDefaultPath = if ([string]$workspace.mode -eq "shared") { "/home/node/.openclaw/workspace" } else { "/home/node/.openclaw/workspace" }
    $workspacePath = Get-ToolkitWorkspacePathValue -Workspace $workspace -DefaultPath $workspaceDefaultPath
    $activeWorkspaceAgents = @(
        foreach ($agentId in @($workspace.agents)) {
            $workspaceAgent = Get-ToolkitAgentById -Config $config -AgentId ([string]$agentId)
            if ($null -ne $workspaceAgent -and
                (Test-ToolkitAgentEnabled -AgentConfig $workspaceAgent) -and
                (Test-ToolkitAgentAssigned -Config $config -AgentConfig $workspaceAgent)) {
                $workspaceAgent
            }
        }
    )
    if (@($activeWorkspaceAgents).Count -eq 0) {
        continue
    }

    if ([string]$workspace.mode -eq "shared") {
        $sharedTemplateMap = Get-WorkspaceMarkdownTemplateMap -Workspace $workspace -WorkspacePath $workspacePath -SharedWorkspacePaths @($workspacePath)
        $workspaceHostDir = Resolve-HostWorkspacePath -Config $config -WorkspacePath $workspacePath
        $managedAgentsFiles += @(Ensure-ManagedSeedOnceMarkdownFiles -TargetDir $workspaceHostDir -TemplateMap $sharedTemplateMap -AllowedFileNames $script:ManagedWorkspaceSeedOnceMarkdownFiles)
        $managedAgentsFiles += @(Ensure-ManagedMarkdownFiles -TargetDir $workspaceHostDir -TemplateMap $sharedTemplateMap -AllowedFileNames $script:ManagedWorkspaceMarkdownFiles)
        continue
    }

    $primaryWorkspaceAgent = @($activeWorkspaceAgents) | Select-Object -First 1
    if ($null -eq $primaryWorkspaceAgent) {
        continue
    }

    $workspaceAgentName = if ($primaryWorkspaceAgent.PSObject.Properties.Name -contains "name" -and $primaryWorkspaceAgent.name) {
        [string]$primaryWorkspaceAgent.name
    }
    else {
        [string]$primaryWorkspaceAgent.id
    }
    $sharedWorkspacePathsForPrivateWorkspace = @(
        foreach ($sharedWorkspace in @(Get-ToolkitAccessibleSharedWorkspaceList -Config $config -AgentConfig $primaryWorkspaceAgent)) {
            Get-ToolkitWorkspacePathValue -Workspace $sharedWorkspace -DefaultPath "/home/node/.openclaw/workspace"
        }
    )
    $workspaceTemplateMap = Get-WorkspaceMarkdownTemplateMap -Workspace $workspace -WorkspacePath $workspacePath -AgentName $workspaceAgentName -SharedWorkspacePaths $sharedWorkspacePathsForPrivateWorkspace
    $workspaceHostDir = Resolve-HostWorkspacePath -Config $config -WorkspacePath $workspacePath
    $managedAgentsFiles += @(Ensure-ManagedSeedOnceMarkdownFiles -TargetDir $workspaceHostDir -TemplateMap $workspaceTemplateMap -AllowedFileNames $script:ManagedWorkspaceSeedOnceMarkdownFiles)
    $managedAgentsFiles += @(Ensure-ManagedMarkdownFiles -TargetDir $workspaceHostDir -TemplateMap $workspaceTemplateMap -AllowedFileNames $script:ManagedWorkspaceMarkdownFiles)
}

Write-Host "Configured agents:" -ForegroundColor Green
@($mergedAgents) | ForEach-Object {
    $model = if ($_.model.primary) { [string]$_.model.primary } else { "(inherits default)" }
    Write-Host "- $($_.id): $model"
}
if (@($managedAgentsFiles).Count -gt 0) {
    Write-Host "Managed bootstrap prompt files:" -ForegroundColor Green
    foreach ($managedFile in @($managedAgentsFiles)) {
        Write-Host "- $managedFile"
    }
}

if (-not $NoRestart) {
    Write-Step "Restarting gateway for multi-agent changes"
    $null = Invoke-External -FilePath "docker" -Arguments @(
        "compose", "-f", ([string]$config.composeFilePath),
        "restart", "openclaw-gateway"
    )
    Wait-ForGateway
}
