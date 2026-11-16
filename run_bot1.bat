@echo off
setlocal
cd /d "%~dp0"
if exist ".\node.exe" (
  ".\node.exe" bot.js
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js not found. Use the portable build or install Node.js 22.5+.
    pause
    exit /b 1
  )
  node bot.js
)
set "BOT_EXIT=%errorlevel%"
if not "%BOT_EXIT%"=="0" (
  echo.
  echo [ERROR] Bot exited with error code %BOT_EXIT%.
)
pause
exit /b %BOT_EXIT%
