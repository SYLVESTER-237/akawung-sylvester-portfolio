@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org , install it, then double-click this file again. & pause & exit /b)
if not exist node_modules call npm install
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
pause
