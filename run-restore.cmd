@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESTORE_PS1=%SCRIPT_DIR%restore-openclaw.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%RESTORE_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%RESTORE_PS1%" %*
)

endlocal
