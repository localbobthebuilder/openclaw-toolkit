@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "REPAIR_PS1=%SCRIPT_DIR%repair-dashboard-pairing.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%REPAIR_PS1%" -OpenDashboard %*
) else (
  powershell -ExecutionPolicy Bypass -File "%REPAIR_PS1%" -OpenDashboard %*
)

endlocal
