@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "CLAUDE_AUTH_PS1=%SCRIPT_DIR%claude-auth.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%CLAUDE_AUTH_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%CLAUDE_AUTH_PS1%" %*
)

endlocal
