#!/usr/bin/env bash
# Bulut sürümünü (Hono + D1) eski Python sürümüyle karşılaştırır.
# Eski arayüzün dosya içeriğini denetleyen testler (TL alanları vb. bilerek değişti) dışarıda bırakılır.
# Eski testlerdeki ve rastgele senaryolardaki her API isteği iki sunucuya da
# gönderilir; cevaplar alan alan karşılaştırılır.
#   Gerekenler: Node 22+, Python 3.11+ ve legacy-python/requirements-dev.txt
#   Kullanım:  scripts/parity.sh            (FUZZ_SEEDS=60 FUZZ_STEPS=150 ile daha uzun)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
WORK=$(mktemp -d)
trap 'kill ${SERVER:-} 2>/dev/null || true; rm -rf "$WORK"' EXIT

node tests/build.mjs
PORT=${PORT:-8790} APP_TZ=Europe/Istanbul node tests/.build/server.mjs > "$WORK/server.log" 2>&1 &
SERVER=$!

cp -r legacy-python/. "$WORK/"
mkdir -p "$WORK/static" && cp -r public/static/. "$WORK/static/" && cp src/pages/*.html "$WORK/static/"
sleep 1
cd "$WORK"
TZ=Europe/Istanbul TS_URL="http://127.0.0.1:${PORT:-8790}" PARITY_OUT="$ROOT/parity.jsonl" \
  python3 -m pytest -q -p parity_plugin test_app.py test_stock_pool.py test_ui_settings.py test_fuzz_parity.py \
  -p no:cacheprovider -k "not login_rules and not passwordless and not mac_desktop and not frontend_flow_guards and not packaging_files and not frontend_layout_tabs" "$@" | grep -E "PARITY|passed|failed|FAILED|Error"
echo "Ayrıntı: $ROOT/parity.jsonl (yalnızca 'problems' dolu satırlar fark demektir)"
python3 -c "import json,sys; n=sum(1 for l in open(sys.argv[1]) if json.loads(l)['problems']); sys.exit(1 if n else 0)" "$ROOT/parity.jsonl"
