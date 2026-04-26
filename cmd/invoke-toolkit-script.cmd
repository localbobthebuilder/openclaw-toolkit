@echo off
setlocal EnableDelayedExpansion

set "TARGET_PS1=%~1"
set "WRAPPER_NAME=%~2"
shift
shift

if not exist "%TARGET_PS1%" (
  echo Script not found: %TARGET_PS1%
  exit /b 2
)

set "FIRST_ARG=%~1"
if /I "%FIRST_ARG%"=="help" goto :help
if /I "%FIRST_ARG%"=="-help" goto :help
if /I "%FIRST_ARG%"=="--help" goto :help
if /I "%FIRST_ARG%"=="-h" goto :help
if /I "%FIRST_ARG%"=="-?" goto :help
if "%FIRST_ARG%"=="/?" goto :help

set "FORWARD_ARGS="
:collect_args
if "%~1"=="" goto :dispatch
set "FORWARD_ARGS=!FORWARD_ARGS! %1"
shift
goto :collect_args

:dispatch

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  if defined FIXED_ARGS (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" %FIXED_ARGS%!FORWARD_ARGS!
  ) else (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" !FORWARD_ARGS!
  )
) else (
  if defined FIXED_ARGS (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" %FIXED_ARGS%!FORWARD_ARGS!
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" !FORWARD_ARGS!
  )
)

exit /b %ERRORLEVEL%

:help
set "HELP_PS1=%CD%\scripts\show-script-help.ps1"
if not exist "%HELP_PS1%" (
  echo Help script not found: %HELP_PS1%
  exit /b 2
)

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%HELP_PS1%" -ScriptPath "%TARGET_PS1%" -WrapperName "%WRAPPER_NAME%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HELP_PS1%" -ScriptPath "%TARGET_PS1%" -WrapperName "%WRAPPER_NAME%"
)

exit /b %ERRORLEVEL%





