@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "DASHBOARD_DIR=%SCRIPT_DIR%dashboard"
set "UI_DIR=%DASHBOARD_DIR%\ui"
set "ACTION=%~1"

if /I "%ACTION%"=="stop" (
    echo Stopping OpenClaw Toolkit Dashboard...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :18791 ^| findstr LISTENING') do (
        echo Killing process %%a...
        taskkill /f /pid %%a > nul 2>&1
    )
    echo Dashboard stopped.
    goto :eof
)

echo Starting OpenClaw Toolkit Dashboard...

echo Checking for existing dashboard process on port 18791...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :18791 ^| findstr LISTENING') do (
    echo Killing existing process %%a...
    taskkill /f /pid %%a > nul 2>&1
)

if not exist "%UI_DIR%\dist" (
    echo UI dist not found. Building UI...
    pushd "%UI_DIR%"
    call npm run build
    popd
)

echo Starting backend server...
start /B "Toolkit Dashboard Backend" node "%DASHBOARD_DIR%\server.js"

echo Waiting for server to start...
timeout /t 2 /nobreak > nul

echo Opening dashboard in browser...
powershell.exe -NoProfile -Command "Start-Process 'http://127.0.0.1:18791'"

echo.
echo Dashboard is running. Close this window to stop the backend.
echo Press Ctrl+C to stop.
echo.

:loop
timeout /t 10 /nobreak > nul
goto :loop
