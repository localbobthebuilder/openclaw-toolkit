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
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-toolkit-logging.ps1")

Enable-ToolkitTimestampedOutput

$usingPowerShellCore = $PSVersionTable.PSEdition -eq "Core"
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $usingPowerShellCore -and $null -ne $pwshCommand) {
    Write-Host "INFO: Running under Windows PowerShell. 'pwsh' is installed and preferred for future verification runs." -ForegroundColor Yellow
    Write-Host "INFO: Next time, launch via run-verify.cmd or run:" -ForegroundColor Yellow
    Write-Host "      pwsh -ExecutionPolicy Bypass -File $($MyInvocation.MyCommand.Path)" -ForegroundColor Yellow
}

$script:ConvertFromJsonSupportsDepth = (Get-Command ConvertFrom-Json).Parameters.ContainsKey("Depth")

function ConvertFrom-JsonCompat {
    param(
        [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
        [AllowEmptyString()]
        [string]$InputObject,
        [int]$Depth = 50
    )

    process {
        if ($script:ConvertFromJsonSupportsDepth) {
            return ($InputObject | ConvertFrom-Json -Depth $Depth)
        }

        return ($InputObject | ConvertFrom-Json)
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Detail {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::White
    )

    Write-Host "    $Message" -ForegroundColor $Color
}

function Test-SmokeStructuredMetadataLine {
    param([string]$Line)

    return -not [string]::IsNullOrWhiteSpace($Line) -and $Line -match '^__SMOKE_JSON__:\s*\{'
}

function Remove-SmokeStructuredMetadata {
    param([string]$Output)

    if ([string]::IsNullOrWhiteSpace($Output)) {
        return $Output
    }

    $lines = @(
        foreach ($line in @($Output -split "\r\n|\n|\r")) {
            if (Test-SmokeStructuredMetadataLine -Line $line) {
                continue
            }

            $line
        }
    )

    return (($lines -join [Environment]::NewLine).Trim())
}

function Get-DetailColorForLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return [ConsoleColor]::White
    }

    $trimmed = $Line.Trim()
    if ($trimmed -match '^(FAIL:|FAIL in\b|Reason:|Failure:|.* smoke test failed\.$|Agent capability smoke test failed\.$)') {
        return [ConsoleColor]::Red
    }
    if ($trimmed -match '^(PASS:|PASS in\b|.* smoke test passed\.$|Stopped )') {
        return [ConsoleColor]::Green
    }
    if ($trimmed -match '^(SKIP:|INFO:|WARN:|Category:|Verification completed with actionable issues)') {
        return [ConsoleColor]::Yellow
    }
    if ($trimmed -match '^(Configured model for |Observed model for )') {
        return [ConsoleColor]::Cyan
    }

    return [ConsoleColor]::White
}

function Write-SummaryStatusDetail {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Status
    )

    $color = switch -Regex ($Status) {
        '^PASS$' { [ConsoleColor]::Green; break }
        '^FAIL$' { [ConsoleColor]::Red; break }
        '^(SKIP/INFO|INFO|INFO/INCOMPLETE)$' { [ConsoleColor]::Yellow; break }
        default { [ConsoleColor]::White }
    }

    Write-Detail "${Label}: $Status" $color
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

    $sanitizedContent = Remove-SmokeStructuredMetadata -Output $Content
    [void]$Lines.Add("")
    [void]$Lines.Add("[$Title]")
    [void]$Lines.Add($sanitizedContent)
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
    try {
        $null = $process.Start()
    }
    catch [System.ComponentModel.Win32Exception] {
        if (-not $AllowFailure) {
            throw "Command not found: $FilePath"
        }

        return [pscustomobject]@{
            ExitCode = -1
            Output   = "Command not found: $FilePath"
        }
    }
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

function Convert-DockerDesktopPathToWindows {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    $trimmed = $Path.Trim()
    if ($trimmed -match '^(?<drive>[A-Za-z]):\\') {
        return [System.IO.Path]::GetFullPath($trimmed)
    }

    if ($trimmed -match '^/(?<drive>[A-Za-z])(?:/(?<rest>.*))?$') {
        $drive = $Matches.drive.ToUpperInvariant()
        $rest = if ($Matches.rest) { ($Matches.rest -replace '/', '\') } else { "" }
        $windowsPath = if ([string]::IsNullOrWhiteSpace($rest)) {
            "${drive}:\"
        }
        else {
            "${drive}:\$rest"
        }
        return [System.IO.Path]::GetFullPath($windowsPath)
    }

    return $null
}

function Test-PathWithinRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $normalizedPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($normalizedPath.Length -eq 0 -or $normalizedRoot.Length -eq 0) {
        return $false
    }

    return $normalizedPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normalizedPath.StartsWith($normalizedRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-EnvVarValueFromFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $match = Select-String -Path $Path -Pattern ("^" + [regex]::Escape($Name) + "=(.*)$") | Select-Object -First 1
    if (-not $match) {
        return $null
    }

    return [string]$match.Matches[0].Groups[1].Value
}

function Get-ExternalFailureInfo {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$Output,
        [int]$ExitCode = 1
    )

    $commandName = [System.IO.Path]::GetFileName($FilePath).ToLowerInvariant()
    $fullText = ((@($Arguments) -join " ") + [Environment]::NewLine + ($Output ?? "")).ToLowerInvariant()
    $summary = $null

    switch ($commandName) {
        { $_ -in @("docker", "docker.exe") } {
            if ($fullText -match 'failed to connect to the docker api|error during connect|dockerdesktoplinuxengine|dockerdesktopwindowsengine|daemon is not running|is the docker daemon running|cannot find the file specified') {
                $summary = "Docker engine is not running or not reachable."
            }
            elseif ($fullText -match 'no such container|container .* is not running') {
                $summary = "OpenClaw gateway container is not running."
            }
            break
        }
        { $_ -in @("curl", "curl.exe") } {
            if ($fullText -match 'failed to connect|could not connect|connection refused|timed out') {
                $summary = "Target service is not responding."
            }
            break
        }
    }

    $details = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($summary)) {
        [void]$details.Add($summary)
    }

    $rawOutput = ($Output ?? "").Trim()
    if (-not [string]::IsNullOrWhiteSpace($rawOutput) -and $rawOutput -ne $summary) {
        if ($details.Count -gt 0) {
            [void]$details.Add("")
            [void]$details.Add("Raw output:")
        }
        [void]$details.Add($rawOutput)
    }

    if ($details.Count -eq 0) {
        [void]$details.Add("Command failed with exit code $ExitCode.")
    }

    [pscustomobject]@{
        Summary = $summary
        Output  = ($details -join [Environment]::NewLine)
    }
}

function Test-ResultHasIssue {
    param($Result)

    return $null -ne $Result -and $null -ne $Result.ExitCode -and [int]$Result.ExitCode -ne 0
}

