@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set OUT=%TEMP%\WebScada-diagnose.txt
echo Writing diagnose to:
echo   %OUT%
echo.

> "%OUT%" echo === WebScada diagnose %DATE% %TIME% ===
>>"%OUT%" echo CD=%CD%
>>"%OUT%" echo USER=%USERNAME%
>>"%OUT%" echo LOCALAPPDATA=%LOCALAPPDATA%
>>"%OUT%" echo TEMP=%TEMP%
>>"%OUT%" echo.
>>"%OUT%" echo --- dir listing ---
dir /b >>"%OUT%" 2>&1
>>"%OUT%" echo.
>>"%OUT%" echo --- node ---
if exist "runtime\node\node.exe" (
  >>"%OUT%" echo portable node exists
  "runtime\node\node.exe" -v >>"%OUT%" 2>&1
) else (
  >>"%OUT%" echo no portable node
)
where node >>"%OUT%" 2>&1
node -v >>"%OUT%" 2>&1
>>"%OUT%" echo.
>>"%OUT%" echo --- port 8787 ---
netstat -ano | findstr ":8787" >>"%OUT%" 2>&1
>>"%OUT%" echo.
>>"%OUT%" echo --- data\ ---
if exist "data\" (
  dir /b "data" >>"%OUT%" 2>&1
) else (
  >>"%OUT%" echo data folder missing
)
>>"%OUT%" echo.
>>"%OUT%" echo --- launch.log ---
if exist "%TEMP%\WebScada-launch.log" (
  type "%TEMP%\WebScada-launch.log" >>"%OUT%"
) else (
  >>"%OUT%" echo (no TEMP\WebScada-launch.log)
)
>>"%OUT%" echo.
>>"%OUT%" echo --- data\launch.log ---
if exist "data\launch.log" (
  type "data\launch.log" >>"%OUT%"
) else (
  >>"%OUT%" echo (no data\launch.log)
)
>>"%OUT%" echo.
>>"%OUT%" echo --- data\server.log ---
if exist "data\server.log" (
  type "data\server.log" >>"%OUT%"
) else (
  >>"%OUT%" echo (no data\server.log)
)

echo Done.
echo Send this file to support:
echo   %OUT%
echo.
start "" notepad "%OUT%"
pause
endlocal
