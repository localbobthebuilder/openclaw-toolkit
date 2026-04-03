@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "START_PS1=%SCRIPT_DIR%start-openclaw.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%START_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%START_PS1%" %*
)

endlocal