function Invoke-RegisteredLocalModelCleanup {
    param([Parameter(Mandatory = $true)]$Config)

    $modelRefs = @(Get-ToolkitVerificationCleanupModelRefs)
    if ($modelRefs.Count -eq 0) {
        return [pscustomobject]@{
            Attempted = $false
            HasIssue  = $false
        }
    }

    Write-Step "Local model cleanup"

    $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $ollamaCommand) {
        Write-Detail "Skipping cleanup because ollama CLI is not available on the host." ([ConsoleColor]::Yellow)
        return [pscustomobject]@{
            Attempted = $true
            HasIssue  = $true
        }
    }

    $hasIssue = $false
    foreach ($modelRef in @($modelRefs)) {
        if ([string]::IsNullOrWhiteSpace($modelRef)) {
            continue
        }

        $providerId, $modelId = ([string]$modelRef -split "/", 2)
        if ([string]::IsNullOrWhiteSpace($modelId) -or $providerId -notlike "ollama*") {
            continue
        }

        $endpoint = Get-ToolkitOllamaEndpointByProviderId -Config $Config -ProviderId $providerId
        if ($null -eq $endpoint) {
            $hasIssue = $true
            Write-Detail "Skipping $modelRef because its Ollama endpoint is no longer configured." ([ConsoleColor]::Yellow)
            continue
        }

        $oldHost = $env:OLLAMA_HOST
        try {
            $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint
            Write-Detail "Stopping $modelRef to free GPU memory" ([ConsoleColor]::DarkGray)
            $stopOutput = @(& $ollamaCommand.Source "stop" $modelId 2>&1 | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            $stopExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        }
        catch {
            $stopExitCode = 1
            $stopOutput = @(
                if ($_.Exception -and -not [string]::IsNullOrWhiteSpace([string]$_.Exception.Message)) {
                    [string]$_.Exception.Message.Trim()
                }
                else {
                    ($_ | Out-String).Trim()
                }
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        }
        finally {
            if ($null -eq $oldHost) {
                Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
            }
            else {
                $env:OLLAMA_HOST = $oldHost
            }
        }

        $stopPreview = (@($stopOutput) -join " ").ToLowerInvariant()
        $alreadyUnloaded = $stopPreview -match 'not loaded|not running|no running model|not found'
        if ($stopExitCode -eq 0) {
            Write-Detail "Stopped $modelRef" ([ConsoleColor]::Green)
        }
        elseif ($alreadyUnloaded) {
            Write-Detail "$modelRef was already unloaded" ([ConsoleColor]::DarkGray)
        }
        else {
            $hasIssue = $true
            Write-Detail "Ollama stop for $modelRef returned exit code $stopExitCode." ([ConsoleColor]::Yellow)
            if (@($stopOutput).Count -gt 0) {
                Write-Detail (@($stopOutput)[0]) ([ConsoleColor]::Yellow)
            }
        }
    }

    return [pscustomobject]@{
        Attempted = $true
        HasIssue  = $hasIssue
    }
}

function Invoke-LoggedEnvPathValidation {
    param(
        [Parameter(Mandatory = $true)][string]$EnvFilePath,
        [Parameter(Mandatory = $true)][string]$CurrentUserProfile,
        [Parameter(Mandatory = $true)]$Checks
    )

    Write-Step "Docker bind-mount env paths"
    $started = Get-Date

    if (-not (Test-Path $EnvFilePath)) {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "FAIL in $elapsed" ([ConsoleColor]::Red)
        Write-Detail "OpenClaw env file not found: $EnvFilePath" ([ConsoleColor]::Red)
        return [pscustomobject]@{
            ExitCode = 1
            Output   = "OpenClaw env file not found: $EnvFilePath"
        }
    }

    $lines = New-Object System.Collections.Generic.List[string]
    $hasIssue = $false

    foreach ($check in @($Checks)) {
        $name = [string]$check.Name
        $expectedPath = [System.IO.Path]::GetFullPath([string]$check.ExpectedPath)
        $expectedDockerPath = Convert-WindowsPathToDockerDesktop -Path $expectedPath
        $rawValue = Get-EnvVarValueFromFile -Path $EnvFilePath -Name $name

        if ([string]::IsNullOrWhiteSpace($rawValue)) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $name is missing from $EnvFilePath")
            continue
        }

        $resolvedWindowsPath = Convert-DockerDesktopPathToWindows -Path $rawValue
        if ([string]::IsNullOrWhiteSpace($resolvedWindowsPath)) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $name uses an unsupported host path format: $rawValue")
            continue
        }

        $insideCurrentProfile = Test-PathWithinRoot -Path $resolvedWindowsPath -Root $CurrentUserProfile
        if (-not $insideCurrentProfile) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $name points outside the current user profile.")
            [void]$lines.Add("Actual: $rawValue")
            [void]$lines.Add("Resolved: $resolvedWindowsPath")
            [void]$lines.Add("Expected user profile root: $CurrentUserProfile")
            [void]$lines.Add("")
            continue
        }

        if (-not $resolvedWindowsPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $name does not match the toolkit-managed host path.")
            [void]$lines.Add("Actual: $rawValue")
            [void]$lines.Add("Resolved: $resolvedWindowsPath")
            [void]$lines.Add("Expected: $expectedDockerPath")
            [void]$lines.Add("")
            continue
        }

        [void]$lines.Add("PASS: $name -> $rawValue")
    }

    $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
    if ($hasIssue) {
        Write-Detail "Docker bind-mount env paths need attention in $elapsed" ([ConsoleColor]::Red)
    }
    else {
        Write-Detail "Docker bind-mount env paths match the current user in $elapsed" ([ConsoleColor]::Green)
    }

    $output = ($lines -join [Environment]::NewLine).Trim()
    return [pscustomobject]@{
        ExitCode = if ($hasIssue) { 1 } else { 0 }
        Output   = $output
    }
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
            $failureInfo = Get-ExternalFailureInfo -FilePath $FilePath -Arguments $Arguments -Output $result.Output -ExitCode ([int]$result.ExitCode)
            $message = if ($FailureSummary) { $FailureSummary } elseif ($failureInfo.Summary) { $failureInfo.Summary } else { "WARN: exit code $($result.ExitCode) in $elapsed" }
            Write-Detail $message ([ConsoleColor]::Red)
            if ($failureInfo.Summary -and $FailureSummary -and $failureInfo.Summary -ne $FailureSummary) {
                Write-Detail $failureInfo.Summary ([ConsoleColor]::Red)
            }
            $result = [pscustomobject]@{
                ExitCode = [int]$result.ExitCode
                Output   = $failureInfo.Output
            }
        }

        return $result
    }
    catch {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "FAIL in $elapsed" ([ConsoleColor]::Red)
        $errorText = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message.Trim() } else { ($_ | Out-String).Trim() }
        $failureInfo = Get-ExternalFailureInfo -FilePath $FilePath -Arguments $Arguments -Output $errorText -ExitCode 1
        if ($FailureSummary) {
            Write-Detail $FailureSummary ([ConsoleColor]::Red)
        }
        if ($failureInfo.Summary) {
            if (-not $FailureSummary -or $failureInfo.Summary -ne $FailureSummary) {
                Write-Detail $failureInfo.Summary ([ConsoleColor]::Red)
            }
        }
        elseif ($errorText) {
            $preview = ($errorText -split "(`r`n|`n|`r)")[0]
            Write-Detail $preview ([ConsoleColor]::Red)
        }
        return [pscustomobject]@{
            ExitCode = 1
            Output   = $failureInfo.Output
        }
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
                    if (-not (Test-SmokeStructuredMetadataLine -Line $line)) {
                        Write-Detail $line (Get-DetailColorForLine -Line $line)
                    }
                }
            }
        }
        else {
            & $ScriptPath @ScriptArguments 2>&1 | ForEach-Object {
                $line = ($_ | Out-String).TrimEnd()
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $captured.Add($line)
                    if (-not (Test-SmokeStructuredMetadataLine -Line $line)) {
                        Write-Detail $line (Get-DetailColorForLine -Line $line)
                    }
                }
            }
        }

        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "PASS in $elapsed" ([ConsoleColor]::Green)
        return ($captured -join [Environment]::NewLine).Trim()
    }
    catch {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        $errorText = if ($_.Exception -and -not [string]::IsNullOrWhiteSpace([string]$_.Exception.Message)) {
            [string]$_.Exception.Message.Trim()
        }
        else {
            ($_ | Out-String).Trim()
        }
        $capturedText = ($captured -join [Environment]::NewLine).Trim()
        $hasStructuredResult = $capturedText -match '__SMOKE_JSON__:\s*\{'
        Write-Detail "FAIL in $elapsed" ([ConsoleColor]::Red)
        if ($errorText -and -not $hasStructuredResult) {
            $preview = ($errorText -split "(`r`n|`n|`r)")[0]
            Write-Detail $preview ([ConsoleColor]::Red)
        }

        if ($hasStructuredResult) {
            return $capturedText
        }

        if ($errorText) {
            $captured.Add("Failure: $errorText")
        }
        return ($captured -join [Environment]::NewLine).Trim()
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
        return ($match.Groups[1].Value | ConvertFrom-JsonCompat -Depth 20)
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

function Get-OpenClawConfigDocument {
    param([Parameter(Mandatory = $true)]$Config)

    $configFile = Join-Path (Get-HostConfigDir -Config $Config) "openclaw.json"
    if (-not (Test-Path $configFile)) {
        return $null
    }

    try {
        $raw = (Get-Content -Raw $configFile).Trim()
        if (-not $raw) {
            return $null
        }

        try {
            return $raw | ConvertFrom-JsonCompat -Depth 50
        }
        catch {
            $repaired = ($raw -replace '(?:\\r\\n|\\n|\\r)+$', '').Trim()
            if (-not $repaired) {
                return $null
            }

            return $repaired | ConvertFrom-JsonCompat -Depth 50
        }
    }
    catch {
        return $null
    }
}

function Resolve-OpenClawConfigDocumentPathValue {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $current = $Document
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

    return $current
}

function Test-TelegramCredentialConfigured {
    param($TelegramConfig)

    if ($null -eq $TelegramConfig) {
        return $false
    }

    foreach ($propertyName in @("botToken", "tokenFile")) {
        if ($TelegramConfig.PSObject.Properties.Name -contains $propertyName) {
            $value = [string]$TelegramConfig.$propertyName
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $true
            }
        }
    }

    if ($TelegramConfig.PSObject.Properties.Name -contains "accounts" -and $null -ne $TelegramConfig.accounts) {
        foreach ($accountProperty in @($TelegramConfig.accounts.PSObject.Properties)) {
            if (Test-TelegramCredentialConfigured -TelegramConfig $accountProperty.Value) {
                return $true
            }
        }
    }

    return $false
}

