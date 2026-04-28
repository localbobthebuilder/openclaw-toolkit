@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "DASHBOARD_DIR=%SCRIPT_DIR%..\dashboard"
set "UI_DIR=%DASHBOARD_DIR%\ui"
set "ACTION=%~1"
set "PORT=18792"
for /f "usebackq delims=" %%p in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%..\scripts\get-toolkit-dashboard-port.ps1"`) do set "PORT=%%p"

if /I "%ACTION%"=="stop" (
    echo Stopping OpenClaw Toolkit Dashboard...
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
        echo Killing process %%a...
        taskkill /f /pid %%a > nul 2>&1
    )
    echo Dashboard stopped.
    goto :eof
)

echo Starting OpenClaw Toolkit Dashboard...

echo Checking for existing dashboard process on port %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Killing existing process %%a...
    taskkill /f /pid %%a > nul 2>&1
)

if not exist "%UI_DIR%\dist" (
    echo UI dist not found. Building UI...
    pushd "%UI_DIR%"
    call npm run build
    popd
)

echo Opening dashboard in browser...
powershell.exe -NoProfile -Command "Start-Process 'http://127.0.0.1:%PORT%'"

echo.
echo Dashboard is running on http://127.0.0.1:%PORT%
echo Close this window or press Ctrl+C to stop.
echo.

:server_loop
echo Starting backend server...
node "%DASHBOARD_DIR%\server.js"
set EXIT_CODE=%ERRORLEVEL%
if "%EXIT_CODE%"=="0" (
    echo Server requested restart. Restarting in 1 second...
    timeout /t 1 /nobreak > nul
    goto :server_loop
)
echo Dashboard server stopped (exit code %EXIT_CODE%).
