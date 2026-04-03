@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "AGENTS_PS1=%SCRIPT_DIR%configure-agent-layout.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%AGENTS_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%AGENTS_PS1%" %*
)

endlocal
