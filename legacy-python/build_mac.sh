#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "Bu script macOS uzerinde calistirilmalidir."
  exit 1
fi

if ! python -c "import PyInstaller" >/dev/null 2>&1; then
  echo "PyInstaller kurulu degil. Once su komutu calistir:"
  echo "python -m pip install pyinstaller"
  exit 1
fi

ICON_WORKDIR="$(mktemp -d)"
trap 'rm -rf "$ICON_WORKDIR"' EXIT
ICONSET="$ICON_WORKDIR/KuyumcuTakip.iconset"
ICON_FILE="$ICON_WORKDIR/KuyumcuTakip.icns"
mkdir -p "$ICONSET"

sips -z 16 16 static/logo.png --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 static/logo.png --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 static/logo.png --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 static/logo.png --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 static/logo.png --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 static/logo.png --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 static/logo.png --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 static/logo.png --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 static/logo.png --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 static/logo.png --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$ICON_FILE"

python -m PyInstaller \
  --noconfirm \
  --clean \
  --windowed \
  --name "Kuyumcu Takip" \
  --icon "$ICON_FILE" \
  --add-data "static:static" \
  --collect-all webview \
  --collect-submodules uvicorn \
  --collect-submodules fastapi \
  --collect-submodules starlette \
  desktop.py

echo "Build tamamlandi: dist/Kuyumcu Takip.app"
echo "Bu .app paketi Python runtime ve gerekli Python bagimliliklarini icine alir."
