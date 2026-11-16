@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 22.5+ from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if exist "node_modules\.package-lock.json" (
  echo [OK] Dependencies already installed.
  pause
  exit /b 0
)
echo [INFO] Installing dependencies...
set PUPPETEER_SKIP_DOWNLOAD=1
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.
pause
exit /b 0
