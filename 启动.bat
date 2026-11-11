@echo off
cd /d "%~dp0"
set "PATH=C:\Users\11829\AppData\Local\nvm\v22.22.0;%PATH%"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"

echo 启动前端和后端。关掉本窗口即停止。
echo 设计端 http://localhost:5173/designer
echo 后端   http://127.0.0.1:8787
echo.
call pnpm dev
pause
