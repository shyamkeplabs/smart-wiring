@echo off
setlocal
cd /d "%~dp0"
echo [KLS] Launching isolated backend (18080) and frontend (5173)...
start "KLS Simulation Backend" cmd /k "call "%~dp0start_backend.bat""
timeout /t 2 /nobreak >nul
start "KLS Frontend" cmd /k "call "%~dp0start_frontend.bat""
timeout /t 1 /nobreak >nul
start "" http://localhost:5173
