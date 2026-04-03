[CmdletBinding()]
param(
    [string]$ConfigPath,
    [ValidateSet("stable", "beta")]
    [string]$Channel = "stable",
    [string]$Ref
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-upstream-patches.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure,
        [switch]$Quiet
    )

    if (-not $Quiet) {
        Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
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

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
    }

    if ($text -and -not $Quiet) {
        Write-Host $text
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Get-NonEmptyLines {
    param([string]$Text)

    return @($Text -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
}

function Test-IsManagedStatusLine {
    param(
        [Parameter(Mandatory = $true)][string]$Line,
        [Parameter(Mandatory = $true)][string[]]$ManagedPaths
    )

    foreach ($managedPath in $ManagedPaths) {
        if ($Line -like "* $managedPath") {
            return $true
        }
    }

    return $false
}

function Test-PrereleaseTag {
    param([Parameter(Mandatory = $true)][string]$TagName)

    return $TagName -match '(?i)(?:^|[-.])(alpha|beta|rc|preview|pre)(?:[.-]?\d+)*$'
}

function Resolve-UpdateTarget {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string]$Channel,
        [string]$ExplicitRef
    )

    if ($ExplicitRef) {
        $candidates = @(
            "refs/tags/$ExplicitRef",
            "refs/remotes/origin/$ExplicitRef",
            $ExplicitRef
        )

        foreach ($candidate in $candidates) {
            $probe = Invoke-External -FilePath "git" -Arguments @("-C", $RepoPath, "rev-parse", "--verify", "--quiet", $candidate) -AllowFailure
            if ($probe.ExitCode -eq 0) {
                $commit = (Get-NonEmptyLines -Text $probe.Output | Select-Object -First 1).Trim()
                if ($commit) {
                    $kind = "ref"
                    if ($candidate -like "refs/tags/*") {
                        $kind = "tag"
                    }
                    elseif ($candidate -like "refs/remotes/origin/*") {
                        $kind = "branch"
                    }

                    return [pscustomobject]@{
                        DisplayName = $ExplicitRef
                        CheckoutRef = $candidate
                        Commit      = $commit
                        Kind        = $kind
                        Source      = "explicit"
                    }
                }
            }
        }

        throw "Could not resolve update ref '$ExplicitRef'. Try a release tag like v2026.4.2 or a branch like main."
    }

    $tagList = Invoke-External -FilePath "git" -Arguments @("-C", $RepoPath, "tag", "--list", "--sort=-version:refname")
    $allTags = Get-NonEmptyLines -Text $tagList.Output

    if ($allTags.Count -eq 0) {
        throw "No release tags were found after fetching origin."
    }

    if ($Channel -eq "beta") {
        $candidateTag = @($allTags | Where-Object { Test-PrereleaseTag -TagName $_ } | Select-Object -First 1)
        if (-not $candidateTag) {
            throw "No beta/prerelease tags were found on origin."
        }
        $sourceLabel = "beta"
    }
    else {
        $candidateTag = @($allTags | Where-Object { -not (Test-PrereleaseTag -TagName $_) } | Select-Object -First 1)
        if (-not $candidateTag) {
            throw "No stable release tags were found on origin."
        }
        $sourceLabel = "stable"
    }

    $candidateTag = [string]$candidateTag[0]
    $probe = Invoke-External -FilePath "git" -Arguments @("-C", $RepoPath, "rev-parse", "--verify", "--quiet", "refs/tags/$candidateTag")
    $commit = (Get-NonEmptyLines -Text $probe.Output | Select-Object -First 1).Trim()

    [pscustomobject]@{
        DisplayName = $candidateTag
        CheckoutRef = "refs/tags/$candidateTag"
        Commit      = $commit
        Kind        = "tag"
        Source      = $sourceLabel
    }
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$configBaseDir = Split-Path -Parent $ConfigPath
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir $configBaseDir
$managedUpstreamPatches = @(Get-ManagedUpstreamPatches -Config $config -BaseDir $configBaseDir)
$managedUpstreamPaths = @(Get-ManagedUpstreamPatchPaths -Patches $managedUpstreamPatches)
$repoPath = [string]$config.repoPath
$bootstrapScript = Join-Path (Split-Path -Parent $PSCommandPath) "bootstrap-openclaw.ps1"
$backupScript = Join-Path (Split-Path -Parent $PSCommandPath) "backup-openclaw.ps1"

if (-not (Test-Path $bootstrapScript)) {
    throw "Bootstrap script not found: $bootstrapScript"
}
if (-not (Test-Path $backupScript)) {
    throw "Backup script not found: $backupScript"
}

if ($Ref -and -not $PSBoundParameters.ContainsKey("Ref")) {
    $Ref = $null
}

if (-not (Test-Path $repoPath)) {
    Write-Step "Repo is missing, running bootstrap to clone and provision OpenClaw"
    & $bootstrapScript -ConfigPath $ConfigPath
    if (-not $?) {
        throw "Bootstrap failed while preparing the repo for update."
    }
}

Write-Step "Checking repo state"
$statusResult = Invoke-External -FilePath "git" -Arguments @("-C", $repoPath, "status", "--porcelain")
$statusLines = Get-NonEmptyLines -Text $statusResult.Output
$managedRepoPaths = @("docker-compose.yml") + $managedUpstreamPaths
$unexpectedLines = @($statusLines | Where-Object { -not (Test-IsManagedStatusLine -Line $_ -ManagedPaths $managedRepoPaths) })

if ($unexpectedLines.Count -gt 0) {
    throw "Update aborted because the repo has unexpected local changes:`n$($unexpectedLines -join [Environment]::NewLine)"
}

$stashCreated = $false
$stashRef = $null

try {
    Write-Step "Creating pre-update backup snapshot"
    & $backupScript -ConfigPath $ConfigPath
    if (-not $?) {
        throw "Backup failed before update."
    }

    $managedDirtyLines = @($statusLines | Where-Object { Test-IsManagedStatusLine -Line $_ -ManagedPaths $managedRepoPaths })
    if ($managedDirtyLines.Count -gt 0) {
        Write-Step "Stashing managed repo overrides"
        $stashArgs = @(
            "-C", $repoPath,
            "stash", "push", "-u",
            "-m", "openclaw-managed-compose-before-update",
            "--", "docker-compose.yml"
        ) + $managedUpstreamPaths
        $null = Invoke-External -FilePath "git" -Arguments $stashArgs

        $stashList = Invoke-External -FilePath "git" -Arguments @("-C", $repoPath, "stash", "list")
        $stashRef = @(
            Get-NonEmptyLines -Text $stashList.Output |
            Where-Object { $_ -match "openclaw-managed-compose-before-update" } |
            Select-Object -First 1
        ) -replace ':.*$', ''
        $stashCreated = $true
    }

    Write-Step "Fetching origin branches and tags"
    $null = Invoke-External -FilePath "git" -Arguments @(
        "-C", $repoPath,
        "fetch", "--prune", "--tags", "--force", "origin",
        "+refs/heads/*:refs/remotes/origin/*"
    )

    $target = Resolve-UpdateTarget -RepoPath $repoPath -Channel $Channel -ExplicitRef $Ref
    $currentHead = (Get-NonEmptyLines -Text (Invoke-External -FilePath "git" -Arguments @("-C", $repoPath, "rev-parse", "HEAD")).Output | Select-Object -First 1).Trim()

    if ($target.Source -eq "stable") {
        Write-Step "Selecting latest stable release"
    }
    elseif ($target.Source -eq "beta") {
        Write-Step "Selecting latest beta release"
    }
    else {
        Write-Step "Selecting explicit update ref"
    }

    Write-Host "Target: $($target.DisplayName) [$($target.Kind)] @ $($target.Commit)" -ForegroundColor Green

    if ($currentHead -eq $target.Commit) {
        Write-WarnLine "Repo is already at the requested target commit."
    }
    else {
        Write-Step "Checking out $($target.DisplayName)"
        $null = Invoke-External -FilePath "git" -Arguments @("-C", $repoPath, "checkout", "--detach", $target.CheckoutRef)
    }

    Write-Step "Reapplying secure setup and verification"
    & $bootstrapScript -ConfigPath $ConfigPath
    if (-not $?) {
        throw "Bootstrap failed during update."
    }

    if ($stashCreated -and $stashRef) {
        Write-Step "Dropping managed pre-update stash"
        $null = Invoke-External -FilePath "git" -Arguments @("-C", $repoPath, "stash", "drop", $stashRef)
    }
}
catch {
    if ($stashCreated -and $stashRef) {
        Write-Host ""
        Write-Host "Managed compose changes are preserved in git stash as $stashRef." -ForegroundColor Yellow
    }
    throw
}
