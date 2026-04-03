@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BOOTSTRAP_PS1=%SCRIPT_DIR%bootstrap-openclaw.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%BOOTSTRAP_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%BOOTSTRAP_PS1%" %*
)

endlocal
