@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo [KLS] Installing frontend dependencies...
  npm install
  if errorlevel 1 goto :error
)
echo [KLS] Starting frontend on http://localhost:5173
npm run dev:force
exit /b %errorlevel%
:error
echo [KLS] Frontend setup failed. See the error above.
pause
