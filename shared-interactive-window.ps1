function Get-ToolkitPowerShellExecutable {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }

    $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }

    return $null
}

function Test-ToolkitInteractiveConsole {
    try {
        return -not ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or [Console]::IsErrorRedirected)
    }
    catch {
        return $true
    }
}

function Restart-InInteractiveWindowIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [string[]]$Arguments = @(),
        [string]$WindowTitle = "OpenClaw Toolkit"
    )

    if (Test-ToolkitInteractiveConsole) {
        return $false
    }

    $psExe = Get-ToolkitPowerShellExecutable
    if (-not $psExe) {
        throw "Could not find PowerShell to relaunch $ScriptPath interactively."
    }

    $argumentList = @(
        "-NoExit",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $ScriptPath
    ) + $Arguments

    Start-Process -FilePath $psExe -ArgumentList $argumentList -WorkingDirectory (Split-Path -Parent $ScriptPath) | Out-Null

    Write-Host ""
    Write-Host "Interactive auth was launched in a new PowerShell window." -ForegroundColor Green
    Write-Host "Complete the flow there, then refresh the toolkit dashboard." -ForegroundColor Green
    return $true
}
