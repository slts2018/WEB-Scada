@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "SCADA_HOME=%~dp0"
set "SCADA_PACKAGED=1"
set "SCADA_PORT=8787"
set "SCADA_URL=http://127.0.0.1:%SCADA_PORT%/designer"
set "SCADA_HEALTH=http://127.0.0.1:%SCADA_PORT%/api/health"
set "SCADA_LAUNCH_LOG=%TEMP%\WebScada-launch.log"
set "NODE_EXE="
title WebScada

REM ASCII-only bat: UTF-8 Chinese breaks cmd.exe parse

if not exist "data" mkdir "data" 2>nul

call :log "=== start.bat begin ==="
call :log "dir=%CD%"
call :log "user=%USERNAME%"
call :log "temp_ok"

if exist "%~dp0runtime\node\node.exe" (
  set "NODE_EXE=%~dp0runtime\node\node.exe"
  call :log "portable_node=yes"
) else (
  call :log "portable_node=no"
)

if defined NODE_EXE goto :have_node
where node >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: node not found"
  echo [ERROR] Node.js not found.
  echo Install Node 20+ OR use pack with portable Node
  echo   ^(pnpm pack:win:node / pack:setup^).
  echo Expected: %CD%\runtime\node\node.exe
  echo Dir: %CD%
  goto :fail
)
set "NODE_EXE=node"
:have_node
call :log "node_exe=%NODE_EXE%"

"%NODE_EXE%" -v >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: node not runnable"
  echo [ERROR] Node exists but cannot run: %NODE_EXE%
  goto :fail
)

if not exist "%~dp0server.mjs" (
  call :log "ERROR: server.mjs missing"
  echo [ERROR] server.mjs not found in:
  echo   %CD%
  goto :fail
)

echo. > "data\.write_test" 2>nul
if not exist "data\.write_test" (
  call :log "ERROR: data not writable"
  echo [ERROR] Cannot write data\ folder.
  echo Install to a writable path e.g. C:\WebScada
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

echo Stopping old WebScada node (server.mjs) if any...
where powershell >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Write-Host ('  stop PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800"
)

netstat -ano | findstr /R /C:":%SCADA_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  call :log "ERROR: port %SCADA_PORT% busy"
  echo [ERROR] Port %SCADA_PORT% is in use by another program.
  echo Run stop.bat or free the port, then retry.
  goto :fail
)

REM Best-effort: allow inbound TCP (needs Admin; ignore failure)
netsh advfirewall firewall delete rule name="WebScada 8787" >nul 2>&1
netsh advfirewall firewall add rule name="WebScada 8787" dir=in action=allow protocol=TCP localport=%SCADA_PORT% >nul 2>&1
if errorlevel 1 (
  call :log "WARN: firewall rule not added (run as Admin or open TCP %SCADA_PORT% manually)"
) else (
  call :log "firewall rule WebScada 8787 ok"
)

echo Starting WebScada...
echo Dir: %CD%
echo Open: %SCADA_URL%
echo Log: data\server.log
echo.
call :log "starting server.mjs"

if exist "data\server.log" del "data\server.log" >nul 2>&1

start "WebScada-Server" /min cmd /c ""%NODE_EXE%" "%~dp0server.mjs" 1>>"%~dp0data\server.log" 2>&1"
if errorlevel 1 (
  call :log "ERROR: start command failed"
  echo [ERROR] Failed to start server.mjs
  goto :fail
)

timeout /t 2 /nobreak >nul

if exist "data\server.log" (
  findstr /i /c:"EADDRINUSE" /c:"listen EACCES" /c:"address already in use" "data\server.log" >nul 2>&1
  if not errorlevel 1 (
    call :log "ERROR: listen failed in server.log"
    echo [ERROR] Server failed to listen. Log:
    echo --------
    type "data\server.log"
    echo --------
    goto :fail
  )
)

netstat -ano | findstr /R /C:":%SCADA_PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: port not listening after 2s"
  echo [ERROR] Port %SCADA_PORT% not listening. Server may have exited.
  if exist "data\server.log" (
    echo --------
    type "data\server.log"
    echo --------
  ) else (
    echo data\server.log not created
  )
  goto :fail
)

call :log "OK listening, open browser"
start "" "%SCADA_URL%"
echo Started OK.
echo If blank page, refresh. Stop with stop.bat
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
