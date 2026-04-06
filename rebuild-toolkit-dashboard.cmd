@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "DASHBOARD_DIR=%SCRIPT_DIR%dashboard"
set "UI_DIR=%DASHBOARD_DIR%\ui"

echo Rebuilding OpenClaw Toolkit Dashboard...
echo.

echo [1/3] Building UI (npm run build)...
pushd "%UI_DIR%"
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: UI build failed.
    popd
    exit /b %ERRORLEVEL%
)
popd
echo UI built successfully.
echo.

echo [2/3] Stopping existing dashboard server on port 18791...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :18791 ^| findstr LISTENING 2^>nul') do (
    echo   Killing PID %%a...
    taskkill /f /pid %%a > nul 2>&1
)
timeout /t 1 /nobreak > nul

echo [3/3] Starting backend server...
start /B "Toolkit Dashboard Backend" node "%DASHBOARD_DIR%\server.js"
timeout /t 2 /nobreak > nul

echo.
echo Dashboard rebuilt and restarted on http://127.0.0.1:18791
echo Refresh your browser tab to pick up the new build.
exit /b 0
