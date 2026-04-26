@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "FIXED_ARGS=-Target tailscale -CopyToClipboard -PrintUrl"
"%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%scripts\open-dashboard.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%



