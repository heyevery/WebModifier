@echo off
title Web Modifier
cd /d "%~dp0"

if not exist "node_modules" (
    echo [First run] Installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo Dependency installation failed. Check your network and retry.
        pause
        exit /b 1
    )
)

echo Starting Web Modifier...
echo Close this window to quit the app.
echo.
call npm run dev

if errorlevel 1 (
    echo.
    echo App exited with an error. See messages above.
    pause
)