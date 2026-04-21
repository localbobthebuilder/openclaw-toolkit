@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
call "%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%invoke-agent-session.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%