function Test-TelegramChannelEnabled {
    param($TelegramConfig)

    if ($null -eq $TelegramConfig) {
        return $false
    }

    if ($TelegramConfig.PSObject.Properties.Name -contains "enabled" -and [bool]$TelegramConfig.enabled) {
        return $true
    }

    if ($TelegramConfig.PSObject.Properties.Name -contains "accounts" -and $null -ne $TelegramConfig.accounts) {
        foreach ($accountProperty in @($TelegramConfig.accounts.PSObject.Properties)) {
            if (Test-TelegramChannelEnabled -TelegramConfig $accountProperty.Value) {
                return $true
            }
        }
    }

    return $false
}

function Get-TelegramAccountCount {
    param($TelegramConfig)

    if ($null -eq $TelegramConfig) {
        return 0
    }

    if (-not ($TelegramConfig.PSObject.Properties.Name -contains "accounts") -or $null -eq $TelegramConfig.accounts) {
        return 0
    }

    return @($TelegramConfig.accounts.PSObject.Properties).Count
}

function Get-TelegramGroupCount {
    param($TelegramConfig)

    if ($null -eq $TelegramConfig) {
        return 0
    }

    if (-not ($TelegramConfig.PSObject.Properties.Name -contains "groups") -or $null -eq $TelegramConfig.groups) {
        return 0
    }

    $groups = $TelegramConfig.groups
    if ($groups -is [System.Collections.IList]) {
        return $groups.Count
    }

    return @($groups.PSObject.Properties).Count
}

