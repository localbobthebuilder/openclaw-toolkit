@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "UPDATE_PS1=%SCRIPT_DIR%update-openclaw.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%UPDATE_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%UPDATE_PS1%" %*
)

endlocal
