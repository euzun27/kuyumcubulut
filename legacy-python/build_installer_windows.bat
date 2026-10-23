@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\Kuyumcu Takip\Kuyumcu Takip.exe" (
  echo Once build_windows.bat ile Windows uygulamasini olusturun.
  exit /b 1
)

set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo Inno Setup 6 bulunamadi. installer_windows.iss hazir; installer uretmek icin Inno Setup 6 kurun.
  exit /b 1
)

"%ISCC%" "installer_windows.iss"
if errorlevel 1 exit /b 1
echo Installer hazir: installer-dist\KuyumcuTakip-Setup-1.0.0.exe
