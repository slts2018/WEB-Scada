@echo off
cd /d "%~dp0"
echo Stopping WebScada...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"name='java.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*server.jar*' } | ForEach-Object { Write-Host ('  stop java PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "$home = $env:SCADA_MYSQL_HOME; if (-not $home) { $home = Join-Path $env:LOCALAPPDATA 'WebScada\mysql' }; $beside = Join-Path (Get-Location) 'mysql'; if (Test-Path (Join-Path $beside 'bin\mysqld.exe')) { $home = $beside }; Get-CimInstance Win32_Process -Filter \"name='mysqld.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ('*' + $home + '*') } | ForEach-Object { Write-Host ('  stop mysqld PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "$ih = $env:SCADA_INFLUX_HOME; if (-not $ih) { $ih = Join-Path $env:LOCALAPPDATA 'WebScada\influxdb' }; $ib = Join-Path (Get-Location) 'influxdb'; if (Test-Path (Join-Path $ib 'influxd.exe')) { $ih = $ib }; Get-CimInstance Win32_Process -Filter \"name='influxd.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ('*' + $ih + '*') } | ForEach-Object { Write-Host ('  stop influxd PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Done.
pause
