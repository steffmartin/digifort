@echo off
cd /d "%~dp0"
set "URL=http://127.0.0.1:4177/"
set "CHROME="

curl.exe --silent --fail "%URL%" >nul 2>&1
if not errorlevel 1 (
  echo A porta 4177 ja esta em uso. Encerre a outra janela do Digifort com Ctrl+C e tente novamente.
  pause
  exit /b 1
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME (
  echo Nao encontrei o Google Chrome nos caminhos padrao.
  pause
  exit /b 1
)

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\open-chrome-after-server.ps1" -Url "%URL%" -ChromePath "%CHROME%" -ProfilePath "%LOCALAPPDATA%\DigifortPlayer\ChromeProfile"

echo Iniciando Digifort Monitor. Os logs do servidor aparecem neste terminal.
npm start
if errorlevel 1 (
  echo.
  echo O servidor foi encerrado com erro. Confira a mensagem acima.
  pause
)
