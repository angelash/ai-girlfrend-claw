@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo [lobster-adapter] installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
if exist dist\server.js (
  node dist\server.js
) else (
  call npm run dev
)
