@echo off
setlocal
set BASE=http://127.0.0.1:18080
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { $h=Invoke-WebRequest -UseBasicParsing '%BASE%/api/health'; Write-Host ('HEALTH ' + $h.StatusCode + ' ' + $h.Content); $s=Invoke-WebRequest -UseBasicParsing '%BASE%/api/v1/self-test'; Write-Host ('SELFTEST ' + $s.StatusCode); Write-Host $s.Content } catch { Write-Host ('KLS BACKEND CHECK FAILED: ' + $_.Exception.Message); exit 1 }"
pause
