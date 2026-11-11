@echo off
cd /d "%~dp0"
set "PATH=C:\Users\11829\AppData\Local\nvm\v22.22.0;%PATH%"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"

echo 停止正在运行的后端（避免锁住 server.jar）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*web-scada-server*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo 开始打包
call pnpm pack:setup
if errorlevel 1 (
  echo 打包失败
  pause
  exit /b 1
)
echo.
echo 完成: %~dp0release\WebScada-Setup-0.1.0.exe
pause