function Invoke-LoggedTelegramConfigCheck {
    param(
        $BootstrapTelegramConfig,
        $LiveConfig
    )

    Write-Step "Telegram channel config"
    $started = Get-Date

    $toolkitTelegramConfigured = $null -ne $BootstrapTelegramConfig
    $toolkitTelegramEnabled = $toolkitTelegramConfigured -and [bool]$BootstrapTelegramConfig.enabled
    $toolkitTelegramHasCredentials = Test-TelegramCredentialConfigured -TelegramConfig $BootstrapTelegramConfig

    if ($null -eq $LiveConfig) {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        $message = "Could not read live host config for Telegram verification."
        Write-Detail "$message ($elapsed)" ([ConsoleColor]::Yellow)
        return [pscustomobject]@{
            ExitCode = 1
            Output   = $message
        }
    }

    $liveTelegramConfig = Resolve-OpenClawConfigDocumentPathValue -Document $LiveConfig -Path "channels.telegram"
    if ($null -eq $liveTelegramConfig) {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        if ($toolkitTelegramEnabled) {
            $message = if ($toolkitTelegramHasCredentials) {
                "channels.telegram is not initialized in live config yet. Re-run bootstrap to apply Telegram setup."
            }
            else {
                "Telegram setup incomplete: channels.telegram is not initialized in live config yet. Run .\run-openclaw.cmd telegram-setup or use the dashboard Telegram Setup action."
            }
            Write-Detail "$message ($elapsed)" ([ConsoleColor]::Red)
            return [pscustomobject]@{
                ExitCode = 1
                Output   = $message
            }
        }

        $message = if ($toolkitTelegramConfigured) {
            "Telegram is disabled in toolkit config and not initialized in live config."
        }
        else {
            "Telegram is not configured in toolkit config or live config."
        }
        Write-Detail "$message ($elapsed)" ([ConsoleColor]::Yellow)
        return [pscustomobject]@{
            ExitCode = 0
            Output   = $message
        }
    }

    $liveTelegramEnabled = Test-TelegramChannelEnabled -TelegramConfig $liveTelegramConfig
    $liveTelegramHasCredentials = Test-TelegramCredentialConfigured -TelegramConfig $liveTelegramConfig
    $liveTelegramAccountCount = Get-TelegramAccountCount -TelegramConfig $liveTelegramConfig
    $liveTelegramGroupCount = Get-TelegramGroupCount -TelegramConfig $liveTelegramConfig
    $lines = New-Object System.Collections.Generic.List[string]
    $hasIssue = $false

    if ($toolkitTelegramEnabled) {
        [void]$lines.Add("PASS: Toolkit config enables Telegram.")
        if (-not $toolkitTelegramHasCredentials) {
            [void]$lines.Add("INFO: Toolkit config leaves Telegram credentials external; live config must be populated via telegram-setup or prior onboarding.")
        }
    }
    elseif ($toolkitTelegramConfigured) {
        [void]$lines.Add("INFO: Toolkit config does not enable Telegram.")
    }
    else {
        [void]$lines.Add("INFO: Toolkit config has no Telegram section.")
    }

    if ($liveTelegramEnabled) {
        [void]$lines.Add("PASS: Live config enables Telegram.")
    }
    else {
        $message = "Live config contains channels.telegram but it is not enabled."
        if ($toolkitTelegramEnabled) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $message")
        }
        else {
            [void]$lines.Add("INFO: $message")
        }
    }

    if ($liveTelegramHasCredentials) {
        [void]$lines.Add("PASS: Live config has Telegram credentials (masked in report).")
    }
    else {
        $message = "Live config is missing a Telegram bot token or token file."
        if ($toolkitTelegramEnabled -or $liveTelegramEnabled) {
            $hasIssue = $true
            [void]$lines.Add("FAIL: $message")
        }
        else {
            [void]$lines.Add("INFO: $message")
        }
    }

    if ($liveTelegramConfig.PSObject.Properties.Name -contains "dmPolicy" -and $liveTelegramConfig.dmPolicy) {
        [void]$lines.Add("DM policy: $([string]$liveTelegramConfig.dmPolicy)")
    }
    if ($liveTelegramConfig.PSObject.Properties.Name -contains "allowFrom") {
        [void]$lines.Add("Allowed DM senders: $(@($liveTelegramConfig.allowFrom).Count)")
    }
    if ($liveTelegramConfig.PSObject.Properties.Name -contains "groupPolicy" -and $liveTelegramConfig.groupPolicy) {
        [void]$lines.Add("Group policy: $([string]$liveTelegramConfig.groupPolicy)")
    }
    if ($liveTelegramConfig.PSObject.Properties.Name -contains "groupAllowFrom") {
        [void]$lines.Add("Allowed group senders: $(@($liveTelegramConfig.groupAllowFrom).Count)")
    }
    [void]$lines.Add("Configured groups: $liveTelegramGroupCount")
    if ($liveTelegramAccountCount -gt 0) {
        [void]$lines.Add("Configured accounts: $liveTelegramAccountCount")
    }

    $liveTelegramExecApprovals = if ($liveTelegramConfig.PSObject.Properties.Name -contains "execApprovals") { $liveTelegramConfig.execApprovals } else { $null }
    if ($null -ne $liveTelegramExecApprovals) {
        [void]$lines.Add("Exec approvals: $([bool]$liveTelegramExecApprovals.enabled)")
        [void]$lines.Add("Exec approvers: $(@($liveTelegramExecApprovals.approvers).Count)")
        if ($liveTelegramExecApprovals.PSObject.Properties.Name -contains "target" -and $liveTelegramExecApprovals.target) {
            [void]$lines.Add("Exec target: $([string]$liveTelegramExecApprovals.target)")
        }
    }

    $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
    if ($hasIssue) {
        Write-Detail "Telegram live config needs attention in $elapsed" ([ConsoleColor]::Red)
    }
    else {
        Write-Detail "Telegram setup status checked in $elapsed" ([ConsoleColor]::Green)
    }

    return [pscustomobject]@{
        ExitCode = if ($hasIssue) { 1 } else { 0 }
        Output   = ($lines -join [Environment]::NewLine)
    }
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

    $endpointKey = Get-AgentOllamaEndpointKey -Config $Config -AgentConfig $AgentConfig
    if ([string]::IsNullOrWhiteSpace($endpointKey)) {
        return $ModelRef
    }

    return (Convert-ToolkitLocalRefToEndpointRef -Config $Config -ModelRef $ModelRef -EndpointKey $endpointKey)
}

function Convert-NormalizedJson {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    return ($Value | ConvertTo-Json -Depth 50 -Compress)
}

function Convert-DisplayJson {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    if ($Value -is [string]) {
        return [string]$Value
    }

    return ($Value | ConvertTo-Json -Depth 50)
}

function Invoke-LoggedConfigLookup {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        $Document,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$UnavailableMessage,
        [string]$MissingMessage
    )

    if (-not $UnavailableMessage) {
        $UnavailableMessage = "Could not read live host config."
    }
    if (-not $MissingMessage) {
        $MissingMessage = "Config path not found: $Path"
    }

    Write-Step $Label
    $started = Get-Date

    if ($null -eq $Document) {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "$UnavailableMessage ($elapsed)" ([ConsoleColor]::Yellow)
        return [pscustomobject]@{
            ExitCode = 1
            Output   = $UnavailableMessage
        }
    }

    $value = Resolve-OpenClawConfigDocumentPathValue -Document $Document -Path $Path
    if ($null -eq $value) {
        $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
        Write-Detail "$MissingMessage ($elapsed)" ([ConsoleColor]::Yellow)
        return [pscustomobject]@{
            ExitCode = 1
            Output   = $MissingMessage
        }
    }

    $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
    Write-Detail "Collected from host config in $elapsed" ([ConsoleColor]::Green)
    return [pscustomobject]@{
        ExitCode = 0
        Output   = (Convert-DisplayJson -Value $value)
    }
}

