@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TARGET_PS1=%SCRIPT_DIR%test-agent-capabilities.ps1"
set "FIRST_ARG=%~1"

if /I "%FIRST_ARG%"=="help" goto :help
if /I "%FIRST_ARG%"=="-help" goto :help
if /I "%FIRST_ARG%"=="--help" goto :help
if /I "%FIRST_ARG%"=="-h" goto :help
if /I "%FIRST_ARG%"=="-?" goto :help
if "%FIRST_ARG%"=="/?" goto :help

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { & '%TARGET_PS1%' @args } catch { $message = if ($_.Exception -and -not [string]::IsNullOrWhiteSpace([string]$_.Exception.Message)) { [string]$_.Exception.Message.Trim() } else { ($_ | Out-String).Trim() }; Write-Host ('[FAIL] ' + $message) -ForegroundColor Red; exit 1 }" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { & '%TARGET_PS1%' @args } catch { $message = if ($_.Exception -and -not [string]::IsNullOrWhiteSpace([string]$_.Exception.Message)) { [string]$_.Exception.Message.Trim() } else { ($_ | Out-String).Trim() }; Write-Host ('[FAIL] ' + $message) -ForegroundColor Red; exit 1 }" %*
)

exit /b %ERRORLEVEL%

:help
call "%SCRIPT_DIR%invoke-toolkit-script.cmd" "%TARGET_PS1%" "%~nx0" help
exit /b %ERRORLEVEL%


