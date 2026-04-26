@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
"%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%scripts\openclaw-cli.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%

