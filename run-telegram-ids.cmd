@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pwsh -ExecutionPolicy Bypass -File "%SCRIPT_DIR%inspect-telegram-ids.ps1" %*
  goto :eof
)

powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%inspect-telegram-ids.ps1" %*
