@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh -ExecutionPolicy Bypass -File "%SCRIPT_DIR%open-dashboard.ps1" -Target tailscale -CopyToClipboard -PrintUrl %*
  goto :eof
)

powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%open-dashboard.ps1" -Target tailscale -CopyToClipboard -PrintUrl %*
