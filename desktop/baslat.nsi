; Masaüstü simgesinin açtığı küçük program: sunucuyu pencere göstermeden
; başlatır ve tarayıcıda portalı açar (sunucu zaten çalışıyorsa yalnızca açar).
Unicode true
Name "Dunyatek_Kuyumcu_Portal"
OutFile "${OUT}"
Icon "assets\dunyatek.ico"
SilentInstall silent
RequestExecutionLevel user
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Dunyatek Kuyumcu Portal"
VIAddVersionKey "CompanyName" "Dünyatek Bilişim"
VIAddVersionKey "FileDescription" "Dunyatek Kuyumcu Portal"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© Dünyatek Bilişim"

Section
  ExecShell "open" "$EXEDIR\DunyatekSunucu.exe" '--no-warnings "$EXEDIR\app\server.mjs" --ac' SW_HIDE
SectionEnd
