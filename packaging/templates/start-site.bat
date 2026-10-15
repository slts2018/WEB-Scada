@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM Site package: open Runtime. Requires start-java.bat in the same folder.
set "SCADA_PORT=8787"
set "SCADA_URL=http://127.0.0.1:%SCADA_PORT%/runtime"

if not exist "%~dp0start-java.bat" (
  echo [ERROR] start-java.bat not found in:
  echo   %CD%
  pause
  exit /b 1
)

call "%~dp0start-java.bat"
exit /b %ERRORLEVEL%
