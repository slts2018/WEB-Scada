; Inno Setup 6 — 将 release\WebScada-*-win-x64-java 打成安装程序
; pnpm pack:setup

#define MyAppName "弗莱德 Web 组态"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "弗莱德"
#define MyAppURL "http://127.0.0.1:8787/designer"
#ifndef SourceDir
  #define SourceDir "..\release\WebScada-0.1.0-win-x64-java"
#endif
#ifndef SetupSuffix
  #define SetupSuffix ""
#endif

[Setup]
AppId={{A7C3E9D1-4B2F-4E8A-9C1D-8F6B5A4E3D2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\WebScada
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=WebScada-Setup-{#MyAppVersion}{#SetupSuffix}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
; 默认只会“请求退出”。mysqld / influxd 没有窗口，不会退出。
; force：仍占着文件的进程由安装程序结束。被结束的程序不由安装程序再拉起，装完走 launch.vbs。
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; launch.vbs shows a splash and starts the server with no console.
Name: "{group}\{#MyAppName}"; Filename: "{app}\launch.vbs"; WorkingDir: "{app}"
Name: "{group}\Stop"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{group}\README"; Filename: "{app}\README.txt"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\launch.vbs"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\launch.vbs"; Description: "Launch now"; Flags: shellexec nowait postinstall skipifsilent

[Code]
{ 拷贝文件前结束本机 WebScada 的 Java / MySQL / Influx。隐藏运行，不弹出命令行。
  只匹配安装目录、%LOCALAPPDATA%\WebScada，以及命令行里的 WebScada\mysql|influxdb。
  Java 只结束命令行含 server.jar 的进程，避免关掉别的 Java。 }
function SaveStopScript(const Path: String): Boolean;
var
  Lines: TArrayOfString;
begin
  SetArrayLength(Lines, 23);
  Lines[0] := 'param([Parameter(Mandatory=$true)][string]$AppDir)';
  Lines[1] := '$ErrorActionPreference = ''SilentlyContinue''';
  Lines[2] := 'function Match-Path([string]$Text, [string[]]$Needles) {';
  Lines[3] := '  if ([string]::IsNullOrEmpty($Text)) { return $false }';
  Lines[4] := '  foreach ($n in $Needles) {';
  Lines[5] := '    if (-not [string]::IsNullOrEmpty($n) -and $Text.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }';
  Lines[6] := '  }';
  Lines[7] := '  return $false';
  Lines[8] := '}';
  Lines[9] := '$local = Join-Path $env:LOCALAPPDATA ''WebScada''';
  Lines[10] := '$mysqlNeedles = @((Join-Path $local ''mysql''), (Join-Path $AppDir ''mysql''), ''WebScada\mysql'')';
  Lines[11] := '$influxNeedles = @((Join-Path $local ''influxdb''), (Join-Path $AppDir ''influxdb''), ''WebScada\influxdb'')';
  Lines[12] := 'Get-CimInstance Win32_Process | ForEach-Object {';
  Lines[13] := '  $name = $_.Name';
  Lines[14] := '  $blob = ([string]$_.ExecutablePath) + '' '' + ([string]$_.CommandLine)';
  Lines[15] := '  $stop = $false';
  Lines[16] := '  if (($name -eq ''java.exe'' -or $name -eq ''javaw.exe'') -and ($blob.IndexOf(''server.jar'', [StringComparison]::OrdinalIgnoreCase) -ge 0)) { $stop = $true }';
  Lines[17] := '  elseif ($name -eq ''mysqld.exe'' -and (Match-Path $blob $mysqlNeedles)) { $stop = $true }';
  Lines[18] := '  elseif ($name -eq ''influxd.exe'' -and (Match-Path $blob $influxNeedles)) { $stop = $true }';
  Lines[19] := '  if ($stop) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  Lines[20] := '}';
  Lines[21] := 'Start-Sleep -Seconds 1';
  Lines[22] := 'exit 0';
  Result := SaveStringsToFile(Path, Lines, False);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Script, Params: String;
  Code: Integer;
begin
  Result := '';
  Script := ExpandConstant('{tmp}\webscada-stop-before-install.ps1');
  if not SaveStopScript(Script) then
  begin
    Log('webscada: could not write stop script');
    Exit;
  end;
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + ExpandConstant('{app}') + '"';
  if not Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Log('webscada: powershell did not start')
  else
    Log('webscada: stop script exit ' + IntToStr(Code));
end;
