[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$ConfigPath,
    [string]$BackupPath,
    [switch]$RunBootstrap,
    [switch]$SkipSafetyBackup
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

function Get-HostConfigDir {
    param([Parameter(Mandatory = $true)]$Config)

    if ($Config.PSObject.Properties.Name -contains "hostConfigDir" -and $Config.hostConfigDir) {
        return [string]$Config.hostConfigDir
    }

    return (Join-Path $env:USERPROFILE ".openclaw")
}

function Ensure-RepoPresent {
    param([Parameter(Mandatory = $true)]$Config)

    if (Test-Path $Config.repoPath) {
        if (-not (Test-Path (Join-Path $Config.repoPath ".git"))) {
            throw "Repo path exists but is not a git checkout: $($Config.repoPath)"
        }
        return
    }

    $parentDir = Split-Path -Parent $Config.repoPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    $cloneArgs = @("clone")
    if ($Config.repoCloneDepth) {
        $cloneArgs += @("--depth", [string]$Config.repoCloneDepth)
    }
    $cloneArgs += @([string]$Config.repoUrl, [string]$Config.repoPath)
    $null = Invoke-External -FilePath "git" -Arguments $cloneArgs
}

function Find-LatestBackup {
    param([Parameter(Mandatory = $true)][string]$BackupDir)

    if (-not (Test-Path $BackupDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $BackupDir -Filter "openclaw-backup-*.zip" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$DestinationDir,
        [Parameter(Mandatory = $true)]$PSCmdletRef
    )

    if (-not (Test-Path $SourceDir)) {
        return
    }

    if ($PSCmdletRef.ShouldProcess($DestinationDir, "Restore directory contents from $SourceDir")) {
        New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null
        Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
            $target = Join-Path $DestinationDir $_.Name
            Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
        }
    }
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$scriptDir = Split-Path -Parent $PSCommandPath
$backupScript = Join-Path $scriptDir "backup-openclaw.ps1"
$bootstrapScript = Join-Path $scriptDir "bootstrap-openclaw.ps1"
$hostConfigDir = Get-HostConfigDir -Config $config

if (-not $BackupPath) {
    $latest = Find-LatestBackup -BackupDir (Join-Path $scriptDir "backups")
    if ($null -eq $latest) {
        throw "No backup archive found. Pass -BackupPath explicitly or create one first."
    }
    $BackupPath = $latest.FullName
}

if (-not (Test-Path $BackupPath)) {
    throw "Backup archive not found: $BackupPath"
}

$stagingDir = Join-Path $env:TEMP ("openclaw-restore-" + [guid]::NewGuid().ToString("N"))

try {
    Write-Step "Extracting backup archive"
    if (-not (Test-Path $stagingDir)) {
        New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
    }
    $savedWhatIf = $WhatIfPreference
    try {
        $WhatIfPreference = $false
        Expand-Archive -LiteralPath $BackupPath -DestinationPath $stagingDir -Force
    }
    finally {
        $WhatIfPreference = $savedWhatIf
    }

    $hostStage = Join-Path $stagingDir "host-openclaw"
    $repoStage = Join-Path $stagingDir "repo"
    $setupStage = Join-Path $stagingDir "setup"

    if (-not (Test-Path $hostStage)) {
        throw "Backup is missing host-openclaw content: $BackupPath"
    }

    $hasExistingState = (Test-Path (Join-Path $hostConfigDir "openclaw.json")) -or (Test-Path $config.envFilePath)
    if ($hasExistingState -and -not $SkipSafetyBackup -and -not $WhatIfPreference) {
        if (-not (Test-Path $backupScript)) {
            throw "Safety backup script not found: $backupScript"
        }
        Write-Step "Creating safety backup before restore"
        & $backupScript -ConfigPath $ConfigPath
        if ($LASTEXITCODE -ne 0) {
            throw "Safety backup failed before restore."
        }
    }

    Write-Step "Ensuring repo checkout exists"
    if ($PSCmdlet.ShouldProcess([string]$config.repoPath, "Ensure OpenClaw repo checkout")) {
        Ensure-RepoPresent -Config $config
    }

    Write-Step "Restoring host OpenClaw state"
    Copy-DirectoryContents -SourceDir $hostStage -DestinationDir $hostConfigDir -PSCmdletRef $PSCmdlet

    if (Test-Path $repoStage) {
        Write-Step "Restoring repo-local files"
        foreach ($name in @(".env", "docker-compose.yml")) {
            $source = Join-Path $repoStage $name
            if (Test-Path $source) {
                $target = Join-Path $config.repoPath $name
                if ($PSCmdlet.ShouldProcess($target, "Restore $name from backup")) {
                    Copy-Item -LiteralPath $source -Destination $target -Force
                }
            }
        }
    }

    if (Test-Path $setupStage) {
        Write-Step "Restoring setup reference files if missing"
        foreach ($name in @("openclaw-bootstrap.config.json", "openclaw.env.template", "manual-steps.md")) {
            $source = Join-Path $setupStage $name
            $target = Join-Path $scriptDir $name
            if ((Test-Path $source) -and (-not (Test-Path $target))) {
                if ($PSCmdlet.ShouldProcess($target, "Restore missing setup reference file")) {
                    Copy-Item -LiteralPath $source -Destination $target -Force
                }
            }
        }
    }

    if ($RunBootstrap) {
        if (-not (Test-Path $bootstrapScript)) {
            throw "Bootstrap script not found: $bootstrapScript"
        }

        Write-Step "Running bootstrap after restore"
        if ($PSCmdlet.ShouldProcess($config.repoPath, "Run bootstrap-openclaw.ps1")) {
            & $bootstrapScript -ConfigPath $ConfigPath
            if ($LASTEXITCODE -ne 0) {
                throw "Bootstrap failed after restore."
            }
        }
    }

    Write-Host ""
    Write-Host "Restore complete." -ForegroundColor Green
    Write-Host "Backup used: $BackupPath"
}
finally {
    if (Test-Path $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
}
