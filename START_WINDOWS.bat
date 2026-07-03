@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo SEO AEO GEO Live Checker
echo ============================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Node.js is not installed.
  echo Please install Node.js LTS from https://nodejs.org/
  echo After installing Node.js, double-click this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo npm was not found. Please reinstall Node.js LTS from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing required files. This may take a minute on the first run...
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo.
    echo npm install failed. Please check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting the tool...
echo The browser will open at http://localhost:3000
echo Keep this window open while you use the tool.
echo Press CTRL + C in this window to stop it.
echo.
start http://localhost:3000
call npm start
pause
