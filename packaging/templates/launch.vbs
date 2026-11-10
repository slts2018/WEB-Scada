' ASCII-only: VBScript mis-parses UTF-8 Chinese as broken quotes (800A0409).
Option Explicit
Dim fso, sh, dir, tempLog, dataLog, bat, hta, flag, rc, msg, ageSec
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
tempLog = sh.ExpandEnvironmentStrings("%TEMP%\WebScada-launch.log")
dataLog = dir & "\data\launch.log"
bat = dir & "\start.bat"
hta = dir & "\splash.hta"
flag = dir & "\data\splash.run"

Sub AppendLog(path, line)
  On Error Resume Next
  Dim parent, ts
  parent = fso.GetParentFolderName(path)
  If Len(parent) > 0 And Not fso.FolderExists(parent) Then fso.CreateFolder parent
  Set ts = fso.OpenTextFile(path, 8, True)
  If Err.Number = 0 Then
    ts.WriteLine line
    ts.Close
  End If
  Err.Clear
  On Error Goto 0
End Sub

AppendLog tempLog, "=== launch.vbs " & Now & " ==="
AppendLog tempLog, "dir=" & dir
AppendLog tempLog, "bat=" & bat

If Not fso.FileExists(bat) Then
  msg = "start.bat not found:" & vbCrLf & bat & vbCrLf & vbCrLf & _
    "Shortcut may point to an uninstalled folder."
  AppendLog tempLog, "ERROR: start.bat missing"
  MsgBox msg, 16, "WebScada"
  WScript.Quit 1
End If

If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder dir & "\data"

' Second double-click while the first start is still in progress: keep the splash, do not start again.
If fso.FileExists(flag) Then
  ageSec = DateDiff("s", fso.GetFile(flag).DateLastModified, Now)
  If ageSec >= 0 And ageSec < 120 Then
    AppendLog tempLog, "already starting, ignore"
    WScript.Quit 0
  End If
End If

Dim ts
Set ts = fso.CreateTextFile(flag, True)
ts.WriteLine "1"
ts.Close

If fso.FileExists(hta) Then
  sh.Run "mshta.exe " & Chr(34) & hta & Chr(34), 1, False
End If

sh.CurrentDirectory = dir
rc = sh.Run("cmd.exe /c set SCADA_NO_PAUSE=1&& call " & Chr(34) & bat & Chr(34), 0, True)
AppendLog tempLog, "start.bat exitCode=" & rc
AppendLog dataLog, "start.bat exitCode=" & rc

If fso.FileExists(flag) Then fso.DeleteFile flag, True

If rc <> 0 Then
  msg = "Start failed (exit " & rc & ")." & vbCrLf & vbCrLf & _
    "Send these logs to support:" & vbCrLf & _
    tempLog & vbCrLf & _
    dataLog & vbCrLf & _
    dir & "\data\server.log"
  MsgBox msg, 16, "WebScada"
  WScript.Quit rc
End If

WScript.Quit 0
