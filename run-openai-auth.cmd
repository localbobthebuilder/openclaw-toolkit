@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "OPENAI_AUTH_PS1=%SCRIPT_DIR%openai-auth.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%OPENAI_AUTH_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%OPENAI_AUTH_PS1%" %*
)

endlocal
