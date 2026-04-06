[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$ContainerName = "openclaw-openclaw-gateway-1",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

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

try {
    # Refresh PATH so newly linked tools are visible even if this process started earlier.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    if ($null -eq $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "Usage: .\run-openclaw.cmd cli [openclaw args]" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Examples:" -ForegroundColor Cyan
        Write-Host "  .\run-openclaw.cmd cli --version"
        Write-Host "  .\run-openclaw.cmd cli doctor"
        Write-Host "  .\run-openclaw.cmd cli gateway status"
        exit 0
    }

    $dockerCommand = Get-Command "docker" -ErrorAction SilentlyContinue
    if ($null -eq $dockerCommand) {
        throw "Docker is not installed on this machine, so the gateway OpenClaw CLI is unavailable."
    }

    $containerProbe = Invoke-External -FilePath $dockerCommand.Source -Arguments @("ps", "--format", "{{.Names}}") -AllowFailure
    if ($containerProbe.ExitCode -ne 0) {
        throw "Docker is not ready, so the gateway OpenClaw CLI is unavailable."
    }

    if (($containerProbe.Output -split "`r?`n") -notcontains $ContainerName) {
        throw "Gateway container '$ContainerName' is not running. Start OpenClaw first with $(Join-Path $PSScriptRoot 'run-openclaw.cmd') start"
    }

    $result = Invoke-External -FilePath $dockerCommand.Source -Arguments (@("exec", $ContainerName, "openclaw") + $Arguments) -AllowFailure
    if ($result.Output) {
        Write-Host $result.Output
    }
    exit ([int]$result.ExitCode)
}
catch {
    Write-Error $_
    exit 1
}
