' Start a .cmd with no console window. The process keeps running after this script exits.
Option Explicit
Dim sh, cmd
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
cmd = "cmd.exe /c " & Chr(34) & WScript.Arguments(0) & Chr(34)
sh.Run cmd, 0, False
WScript.Quit 0
