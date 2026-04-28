@echo off
setlocal
call "%~dp0invoke-toolkit-script.cmd" "%~dp0..\scripts\clear-agent-sessions.ps1" "run-clear-agent-sessions.cmd" %*
