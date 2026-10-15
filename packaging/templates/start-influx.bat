@echo off
REM Start embedded InfluxDB under %%SCADA_HOME%%\influxdb or %%LOCALAPPDATA%%\WebScada\influxdb
setlocal EnableExtensions
cd /d "%~dp0"
if not defined SCADA_HOME set "SCADA_HOME=%~dp0"
set "SCRIPT=%~dp0tools\embedded-influx.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%SCADA_HOME%scripts\embedded-influx.ps1"
if not exist "%SCRIPT%" (
  echo [WARN] embedded-influx.ps1 not found, skip InfluxDB
  endlocal & exit /b 0
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo [WARN] powershell missing, skip InfluxDB
  endlocal & exit /b 0
)
if exist "%~dp0influxdb\influxd.exe" set "SCADA_INFLUX_HOME=%~dp0influxdb"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action Start
if errorlevel 1 (
  echo [WARN] embedded InfluxDB start failed — history may be unavailable
  endlocal & exit /b 0
)
endlocal & (
  set "INFLUX_URL=http://127.0.0.1:8087"
  set "INFLUX_TOKEN=web-scada-dev-token"
  set "INFLUX_ORG=web-scada"
  set "INFLUX_BUCKET=tags"
  set "INFLUX_MEASUREMENT=tag_value"
  set "INFLUX_REQUIRED=false"
)
exit /b 0
