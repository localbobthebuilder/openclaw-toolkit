@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\benchmark-pairing-repair.ps1" %*
pause

