@echo off
setlocal
pwsh -ExecutionPolicy Bypass -File "%~dp0test-local-delegated-coder.ps1" %*
endlocal
