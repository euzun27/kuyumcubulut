; Dunyatek_Kuyumcu_Portal Windows kurulumu (NSIS 3).
; desktop/build.mjs çalıştırır; OUT, VERSION ve PAKET dışarıdan gelir.
Unicode true
SetCompressor /SOLID lzma
ManifestDPIAware true

!define APP "Dunyatek_Kuyumcu_Portal"
!define APP_TITLE "Dünyatek Kuyumcu Portalı"
!define PUBLISHER "Dünyatek Bilişim"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"
!define YEDEK "C:\DUNYATEK_BACKUP"

Name "${APP_TITLE}"
OutFile "${OUT}"
InstallDir "C:\${APP}"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
BrandingText "${PUBLISHER}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_TITLE}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_TITLE} Kurulumu"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© ${PUBLISHER}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "assets\dunyatek.ico"
!define MUI_UNICON "assets\dunyatek.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "assets\kurulum-ust.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "assets\kurulum-ust.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\kurulum-yan.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "assets\kurulum-yan.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "${APP_TITLE} kurulumuna hoş geldiniz"
!define MUI_WELCOMEPAGE_TEXT "Bu sihirbaz ${APP_TITLE} $\r$\nsürüm ${VERSION} programını bilgisayarınıza kuracak.$\r$\n$\r$\nProgram internet olmadan da çalışır. Kayıtlarınız bu bilgisayarda saklanır, yedekler her gün otomatik olarak ${YEDEK} klasörüne yazılır.$\r$\n$\r$\nDaha önce kurduysanız yeni sürüm üzerine kurulur; kayıtlarınız silinmez.$\r$\n$\r$\nDevam etmek için İleri'ye tıklayın."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Kurulum tamamlandı"
!define MUI_FINISHPAGE_TEXT "${APP_TITLE} kuruldu. Masaüstündeki ${APP} simgesiyle açabilirsiniz.$\r$\n$\r$\nİlk açılışta yönetici hesabınızı oluşturun."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Programı şimdi aç"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Function OpenApp
  ExecShell "open" "$INSTDIR\${APP}.exe"
FunctionEnd

; Çalışan sunucuyu durdurur ki dosyalar güncellenebilsin.
!macro StopServer
  nsExec::Exec 'taskkill /F /IM DunyatekSunucu.exe'
  Pop $0
  Sleep 800
!macroend

Section "Program" SecMain
  SectionIn RO
  SetShellVarContext all
  !insertmacro StopServer

  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\app"
  File /r "${PAKET}\*.*"

  ; Kayıtlar ve yedekler: Windows kullanıcıları yazabilsin (S-1-5-32-545 = Users).
  CreateDirectory "$INSTDIR\Veri"
  CreateDirectory "${YEDEK}"
  nsExec::Exec 'icacls "$INSTDIR\Veri" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
  Pop $0
  nsExec::Exec 'icacls "${YEDEK}" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
  Pop $0

  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\dunyatek.ico" 0
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\dunyatek.ico" 0
  CreateShortcut "$SMPROGRAMS\${APP}\Yedek klasörü.lnk" "${YEDEK}"
  CreateShortcut "$SMPROGRAMS\${APP}\Kullanım Kılavuzu.lnk" "$INSTDIR\app\static\kilavuz\Dunyatek_Kuyumcu_Portal_Kullanim_Kilavuzu.pdf"
  CreateShortcut "$SMPROGRAMS\${APP}\Kaldır.lnk" "$INSTDIR\Kaldir.exe"

  WriteUninstaller "$INSTDIR\Kaldir.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP_TITLE}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "https://www.dunyatek.com"
  WriteRegStr HKLM "${UNINST_KEY}" "HelpTelephone" "0342 361 01 18"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\dunyatek.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Kaldir.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  !insertmacro StopServer
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\DunyatekSunucu.exe"
  Delete "$INSTDIR\${APP}.exe"
  Delete "$INSTDIR\dunyatek.ico"
  Delete "$INSTDIR\NODE-LICENSE.txt"
  Delete "$INSTDIR\Kaldir.exe"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  DeleteRegKey HKLM "${UNINST_KEY}"
  ; Veri ve yedek klasörleri bilerek silinmez.
  RMDir "$INSTDIR"
  MessageBox MB_OK|MB_ICONINFORMATION "Program kaldırıldı. Kayıtlarınız $INSTDIR\Veri ve yedekleriniz ${YEDEK} klasöründe duruyor. Yeniden kurduğunuzda kaldığınız yerden devam eder." /SD IDOK
SectionEnd
