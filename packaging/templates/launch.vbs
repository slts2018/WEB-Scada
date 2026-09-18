' ASCII-only: VBScript mis-parses UTF-8 Chinese as broken quotes (800A0409).
Option Explicit
Dim fso, sh, dir, tempLog, dataLog, bat, rc, msg
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
tempLog = sh.ExpandEnvironmentStrings("%TEMP%\WebScada-launch.log")
dataLog = dir & "\data\launch.log"
bat = dir & "\start.bat"

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

sh.CurrentDirectory = dir
rc = sh.Run("cmd.exe /c call """ & bat & """", 1, True)
AppendLog tempLog, "start.bat exitCode=" & rc
AppendLog dataLog, "start.bat exitCode=" & rc

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
