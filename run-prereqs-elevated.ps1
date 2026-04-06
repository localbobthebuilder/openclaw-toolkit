[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$scriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$prereqsScript = Join-Path $scriptDir "ensure-windows-prereqs.ps1"

function Test-IsAdministrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltinRole]::Administrator)
}

# --- Already elevated: run directly so output streams normally ---
if (Test-IsAdministrator) {
    & $prereqsScript
    exit $LASTEXITCODE
}

# --- Not elevated: try UAC elevation ---
# Use the current user's temp folder for the log/done/inner files.
# The elevated process runs as the same user (just with a full admin token), so it
# can write to $env:TEMP, and the non-elevated watcher can read from the same path.
$stamp    = Get-Date -Format 'yyyyMMddHHmmss'
$logFile  = Join-Path $env:TEMP "openclaw-prereqs-$stamp.log"
$doneFile = Join-Path $env:TEMP "openclaw-prereqs-$stamp.done"
$innerScript = Join-Path $env:TEMP "openclaw-prereqs-inner-$stamp.ps1"

# Build the inner script using string concatenation — avoids heredoc escape issues
# (backtick sequences like `r`n would be expanded inside @"..."@ heredocs, embedding
# literal CR/LF characters that break the script file syntax).
$lf = $logFile  -replace "'", "''"
$df = $doneFile -replace "'", "''"
$pf = $prereqsScript -replace "'", "''"

$innerScript = Join-Path $env:TEMP "openclaw-prereqs-inner-$stamp.ps1"

$innerLines = @(
    "`$logFile       = '$lf'",
    "`$doneFile      = '$df'",
    "`$prereqsScript = '$pf'",
    "",
    "# Signal to the watcher that the elevated process is alive",
    "'==> Elevated process started' | Set-Content `$logFile -Encoding utf8",
    "",
    "# Stream output line-by-line into the log file as it runs.",
    "# Using '& powershell.exe -File script' (not '& script') so that 'exit N' in",
    "# the script terminates the child powershell.exe process, not this elevated shell.",
    "try {",
    "    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `$prereqsScript 2>&1 |",
    "        ForEach-Object { `$_ | Add-Content `$logFile -Encoding utf8 }",
    "    `$LASTEXITCODE.ToString() | Set-Content `$doneFile -Encoding utf8",
    "} catch {",
    "    `"ERROR: `$_`" | Add-Content `$logFile -Encoding utf8",
    "    '1' | Set-Content `$doneFile -Encoding utf8",
    "}"
)
$innerLines -join [Environment]::NewLine | Set-Content -Path $innerScript -Encoding utf8

Write-Host ""
Write-Host "==> Requesting administrator elevation"
Write-Host "INFO: A small UAC or security prompt may appear. Please approve it."
Write-Host "INFO: Output will stream here once the elevated process starts."
Write-Host ""

$elevated = $null
try {
    $elevated = Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Minimized", "-File", $innerScript
    ) -PassThru   # Minimized: visible in taskbar (won't block UAC), closes when script exits
} catch {
    Write-Host "WARNING: Could not start elevated process: $_"
    Write-Host "WARNING: Falling back to non-elevated run."
    Write-Host ""
    Remove-Item $innerScript -Force -ErrorAction SilentlyContinue
    & $prereqsScript
    exit $LASTEXITCODE
}

# Quick sanity-check: if the process exits within 2s it almost certainly failed to launch
Start-Sleep -Seconds 2
if ($elevated.HasExited -and $elevated.ExitCode -ne 0 -and -not (Test-Path $logFile)) {
    Write-Host "WARNING: Elevated process exited immediately (code $($elevated.ExitCode))."
    Write-Host "WARNING: Falling back to non-elevated run."
    Write-Host ""
    Remove-Item $innerScript -Force -ErrorAction SilentlyContinue
    & $prereqsScript
    exit $LASTEXITCODE
}

# Wait up to 30s for the log file to appear (UAC prompt + startup time)
$deadline = (Get-Date).AddSeconds(30)
while (-not (Test-Path $logFile) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
}

if (-not (Test-Path $logFile)) {
    Write-Host "WARNING: Elevated process did not produce output within 30 seconds."
    Write-Host "WARNING: UAC may have been denied, or the process failed silently."
    Write-Host "WARNING: Falling back to non-elevated run — WSL2/DISM steps will be skipped."
    Write-Host ""
    Remove-Item $innerScript -Force -ErrorAction SilentlyContinue
    & $prereqsScript
    exit $LASTEXITCODE
}

# Helper: read new bytes from the shared log using FileShare.ReadWrite
function Read-NewContent {
    param([string]$Path, [ref]$Position)
    try {
        $fs = [System.IO.File]::Open($Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite)
        if ($fs.Length -gt $Position.Value) {
            [void]$fs.Seek($Position.Value, [System.IO.SeekOrigin]::Begin)
            $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
            $chunk  = $reader.ReadToEnd()
            $Position.Value = $fs.Length
            $reader.Dispose(); $fs.Dispose()
            return $chunk
        }
        $fs.Dispose()
    } catch {}
    return $null
}

# Tail the log file until the done file appears
$pos = [long]0
while (-not (Test-Path $doneFile)) {
    $chunk = Read-NewContent -Path $logFile -Position ([ref]$pos)
    if ($chunk) { Write-Host -NoNewline $chunk }
    Start-Sleep -Milliseconds 200
}

# Final drain
Start-Sleep -Milliseconds 600
$chunk = Read-NewContent -Path $logFile -Position ([ref]$pos)
if ($chunk) { Write-Host -NoNewline $chunk }

$exitCode = 0
if (Test-Path $doneFile) {
    try { $exitCode = [int](Get-Content $doneFile -Raw -Encoding utf8).Trim() } catch {}
}

Remove-Item $logFile     -Force -ErrorAction SilentlyContinue
Remove-Item $doneFile    -Force -ErrorAction SilentlyContinue
Remove-Item $innerScript -Force -ErrorAction SilentlyContinue

exit $exitCode
