' Starts the drop service with no window. Output goes to server.log in the repo folder.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run "cmd /c node server.js >> server.log 2>&1", 0, False
