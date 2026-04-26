@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\benchmark-pairing-repair.ps1" %*
pause


