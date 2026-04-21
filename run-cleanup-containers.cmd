@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
call "%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%cleanup-openclaw-containers.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%
