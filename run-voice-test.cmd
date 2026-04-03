@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%SCRIPT_DIR%test-voice-notes.ps1" %*
  exit /b %ERRORLEVEL%
)

powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%test-voice-notes.ps1" %*
