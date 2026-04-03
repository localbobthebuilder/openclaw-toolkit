@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PREREQ_PS1=%SCRIPT_DIR%ensure-windows-prereqs.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%PREREQ_PS1%" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%PREREQ_PS1%" %*
)

endlocal
