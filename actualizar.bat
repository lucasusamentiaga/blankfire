@echo off
chcp 65001 >nul
title Actualizar Blankfire
cd /d "%~dp0"
echo.
echo   Blankfire - descargando la ultima version de GitHub...
echo.
set NOGIT=0
where git >nul 2>nul || set NOGIT=1
if not exist ".git" set NOGIT=1
if "%NOGIT%"=="1" (
  echo   Esta carpeta no se descargo con Git.
  echo   Abro GitHub: descarga el ZIP y reemplaza la carpeta Fogueo por la nueva.
  start "" "https://github.com/lucasusamentiaga/blankfire/archive/refs/heads/main.zip"
  echo.
  pause
  exit /b 1
)
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   No se pudo actualizar automaticamente. Tus datos no se han tocado.
  echo   Prueba a descargar el ZIP desde GitHub.
  echo.
  pause
  exit /b 1
)
echo.
echo   Listo. Vuelve a Padre o a la ventana de Blankfire y pulsa "Recargar Blankfire".
echo.
pause
