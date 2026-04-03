@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TEST_PS1=%SCRIPT_DIR%test-agent-capabilities.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%TEST_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%TEST_PS1%" %*
)

endlocal
