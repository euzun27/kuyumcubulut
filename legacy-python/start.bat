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

"%PY%" -c "import fastapi, uvicorn, webview" >nul 2>nul
if errorlevel 1 (
  echo Gerekli paketler kuruluyor...
  "%PY%" -m pip install --upgrade pip
  "%PY%" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Paket kurulumu basarisiz oldu.
    pause
    exit /b 1
  )
)

"%PY%" desktop.py
if errorlevel 1 (
  echo Uygulama baslatilamadi.
  pause
  exit /b 1
)
