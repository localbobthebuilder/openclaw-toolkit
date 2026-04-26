@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TARGET_PS1=%SCRIPT_DIR%..\scripts\test-agent-capabilities.ps1"
set "FIRST_ARG=%~1"

if /I "%FIRST_ARG%"=="help" goto :help
if /I "%FIRST_ARG%"=="-help" goto :help
if /I "%FIRST_ARG%"=="--help" goto :help
if /I "%FIRST_ARG%"=="-h" goto :help
if /I "%FIRST_ARG%"=="-?" goto :help
if "%FIRST_ARG%"=="/?" goto :help

call "%SCRIPT_DIR%invoke-toolkit-script.cmd" "%TARGET_PS1%" "%~nx0" %*
exit /b %ERRORLEVEL%

:help
call "%SCRIPT_DIR%invoke-toolkit-script.cmd" "%TARGET_PS1%" "%~nx0" help
exit /b %ERRORLEVEL%



