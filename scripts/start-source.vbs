Option Explicit
Dim shell, files, script
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
script = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "start-source.ps1")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """", 0, False
