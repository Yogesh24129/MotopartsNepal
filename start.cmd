@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS, then reopen your terminal and run start.cmd again.
  exit /b 1
)
node scripts\check-node.js
if errorlevel 1 exit /b 1
if not exist "node_modules\express\package.json" (
  call npm ci
  if errorlevel 1 exit /b 1
)
if not exist ".env" (
  call npm run setup -- --local
  if errorlevel 1 exit /b 1
)
call npm start
exit /b %errorlevel%
