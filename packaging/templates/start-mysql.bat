@echo off
REM Start embedded MariaDB under %%SCADA_HOME%%\mysql or %%LOCALAPPDATA%%\WebScada\mysql
setlocal EnableExtensions
cd /d "%~dp0"
if not defined SCADA_HOME set "SCADA_HOME=%~dp0"
set "SCRIPT=%SCADA_HOME%scripts\embedded-mysql.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0scripts\embedded-mysql.ps1"
if not exist "%SCRIPT%" (
  REM packaged layout: mysql next to start.bat, helper copied as tools\embedded-mysql.ps1
  set "SCRIPT=%~dp0tools\embedded-mysql.ps1"
)
if not exist "%SCRIPT%" (
  echo [WARN] embedded-mysql.ps1 not found, skip MySQL
  endlocal & exit /b 0
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo [WARN] powershell missing, skip MySQL
  endlocal & exit /b 0
)
if exist "%~dp0mysql\bin\mysqld.exe" set "SCADA_MYSQL_HOME=%~dp0mysql"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action Start
if errorlevel 1 (
  echo [WARN] embedded MySQL start failed — server may fall back to file storage
  endlocal & exit /b 0
)
REM Export for parent cmd when called with call
endlocal & (
  set "MYSQL_HOST=127.0.0.1"
  set "MYSQL_PORT=3306"
  set "MYSQL_USER=root"
  set "MYSQL_PASSWORD=root"
  set "MYSQL_DATABASE=web_scada"
  set "MYSQL_FALLBACK_FILE=false"
)
exit /b 0
