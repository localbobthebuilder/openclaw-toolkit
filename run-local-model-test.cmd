@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
"%SCRIPT_DIR%invoke-toolkit-script.cmd" "%SCRIPT_DIR%test-local-models.ps1" "%~nx0" %*
exit /b %ERRORLEVEL%


