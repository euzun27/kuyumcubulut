@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python bulunamadi. Lutfen Python 3 kurup tekrar deneyin.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Sanal ortam olusturuluyor...
  python -m venv .venv
  if errorlevel 1 (
    echo Sanal ortam olusturulamadi.
    pause
    exit /b 1
  )
)

set "PY=.venv\Scripts\python.exe"

"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt pyinstaller
if errorlevel 1 (
  echo Paket kurulumu basarisiz oldu.
  pause
  exit /b 1
)

"%PY%" -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --windowed ^
  --name "Kuyumcu Takip" ^
  --add-data "static;static" ^
  --collect-submodules uvicorn ^
  --collect-submodules fastapi ^
  --collect-submodules starlette ^
  --exclude-module webview ^
  --exclude-module pythonnet ^
  --exclude-module clr ^
  --exclude-module clr_loader ^
  desktop.py

if errorlevel 1 (
  echo Build basarisiz oldu.
  pause
  exit /b 1
)

echo Build tamamlandi: dist\Kuyumcu Takip\Kuyumcu Takip.exe
echo Bu .exe paketi Python runtime ve gerekli Python bagimliliklarini icine alir.
pause