function Get-ManagedDockerImageTags {
    param($BootstrapConfig)

    $tags = New-Object System.Collections.Generic.List[string]
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $gatewayImageTag = if ($null -ne $BootstrapConfig -and
        $BootstrapConfig.PSObject.Properties.Name -contains "sandbox" -and
        $null -ne $BootstrapConfig.sandbox -and
        $BootstrapConfig.sandbox.PSObject.Properties.Name -contains "gatewayImageTag" -and
        -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.sandbox.gatewayImageTag)) {
        [string]$BootstrapConfig.sandbox.gatewayImageTag
    }
    else {
        "openclaw:local"
    }
    if ($seen.Add($gatewayImageTag)) {
        $tags.Add($gatewayImageTag)
    }

    $sandboxBaseImage = if ($null -ne $BootstrapConfig -and
        $BootstrapConfig.PSObject.Properties.Name -contains "sandbox" -and
        $null -ne $BootstrapConfig.sandbox -and
        $BootstrapConfig.sandbox.PSObject.Properties.Name -contains "sandboxBaseImage" -and
        -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.sandbox.sandboxBaseImage)) {
        [string]$BootstrapConfig.sandbox.sandboxBaseImage
    }
    else {
        "openclaw-sandbox:bookworm-slim"
    }
    if ($seen.Add($sandboxBaseImage)) {
        $tags.Add($sandboxBaseImage)
    }

    $sandboxImage = if ($null -ne $BootstrapConfig -and
        $BootstrapConfig.PSObject.Properties.Name -contains "sandbox" -and
        $null -ne $BootstrapConfig.sandbox -and
        $BootstrapConfig.sandbox.PSObject.Properties.Name -contains "sandboxImage" -and
        -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.sandbox.sandboxImage)) {
        [string]$BootstrapConfig.sandbox.sandboxImage
    }
    else {
        "openclaw-sandbox-common:bookworm-slim"
    }
    if ($seen.Add($sandboxImage)) {
        $tags.Add($sandboxImage)
    }

    $voiceNotesEnabled = $true
    $voiceNotesMode = "local-whisper"
    $voiceGatewayImageTag = "openclaw:local-voice"
    if ($null -ne $BootstrapConfig -and $BootstrapConfig.PSObject.Properties.Name -contains "voiceNotes" -and $null -ne $BootstrapConfig.voiceNotes) {
        if ($BootstrapConfig.voiceNotes.PSObject.Properties.Name -contains "enabled") {
            $voiceNotesEnabled = [bool]$BootstrapConfig.voiceNotes.enabled
        }
        if ($BootstrapConfig.voiceNotes.PSObject.Properties.Name -contains "mode" -and -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.voiceNotes.mode)) {
            $voiceNotesMode = [string]$BootstrapConfig.voiceNotes.mode
        }
        if ($BootstrapConfig.voiceNotes.PSObject.Properties.Name -contains "gatewayImageTag" -and -not [string]::IsNullOrWhiteSpace([string]$BootstrapConfig.voiceNotes.gatewayImageTag)) {
            $voiceGatewayImageTag = [string]$BootstrapConfig.voiceNotes.gatewayImageTag
        }
    }

    if ($voiceNotesEnabled -and $voiceNotesMode -eq "local-whisper" -and $seen.Add($voiceGatewayImageTag)) {
        $tags.Add($voiceGatewayImageTag)
    }

    return $tags.ToArray()
}

function Get-ManagedDockerImageStatus {
    param(
        $BootstrapConfig,
        [bool]$DockerInstalled,
        [bool]$DockerReady,
        [bool]$BootstrapReady
    )

    $expectedTags = @(Get-ManagedDockerImageTags -BootstrapConfig $BootstrapConfig)
    $presentTags = New-Object System.Collections.Generic.List[string]
    $missingTags = New-Object System.Collections.Generic.List[string]
    $state = "ready"

    if (-not $DockerInstalled) {
        $state = "not installed"
        foreach ($tag in $expectedTags) {
            $missingTags.Add($tag)
        }
    }
    elseif (-not $DockerReady) {
        $state = "not ready"
        foreach ($tag in $expectedTags) {
            $missingTags.Add($tag)
        }
    }
    elseif (-not $BootstrapReady) {
        $state = "bootstrap not run yet"
        foreach ($tag in $expectedTags) {
            $missingTags.Add($tag)
        }
    }
    else {
        foreach ($tag in $expectedTags) {
            $probe = Invoke-External -FilePath "docker" -Arguments @("image", "inspect", $tag) -AllowFailure
            if ($probe.ExitCode -eq 0) {
                $presentTags.Add($tag)
            }
            else {
                $missingTags.Add($tag)
            }
        }

        if ($missingTags.Count -gt 0) {
            $state = "bootstrap not complete yet"
        }
    }

    return [pscustomobject]@{
        State        = $state
        ExpectedTags = $expectedTags
        PresentTags  = $presentTags.ToArray()
        MissingTags  = $missingTags.ToArray()
        Complete     = ($expectedTags.Count -eq 0 -or $missingTags.Count -eq 0)
    }
}

function Test-BindingMatch {
    param(
        $Binding,
        [Parameter(Mandatory = $true)][string]$AgentId,
        [Parameter(Mandatory = $true)][string]$Channel,
        [Parameter(Mandatory = $true)][string]$PeerKind,
        [Parameter(Mandatory = $true)][string]$PeerId
    )

    if ($null -eq $Binding -or $null -eq $Binding.match -or $null -eq $Binding.match.peer) {
        return $false
    }

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

    $authReadyProviders = @(Get-AuthReadyProvidersFromLiveConfig -LiveConfig $LiveConfig)

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
    if (-not ($LiveConfig.PSObject.Properties.Name -contains "auth") -or
        $null -eq $LiveConfig.auth -or
        -not ($LiveConfig.auth.PSObject.Properties.Name -contains "profiles") -or
        $null -eq $LiveConfig.auth.profiles) {
        return @()
    }

    foreach ($profile in @($LiveConfig.auth.profiles.PSObject.Properties.Value)) {
        if ($profile.provider) {
            $providers = Add-UniqueString -List $providers -Value ([string]$profile.provider)
        }
    }

    return @($providers)
}

function Resolve-ExpectedHostedCandidateModelRef {
    param(
        [string[]]$CandidateRefs = @(),
        [string[]]$AuthReadyProviders = @()
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

function Get-EnabledExtraAgentConfigs {
    param($MultiConfig)

    if ($null -eq $MultiConfig -or -not ($MultiConfig.PSObject.Properties.Name -contains "extraAgents") -or $null -eq $MultiConfig.extraAgents) {
        return @()
    }

    return @(
        foreach ($extraAgent in @($MultiConfig.extraAgents)) {
            if ($null -eq $extraAgent) {
                continue
            }

            $isEnabled = $true
            if ($extraAgent.PSObject.Properties.Name -contains "enabled" -and $null -ne $extraAgent.enabled) {
                $isEnabled = [bool]$extraAgent.enabled
            }
            if (-not $isEnabled) {
                continue
            }

            $extraAgent
        }
    )
}

function Test-ConfiguredAgentUsesSharedWorkspace {
    param(
        $MultiConfig,
        $AgentConfig
    )

    if ($null -eq $MultiConfig -or -not ($MultiConfig.sharedWorkspace -and $MultiConfig.sharedWorkspace.enabled)) {
        return $false
    }

    if ($null -ne $AgentConfig -and
        $AgentConfig.PSObject.Properties.Name -contains "workspaceMode" -and
        -not [string]::IsNullOrWhiteSpace([string]$AgentConfig.workspaceMode)) {
        return ([string]$AgentConfig.workspaceMode).ToLowerInvariant() -eq "shared"
    }

    return $true
}

function Get-ExpectedManagedModelRefs {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$LiveConfig
    )

    $actualModelAllowlist = @()
    if ($LiveConfig.agents.defaults.models) {
        $actualModelAllowlist = @($LiveConfig.agents.defaults.models.PSObject.Properties.Name | ForEach-Object { [string]$_ })
    }
    $availableLocalRefs = @(
        foreach ($modelRef in @($actualModelAllowlist)) {
            if ((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $modelRef) -or $modelRef -like "ollama/*") {
                [string]$modelRef
            }
        }
    )

    $refs = @()

    function Add-RefIfUsable {
        param(
            [string[]]$List,
            [string]$ModelRef
        )

        if ([string]::IsNullOrWhiteSpace($ModelRef)) {
            return @($List)
        }

        $modelRefText = [string]$ModelRef
        if (((Test-IsToolkitLocalModelRef -Config $Config -ModelRef $modelRefText) -or $modelRefText -like "ollama/*") -and ($modelRefText -notin @($availableLocalRefs))) {
            return @($List)
        }

        return @(Add-UniqueString -List $List -Value $modelRefText)
    }

    if ($LiveConfig.agents.defaults.model -and $LiveConfig.agents.defaults.model.primary) {
        $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$LiveConfig.agents.defaults.model.primary)
    }
    foreach ($agent in @($LiveConfig.agents.list)) {
        if ($agent -and $agent.model -and $agent.model.primary) {
            $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$agent.model.primary)
        }
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
    ) + @(Get-EnabledExtraAgentConfigs -MultiConfig $Config.multiAgent)

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

    foreach ($ref in @($availableLocalRefs)) {
        $refs = Add-RefIfUsable -List $refs -ModelRef ([string]$ref)
    }

    return @($refs)
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config not found: $ConfigPath"
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)
$config = Add-ToolkitLegacyMultiAgentView -Config $config
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
$liveConfig = Get-OpenClawConfigDocument -Config $config

