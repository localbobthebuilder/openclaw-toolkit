@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%remove-local-model.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%PS1%" %*
)

endlocal
