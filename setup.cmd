@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS, then reopen your terminal and run setup.cmd again.
  exit /b 1
)
node scripts\check-node.js
if errorlevel 1 exit /b 1
call npm ci
if errorlevel 1 exit /b 1
call npm run setup -- --local
exit /b %errorlevel%