$missingVerificationCommands = @(
    @{ Name = "curl.exe"; Required = (Test-CheckRequested -Names @("health")) },
    @{ Name = "docker"; Required = (Test-CheckRequested -Names @("docker", "models", "voice", "local-model", "agent", "sandbox", "chat-write", "audit")) },
    @{ Name = "tailscale"; Required = (Test-CheckRequested -Names @("tailscale")) },
    @{ Name = "git"; Required = (Test-CheckRequested -Names @("git")) }
) | Where-Object { $_.Required -and (-not (Test-CommandExists $_.Name)) } | ForEach-Object { $_.Name }

Write-Step "Collecting OpenClaw verification data"
Write-Detail "Config: $ConfigPath"
Write-Detail "Host config: $hostConfigPath"
Write-Detail "Report: $($config.verification.reportPath)"
foreach ($missingCommand in @($missingVerificationCommands)) {
    Write-Detail "Command not found: $missingCommand" ([ConsoleColor]::Yellow)
}
$health = New-SkippedExternalResult
if (Test-CheckRequested -Names @("health")) {
    $health = Invoke-LoggedExternal -Label "Gateway health check" -FilePath "curl.exe" -Arguments @("-s", $config.verification.healthUrl) -AllowFailure -SuccessSummary "Gateway health endpoint responded." -FailureSummary "Gateway health endpoint did not return success."
}
$dockerPs = New-SkippedExternalResult
$dockerEnvPaths = New-SkippedExternalResult
$managedImages = New-SkippedExternalResult
if (Test-CheckRequested -Names @("docker")) {
    $envFilePath = if ($config.envFilePath) { [string]$config.envFilePath } else { Join-Path $config.repoPath ".env" }
    $dockerEnvPaths = Invoke-LoggedEnvPathValidation -EnvFilePath $envFilePath -CurrentUserProfile ([System.IO.Path]::GetFullPath($env:USERPROFILE)) -Checks @(
        @{ Name = "OPENCLAW_CONFIG_DIR"; ExpectedPath = (Get-HostConfigDir -Config $config) },
        @{ Name = "OPENCLAW_WORKSPACE_DIR"; ExpectedPath = (Get-HostWorkspaceDir -Config $config) }
    )

    $dockerPs = Invoke-LoggedExternal -Label "Docker container status" -FilePath "docker" -Arguments @("ps", "--format", "table {{.Names}}`t{{.Status}}`t{{.Ports}}") -SuccessSummary "Docker responded with running container list."

    Write-Step "Managed Docker image completeness"
    $started = Get-Date
    $imageStatus = Get-ManagedDockerImageStatus -BootstrapConfig $config -DockerInstalled $true -DockerReady:($dockerPs.ExitCode -eq 0) -BootstrapReady:(Test-Path $hostConfigPath)
    $elapsed = Format-Duration -Elapsed ((Get-Date) - $started)
    if ($imageStatus.Complete) {
        Write-Detail "Managed image set is complete in $elapsed" ([ConsoleColor]::Green)
    }
    else {
        Write-Detail "Managed image set is incomplete in $elapsed" ([ConsoleColor]::Yellow)
    }
    $managedImageLines = @(
        "State: $($imageStatus.State)",
        "Present: $(if (@($imageStatus.PresentTags).Count -gt 0) { @($imageStatus.PresentTags) -join ', ' } else { '(none)' })",
        "Missing: $(if (@($imageStatus.MissingTags).Count -gt 0) { @($imageStatus.MissingTags) -join ', ' } else { '(none)' })"
    )
    $managedImages = [pscustomobject]@{
        ExitCode = if ($imageStatus.Complete) { 0 } else { 1 }
        Output   = ($managedImageLines -join [Environment]::NewLine)
    }
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
    $telegramConfig = Invoke-LoggedTelegramConfigCheck -BootstrapTelegramConfig $config.telegram -LiveConfig $liveConfig
}
$audioConfig = New-SkippedExternalResult
$audioBackendProbe = New-SkippedExternalResult
if (Test-CheckRequested -Names @("voice")) {
    $audioConfig = Invoke-LoggedConfigLookup -Label "Voice-notes config" -Document $liveConfig -Path "tools.media.audio" -UnavailableMessage "Could not read live host config for voice-note verification."
    $audioBackendProbe = Invoke-LoggedExternal -Label "Voice-note backend probe" -FilePath "docker" -Arguments @(
        "exec", "openclaw-openclaw-gateway-1",
        "sh", "-lc",
        'for cmd in whisper whisper-cli sherpa-onnx-offline ffmpeg; do if command -v "$cmd" >/dev/null 2>&1; then printf "%s: %s\n" "$cmd" "$(command -v "$cmd")"; fi; done'
    ) -AllowFailure -SuccessSummary "Collected available voice backend binaries." -FailureSummary "Could not probe voice backend binaries."
}
Reset-ToolkitVerificationCleanupModelRefs
$verificationExitCode = 1
$cleanupResult = [pscustomobject]@{
    Attempted = $false
    HasIssue  = $false
}
try {
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
if ((Test-CheckRequested -Names @("agent")) -and @((Get-ToolkitAssignedAgentList -Config $config)).Count -gt 0) {
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
if ((Test-CheckRequested -Names @("chat-write")) -and $config.multiAgent -and $config.multiAgent.localChatAgent -and (Test-ToolkitAgentEnabled -AgentConfig $config.multiAgent.localChatAgent) -and (Test-ToolkitAgentAssigned -Config $config -AgentConfig $config.multiAgent.localChatAgent)) {
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
    if ($config.multiAgent) {
        $activeAssignedAgentIds = @(
            foreach ($agent in @(Get-ToolkitAssignedAgentList -Config $config)) {
                if ($null -ne $agent -and $agent.id) {
                    [string]$agent.id
                }
            }
        )
        $multiAgentVerification += "Multi-agent starter layout: $(@($activeAssignedAgentIds).Count) active assigned agent(s)"

        if ($null -eq $liveConfig) {
            $multiAgentVerification += "FAIL: Could not read live host config at $hostConfigPath"
        }
        else {
        $authReadyProviders = @(Get-AuthReadyProvidersFromLiveConfig -LiveConfig $liveConfig)
        $expectedAgentIds = @($activeAssignedAgentIds)

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

        $expectedModelRefs = @(Get-ExpectedManagedModelRefs -Config $config -LiveConfig $liveConfig)

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
                $expectedRemoteReviewModels = @()
                foreach ($candidateRef in @($config.multiAgent.remoteReviewAgent.candidateModelRefs)) {
                    $expectedRemoteReviewModels = Add-UniqueString -List $expectedRemoteReviewModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteReviewAgent -ModelRef ([string]$candidateRef))
                }
                if ($config.multiAgent.remoteReviewAgent.modelRef) {
                    $expectedRemoteReviewModels = Add-UniqueString -List $expectedRemoteReviewModels -Value (Resolve-ExpectedConfiguredModelRef -Config $config -AgentConfig $config.multiAgent.remoteReviewAgent -ModelRef ([string]$config.multiAgent.remoteReviewAgent.modelRef))
                }
                $desiredRemoteReviewModel = if (@($expectedRemoteReviewModels).Count -gt 0) { [string]$expectedRemoteReviewModels[0] } else { [string]$config.multiAgent.remoteReviewAgent.modelRef }
                if ($remoteReviewAgent.model.primary -in @($expectedRemoteReviewModels)) {
                    $multiAgentVerification += "PASS: review-remote model is $($remoteReviewAgent.model.primary)"
                }
                elseif ($remoteReviewAgent.model.primary -like "ollama/*" -and $remoteReviewAgent.model.primary -in $actualModelAllowlist) {
                    $multiAgentVerification += "PASS: review-remote fell back from $desiredRemoteReviewModel to available local model $($remoteReviewAgent.model.primary)"
                }
                else {
                    $multiAgentVerification += "FAIL: review-remote model mismatch. Expected one of $(@($expectedRemoteReviewModels) -join ', ') or another available ollama/* model, got $($remoteReviewAgent.model.primary)"
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
                elseif ($remoteCoderAgent.model.primary -like "ollama/*" -and $remoteCoderAgent.model.primary -in $actualModelAllowlist) {
                    $multiAgentVerification += "PASS: coder-remote fell back from $desiredRemoteCoderModel to available local model $($remoteCoderAgent.model.primary)"
                }
                else {
                    $multiAgentVerification += "FAIL: coder-remote model mismatch. Expected one of $(@($expectedRemoteCoderModels) -join ', ') or another available ollama/* model, got $($remoteCoderAgent.model.primary)"
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

        $liveTelegramConfig = Resolve-OpenClawConfigDocumentPathValue -Document $liveConfig -Path "channels.telegram"
        if ($telegramRouteTargetAgentId) {
            if (-not (Test-TelegramChannelEnabled -TelegramConfig $liveTelegramConfig)) {
                $multiAgentVerification += "INFO: Telegram routing checks skipped because channels.telegram is not enabled in live config"
            }
            else {
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
        }

        if ($config.telegram -and $config.telegram.execApprovals) {
            if (-not (Test-TelegramChannelEnabled -TelegramConfig $liveTelegramConfig)) {
                $multiAgentVerification += "INFO: Telegram exec approval checks skipped because channels.telegram is not enabled in live config"
            }
            else {
                $liveTelegramExecApprovals = $liveTelegramConfig.execApprovals
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
        }

        $overlayDirName = "bootstrap"
        if ($config.PSObject.Properties.Name -contains "managedHooks" -and
            $config.managedHooks -and
            $config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
            $config.managedHooks.agentBootstrapOverlays -and
            $config.managedHooks.agentBootstrapOverlays.PSObject.Properties.Name -contains "overlayDirName" -and
            $config.managedHooks.agentBootstrapOverlays.overlayDirName) {
            $overlayDirName = [string]$config.managedHooks.agentBootstrapOverlays.overlayDirName
        }

        if ($config.PSObject.Properties.Name -contains "managedHooks" -and
            $config.managedHooks -and
            $config.managedHooks.PSObject.Properties.Name -contains "agentBootstrapOverlays" -and
            $config.managedHooks.agentBootstrapOverlays -and
            $config.managedHooks.agentBootstrapOverlays.enabled) {
            foreach ($activeAgent in @(Get-ToolkitAssignedAgentList -Config $config)) {
                if ([string]::IsNullOrWhiteSpace([string]$activeAgent.id)) {
                    continue
                }

                $overlayAgentsPath = Join-Path (Join-Path (Join-Path (Join-Path (Get-HostConfigDir -Config $config) "agents") ([string]$activeAgent.id)) $overlayDirName) "AGENTS.md"
                if (Test-Path $overlayAgentsPath) {
                    $multiAgentVerification += "PASS: Agent bootstrap overlay AGENTS.md exists for $([string]$activeAgent.id) at $overlayAgentsPath"
                }
                else {
                    $multiAgentVerification += "FAIL: Agent bootstrap overlay AGENTS.md is missing for $([string]$activeAgent.id) at $overlayAgentsPath"
                }
            }
        }

        if ($config.multiAgent.manageWorkspaceAgentsMd) {
            foreach ($workspace in @(Get-ToolkitWorkspaceList -Config $config)) {
                if ($null -eq $workspace -or
                    [string]::IsNullOrWhiteSpace([string]$workspace.id) -or
                    [string]::IsNullOrWhiteSpace([string]$workspace.path)) {
                    continue
                }

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

                $agentsFilePath = Join-Path (Resolve-HostWorkspacePath -Config $config -WorkspacePath ([string]$workspace.path)) "AGENTS.md"
                if (Test-Path $agentsFilePath) {
                    $multiAgentVerification += "PASS: Workspace AGENTS.md exists for $([string]$workspace.id) at $agentsFilePath"
                }
                else {
                    $multiAgentVerification += "FAIL: Workspace AGENTS.md is missing for $([string]$workspace.id) at $agentsFilePath"
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
if (Test-CheckRequested -Names @("docker")) {
    Add-ReportSection -Lines $reportLines -Title "Docker Env Paths" -Content $dockerEnvPaths.Output
    Add-ReportSection -Lines $reportLines -Title "Docker PS" -Content $dockerPs.Output
    Add-ReportSection -Lines $reportLines -Title "Managed Images" -Content $managedImages.Output
}
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
if (Test-CheckRequested -Names @("health")) { Write-SummaryStatusDetail -Label "Health" -Status $(if ($health.ExitCode -eq 0) { "PASS" } else { "FAIL" }) }
if (Test-CheckRequested -Names @("docker")) {
    Write-SummaryStatusDetail -Label "Docker env paths" -Status $(if ($dockerEnvPaths.ExitCode -eq 0) { 'PASS' } else { 'FAIL' })
    Write-SummaryStatusDetail -Label "Managed images" -Status $(if ($managedImages.ExitCode -eq 0) { 'PASS' } else { 'INFO/INCOMPLETE' })
}
if (Test-CheckRequested -Names @("telegram")) { Write-SummaryStatusDetail -Label "Telegram config" -Status $(if ($telegramConfig.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) }
if (Test-CheckRequested -Names @("voice")) { Write-SummaryStatusDetail -Label "Voice smoke test" -Status (Get-SmokeSummaryLabel -Output $voiceSmokeTestOutput -StructuredResult $null) }
if (Test-CheckRequested -Names @("local-model")) {
    Write-SummaryStatusDetail -Label "Local model smoke test" -Status (Get-SmokeSummaryLabel -Output $localModelSmokeTestOutput -StructuredResult $localModelSmokeStructured)
    if ($localModelSmokeStructured -and [string]$localModelSmokeStructured.status -eq "fail") {
        Write-Detail "Local model failure category: $($localModelSmokeStructured.category)" ([ConsoleColor]::Red)
        Write-Detail "Local model detail: $($localModelSmokeStructured.detail)" ([ConsoleColor]::Red)
    }
}
if (Test-CheckRequested -Names @("agent")) {
    Write-SummaryStatusDetail -Label "Agent capability smoke test" -Status (Get-SmokeSummaryLabel -Output $agentCapabilitiesSmokeTestOutput -StructuredResult $agentCapabilitiesSmokeStructured)
    if ($agentCapabilitiesSmokeStructured -and $agentCapabilitiesSmokeStructured.checks) {
        foreach ($check in @($agentCapabilitiesSmokeStructured.checks)) {
            $label = ("Agent check {0} ({1})" -f $check.name, $check.agentId)
            $status = [string]$check.status
            if ($status -eq "fail") {
                Write-Detail ("{0}: FAIL [{1}]" -f $label, $check.category) ([ConsoleColor]::Red)
                if ($check.targetModel) {
                    Write-Detail "Configured model for $($check.agentId): $($check.targetModel)" ([ConsoleColor]::Red)
                }
                if ($check.runtime) {
                    Write-Detail "Observed model for $($check.agentId): $($check.runtime)" ([ConsoleColor]::Red)
                }
                if ($check.detail) {
                    Write-Detail "Reason: $($check.detail)" ([ConsoleColor]::Red)
                }
            }
            elseif ($status -eq "pass") {
                $targetSuffix = if ($check.targetModel) { "; configured model $($check.targetModel)" } else { "" }
                $runtimeSuffix = if ($check.runtime) { "; observed model $($check.runtime)" } else { "" }
                Write-Detail ("{0}: PASS{1}{2}" -f $label, $targetSuffix, $runtimeSuffix) ([ConsoleColor]::Green)
            }
            else {
                $targetSuffix = if ($check.targetModel) { "; configured model $($check.targetModel)" } else { "" }
                Write-Detail ("{0}: SKIP/INFO{1} ({2})" -f $label, $targetSuffix, $check.detail) ([ConsoleColor]::Yellow)
            }
        }
    }
}
if (Test-CheckRequested -Names @("sandbox")) { Write-SummaryStatusDetail -Label "Sandbox smoke test" -Status $(if ($sandboxSmokeTestOutput -match 'passed') { 'PASS' } elseif ($sandboxSmokeTestOutput -match 'failed') { 'FAIL' } else { 'SKIP/INFO' }) }
if (Test-CheckRequested -Names @("chat-write")) { Write-SummaryStatusDetail -Label "Chat workspace write smoke test" -Status $(if ($chatWorkspaceWriteSmokeTestOutput -match 'passed') { 'PASS' } elseif ($chatWorkspaceWriteSmokeTestOutput -match 'failed') { 'FAIL' } else { 'SKIP/INFO' }) }
if (Test-CheckRequested -Names @("multi-agent")) { Write-SummaryStatusDetail -Label "Multi-agent verification" -Status $(if ((@($multiAgentVerification) -join ' ') -match 'FAIL:') { 'FAIL' } elseif ((@($multiAgentVerification) -join ' ') -match 'PASS:') { 'PASS' } else { 'INFO' }) }
if (Test-CheckRequested -Names @("context")) { Write-SummaryStatusDetail -Label "Context management verification" -Status $(if ((@($contextManagementVerification) -join ' ') -match 'FAIL:') { 'FAIL' } elseif ((@($contextManagementVerification) -join ' ') -match 'PASS:') { 'PASS' } else { 'INFO' }) }

$hasActionableIssues = $false
foreach ($result in @($health, $dockerEnvPaths, $dockerPs, $managedImages, $serveStatus, $funnelStatus, $modelsList, $modelsStatus, $telegramConfig, $audioConfig, $audioBackendProbe, $sandboxExplain, $audit, $gitStatus)) {
    if (Test-ResultHasIssue -Result $result) {
        $hasActionableIssues = $true
        break
    }
}

if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("voice")) -and (Get-SmokeSummaryLabel -Output $voiceSmokeTestOutput -StructuredResult $null) -eq "FAIL") {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("local-model")) -and (Get-SmokeSummaryLabel -Output $localModelSmokeTestOutput -StructuredResult $localModelSmokeStructured) -eq "FAIL") {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("agent")) -and (Get-SmokeSummaryLabel -Output $agentCapabilitiesSmokeTestOutput -StructuredResult $agentCapabilitiesSmokeStructured) -eq "FAIL") {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("sandbox")) -and $sandboxSmokeTestOutput -match 'failed') {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("chat-write")) -and $chatWorkspaceWriteSmokeTestOutput -match 'failed') {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("multi-agent")) -and ((@($multiAgentVerification) -join ' ') -match 'FAIL:')) {
    $hasActionableIssues = $true
}
if (-not $hasActionableIssues -and (Test-CheckRequested -Names @("context")) -and ((@($contextManagementVerification) -join ' ') -match 'FAIL:')) {
    $hasActionableIssues = $true
}

if ($hasActionableIssues) {
    Write-Host "Verification completed with actionable issues. Review the details above and the saved report." -ForegroundColor Yellow
}
Write-Host "Verification report written to $reportPath" -ForegroundColor Green
$verificationExitCode = if ($hasActionableIssues) { 2 } else { 0 }
}
finally {
    $cleanupResult = Invoke-RegisteredLocalModelCleanup -Config $config
    Reset-ToolkitVerificationCleanupModelRefs
}

if ($cleanupResult.HasIssue) {
    Write-Host "Verification cleanup could not confirm all local models were unloaded." -ForegroundColor Yellow
    if ($verificationExitCode -eq 0) {
        $verificationExitCode = 2
    }
}

exit $verificationExitCode

