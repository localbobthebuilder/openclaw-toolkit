@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "INSTALL_PS1=%SCRIPT_DIR%install-watchdog-task.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%INSTALL_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%INSTALL_PS1%" %*
)

endlocal
