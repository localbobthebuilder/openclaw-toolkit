@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0benchmark-pairing-repair.ps1" %*
pause
