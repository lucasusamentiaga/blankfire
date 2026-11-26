' Blankfire · genera los vídeos de hoy sin abrir ninguna ventana (lo usa la tarea programada de Windows).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node make.mjs --today >> cola\registro.txt 2>&1", 0, False
