@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "FIXED_ARGS=-Confirm:$false"
"%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%..\scripts\reset-toolkit-config.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%


