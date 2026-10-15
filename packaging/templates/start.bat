@echo off
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0start-java.bat"
exit /b %ERRORLEVEL%
