@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "SCADA_HOME=%~dp0"
set "SCADA_PACKAGED=1"
set "SCADA_PORT=8787"
if not defined SCADA_URL set "SCADA_URL=http://127.0.0.1:%SCADA_PORT%/designer"
set "SCADA_HEALTH=http://127.0.0.1:%SCADA_PORT%/api/health"
set "SCADA_LAUNCH_LOG=%TEMP%\WebScada-launch.log"
set "JAVA_EXE="
set "SCADA_WAIT_SEC=90"
title WebScada

if not exist "data" mkdir "data" 2>nul

call :log "=== start-java.bat begin ==="
call :log "dir=%CD%"

if exist "%~dp0jre\bin\java.exe" (
  set "JAVA_EXE=%~dp0jre\bin\java.exe"
  call :log "portable_jre=yes"
) else (
  call :log "portable_jre=no"
)

if defined JAVA_EXE goto :have_java
where java >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: java not found"
  echo [ERROR] Java not found.
  echo Install JDK/JRE 17+ OR use pack with portable JRE
  echo   ^(pnpm pack:win^).
  echo Expected: %CD%\jre\bin\java.exe
  goto :fail
)
set "JAVA_EXE=java"
:have_java
call :log "java_exe=%JAVA_EXE%"

"%JAVA_EXE%" -version >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: java not runnable"
  echo [ERROR] Java exists but cannot run: %JAVA_EXE%
  goto :fail
)

if not exist "%~dp0server.jar" (
  call :log "ERROR: server.jar missing"
  echo [ERROR] server.jar not found in:
  echo   %CD%
  goto :fail
)

echo. > "data\.write_test" 2>nul
if not exist "data\.write_test" (
  call :log "ERROR: data not writable"
  echo [ERROR] Cannot write data\ folder.
  goto :fail
)
del "data\.write_test" >nul 2>&1

where powershell >nul 2>&1
if errorlevel 1 (
  call :log "WARN: powershell missing, skip health check"
  goto :after_health
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri $env:SCADA_HEALTH -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match 'web-scada') { exit 0 } else { exit 2 } } catch { exit 1 }"
if not errorlevel 1 (
  call :log "already running, open browser"
  echo Already running. Opening %SCADA_URL%
  start "" "%SCADA_URL%"
  timeout /t 3 /nobreak >nul
  endlocal
  exit /b 0
)
:after_health

echo Stopping old WebScada java (server.jar) if any...
where powershell >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"name='java.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*server.jar*' } | ForEach-Object { Write-Host ('  stop PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800"
)

netstat -ano | findstr /R /C:":%SCADA_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  call :log "ERROR: port %SCADA_PORT% busy"
  echo [ERROR] Port %SCADA_PORT% is in use by another program.
  echo Run stop.bat or free the port, then retry.
  goto :fail
)

netsh advfirewall firewall delete rule name="WebScada 8787" >nul 2>&1
netsh advfirewall firewall add rule name="WebScada 8787" dir=in action=allow protocol=TCP localport=%SCADA_PORT% >nul 2>&1

echo Starting embedded MySQL (if present)...
call "%~dp0start-mysql.bat"
call :log "mysql_host=%MYSQL_HOST% port=%MYSQL_PORT%"

echo Starting embedded InfluxDB (if present)...
if exist "%~dp0start-influx.bat" call "%~dp0start-influx.bat"
call :log "influx_url=%INFLUX_URL%"

echo Starting WebScada (Java)...
echo Dir: %CD%
echo Open: %SCADA_URL%
echo Log: data\server.log
echo Waiting up to %SCADA_WAIT_SEC%s for ready...
echo.
call :log "starting server.jar"

if exist "data\server.log" del "data\server.log" >nul 2>&1

set "SCADA_DATA=%~dp0data"
set "SCADA_WEB_ROOT=%~dp0public"
set "PORT=%SCADA_PORT%"
set "HOST=0.0.0.0"
if not defined MYSQL_HOST set "MYSQL_HOST=127.0.0.1"
if not defined MYSQL_PORT set "MYSQL_PORT=3306"
if not defined MYSQL_USER set "MYSQL_USER=root"
if not defined MYSQL_PASSWORD set "MYSQL_PASSWORD=root"
if not defined MYSQL_DATABASE set "MYSQL_DATABASE=web_scada"
if not defined INFLUX_URL set "INFLUX_URL=http://127.0.0.1:8087"
if not defined INFLUX_TOKEN set "INFLUX_TOKEN=web-scada-dev-token"
if not defined INFLUX_ORG set "INFLUX_ORG=web-scada"
if not defined INFLUX_BUCKET set "INFLUX_BUCKET=tags"
if not defined INFLUX_MEASUREMENT set "INFLUX_MEASUREMENT=tag_value"

start "WebScada-Server" /min cmd /c "set MYSQL_HOST=%MYSQL_HOST%&& set MYSQL_PORT=%MYSQL_PORT%&& set MYSQL_USER=%MYSQL_USER%&& set MYSQL_PASSWORD=%MYSQL_PASSWORD%&& set MYSQL_DATABASE=%MYSQL_DATABASE%&& set MYSQL_FALLBACK_FILE=%MYSQL_FALLBACK_FILE%&& set INFLUX_URL=%INFLUX_URL%&& set INFLUX_TOKEN=%INFLUX_TOKEN%&& set INFLUX_ORG=%INFLUX_ORG%&& set INFLUX_BUCKET=%INFLUX_BUCKET%&& set INFLUX_MEASUREMENT=%INFLUX_MEASUREMENT%&& set SCADA_DATA=%SCADA_DATA%&& set SCADA_WEB_ROOT=%SCADA_WEB_ROOT%&& set PORT=%PORT%&& set HOST=%HOST%&& "%JAVA_EXE%" -jar "%~dp0server.jar" 1>>"%~dp0data\server.log" 2>&1"
if errorlevel 1 (
  call :log "ERROR: start command failed"
  echo [ERROR] Failed to start server.jar
  goto :fail
)

REM Poll /api/health — Spring often needs >3s (MySQL probe, cold start)
set /a _left=%SCADA_WAIT_SEC%
:wait_loop
where powershell >nul 2>&1
if errorlevel 1 goto :wait_netstat
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri $env:SCADA_HEALTH -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match 'web-scada') { exit 0 } else { exit 2 } } catch { exit 1 }"
if not errorlevel 1 goto :ready
goto :wait_tick

:wait_netstat
netstat -ano | findstr /R /C:":%SCADA_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 goto :ready

:wait_tick
if %_left% LEQ 0 goto :wait_fail
timeout /t 2 /nobreak >nul
set /a _left-=2
goto :wait_loop

:wait_fail
call :log "ERROR: not ready after %SCADA_WAIT_SEC%s"
echo [ERROR] Server did not become ready in %SCADA_WAIT_SEC%s.
if exist "data\server.log" (
  echo --------
  powershell -NoProfile -Command "Get-Content -Path 'data\server.log' -Tail 40"
  echo --------
)
goto :fail

:ready
call :log "OK ready, open browser"
start "" "%SCADA_URL%"
echo Started OK.
timeout /t 4 /nobreak >nul
endlocal
exit /b 0

:fail
echo.
echo Log: %CD%\data\launch.log
if defined SCADA_LAUNCH_LOG echo Also: %SCADA_LAUNCH_LOG%
echo.
pause
endlocal
exit /b 1

:log
>>"%SCADA_LAUNCH_LOG%" echo [%DATE% %TIME%] %~1 2>nul
>>"data\launch.log" echo [%DATE% %TIME%] %~1 2>nul
exit /b 0
