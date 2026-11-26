# Blankfire · tarea de Windows que genera los dos vídeos del día (ES y EN) a las 08:30, sin ventanas.
# Si el PC está apagado a esa hora, los hace en cuanto se encienda. Para quitarla:
#   Unregister-ScheduledTask -TaskName "Blankfire TikTok" -Confirm:$false
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force (Join-Path $dir 'cola') | Out-Null
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$dir\lanzar-oculto.vbs`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 08:30
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Blankfire TikTok' -Action $action -Trigger $trigger -Settings $settings -Description 'Genera los vídeos de TikTok de Blankfire del día (gratis, en este PC).' -Force | Out-Null
"Tarea creada: todos los días a las 08:30."
