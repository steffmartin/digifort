@echo off
if /i "%~1"=="--diagnostico" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-source.ps1" -Diagnostico
  if errorlevel 1 pause
  exit /b
)
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0scripts\start-source.vbs"
