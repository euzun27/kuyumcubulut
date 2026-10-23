#define MyAppName "Kuyumcu Takip"
#define MyAppVersion "1.0.0"
#define MyAppExeName "Kuyumcu Takip.exe"

[Setup]
AppId={{F6A938BB-CAC6-43CC-991F-B2B8C1D37A72}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\Kuyumcu Takip
DefaultGroupName={#MyAppName}
OutputDir=installer-dist
OutputBaseFilename=KuyumcuTakip-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "dist\Kuyumcu Takip\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Ek kısayollar:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} uygulamasını aç"; Flags: nowait postinstall skipifsilent
