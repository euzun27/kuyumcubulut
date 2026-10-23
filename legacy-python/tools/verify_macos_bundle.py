"""Verify the real macOS bundle with a disposable database, never customer data."""
from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request


def verify(bundle: Path) -> None:
    if sys.platform != "darwin":
        raise SystemExit("Run bundle verification on macOS.")
    source = Path(__file__).resolve().parents[1]
    for name in ("app.js", "styles.css", "index.html", "login.html", "logo.png", "theme.js"):
        expected = hashlib.sha256((source / "static" / name).read_bytes()).digest()
        candidates = list(bundle.rglob(f"static/{name}"))
        assert candidates and all(hashlib.sha256(path.read_bytes()).digest() == expected for path in candidates), f"Stale or missing asset: {name}"
    assert not list(bundle.rglob("*.db")), "A customer database must not be packaged"
    executable = bundle / "Contents" / "MacOS" / "Kuyumcu Takip"
    with tempfile.TemporaryDirectory(prefix="kuyumcu-mac-smoke-") as temp:
        database = Path(temp) / "test.db"
        env = {**os.environ, "DB_PATH": str(database)}
        with (Path(temp) / "startup.log").open("w+") as log:
            process = subprocess.Popen([str(executable.resolve())], env=env, stdout=log, stderr=log)
            try:
                opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                base = None
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        log.seek(0)
                        raise AssertionError(f"App exited ({process.returncode}): {log.read()}")
                    listeners = subprocess.run(["lsof", "-nP", "-a", "-p", str(process.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], capture_output=True, text=True)
                    for line in listeners.stdout.splitlines():
                        if not line.startswith("n127.0.0.1:"):
                            continue
                        candidate = "http://" + line[1:]
                        try:
                            with opener.open(candidate + "/api/session", timeout=2) as response:
                                json.load(response)
                            base = candidate
                        except (OSError, ValueError):
                            pass
                    if base:
                        break
                    time.sleep(.5)
                assert base, "Packaged app did not start its local backend"
                with opener.open(urllib.request.Request(base + "/api/login", method="POST"), timeout=10) as response:
                    assert json.load(response)["status"] == "ok"
                for endpoint in ("/api/alis", "/api/satis", "/api/stok/normal", "/api/stok/hurda", "/api/giderler"):
                    with opener.open(base + endpoint, timeout=10) as response:
                        assert json.load(response)["data"] == [], endpoint
                with opener.open(base + "/api/dashboard", timeout=10) as response:
                    dashboard = json.load(response)["data"]
                    assert all(dashboard[key] == 0 for key in ("normal_stok_gram", "hurda_kalan_gram", "toplam_gider", "net_kar"))
                for name in ("app.js", "styles.css", "index.html", "login.html", "logo.png", "theme.js"):
                    url = base + ("/" if name == "index.html" else "/static/" + name)
                    with opener.open(url, timeout=10) as response:
                        assert response.read() == (source / "static" / name).read_bytes(), name
                with opener.open(base + "/api/uygulama-ayarlari", timeout=10) as response:
                    settings = json.load(response)["data"]
                    assert settings["backup_frequency"] == "daily" and settings["last_backup"]
                    assert settings["version"] == json.loads((source / "static/build-info.json").read_text())["version"]
                assert database.is_file(), "Disposable database was not created"
                assert process.poll() is None, "App closed during startup verification"
                print("macOS bundle passed: current assets, native app startup, login, clean database and API.")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
