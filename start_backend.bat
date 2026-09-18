@echo off
setlocal
cd /d "%~dp0backend"
echo [KLS] Clearing any stale process on port 18080...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :18080 ^| findstr LISTENING') do taskkill /PID %%P /F >nul 2>&1

echo [KLS] Starting isolated electrical simulation backend on http://127.0.0.1:18080
if not exist .venv\Scripts\python.exe (
  py -m venv .venv
  if errorlevel 1 goto :error
  call .venv\Scripts\activate
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  if errorlevel 1 goto :error
) else (
  call .venv\Scripts\activate
)
python -m uvicorn main:app --host 127.0.0.1 --port 18080
exit /b %errorlevel%
:error
echo [KLS] Backend setup failed. See the error above.
pause
