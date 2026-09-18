; Inno Setup 6 — 将 release\WebScada-*-win-x64 打成安装程序
; 先运行: pnpm pack:win
; 再用 Inno Setup Compiler 打开本文件并 Compile

#define MyAppName "弗莱德 Web 组态"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "弗莱德"
#define MyAppURL "http://127.0.0.1:8787/designer"
#define SourceDir "..\release\WebScada-0.1.0-win-x64"

[Setup]
AppId={{A7C3E9D1-4B2F-4E8A-9C1D-8F6B5A4E3D2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\WebScada
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=WebScada-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; ShellExecute .bat (not CreateProcess). Keep console on failure via start.bat pause.
Name: "{group}\{#MyAppName}"; Filename: "{app}\start.bat"; WorkingDir: "{app}"
Name: "{group}\Stop service"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{group}\README"; Filename: "{app}\README.txt"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\start.bat"; Description: "Launch now"; Flags: shellexec nowait postinstall skipifsilent
