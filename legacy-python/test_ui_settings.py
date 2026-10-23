import json
import sqlite3

import main
from test_app import make_client, login, ok


def snapshot():
    with sqlite3.connect(main.DB_PATH) as conn:
        return list(conn.iterdump())


def test_settings_are_separate_and_validated(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    assert client.get("/api/uygulama-ayarlari").status_code == 401
    assert client.put("/api/uygulama-ayarlari", json={"backup_frequency":"startup"}).status_code == 401
    login(client)
    ok(client.post("/api/alis", json={"tedarikci":"S", "cinsi":"BILEZIK", "ayar":"22", "gram":10,"milyem":900}))
    before = snapshot()
    data = ok(client.get("/api/uygulama-ayarlari"))
    assert data["backup_frequency"] == "daily" and data["last_backup"]
    for invalid in ["off", "weekly", "", "../database"]:
        assert client.put("/api/uygulama-ayarlari", json={"backup_frequency":invalid}).status_code == 422
    ok(client.put("/api/uygulama-ayarlari", json={"backup_frequency":"startup"}))
    assert ok(client.get("/api/uygulama-ayarlari"))["backup_frequency"] == "startup"
    assert snapshot() == before
    assert json.loads((tmp_path/"ui_settings.json").read_text())["backup_frequency"] == "startup"
    (tmp_path/"ui_settings.json").write_text("bad json")
    assert ok(client.get("/api/uygulama-ayarlari"))["backup_frequency"] == "daily"
    assert snapshot() == before


def test_startup_backup_keeps_daily_default_and_records(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    ok(client.post("/api/alis", json={"tedarikci":"S", "cinsi":"BILEZIK", "ayar":"22", "gram":10,"milyem":900}))
    ok(client.put("/api/uygulama-ayarlari", json={"backup_frequency":"startup"}))
    before = snapshot()
    main.init_db()
    first = len(list(main.backup_dir().glob("kuyumcu_startup_*.db")))
    main.init_db()
    assert len(list(main.backup_dir().glob("kuyumcu_startup_*.db"))) == first + 1
    assert snapshot() == before
    ok(client.put("/api/uygulama-ayarlari", json={"backup_frequency":"daily"}))
    main.init_db()
    assert len(list(main.backup_dir().glob("kuyumcu_startup_*.db"))) == first + 1
    assert len(list(main.backup_dir().glob("kuyumcu_daily_*.db"))) == 1
    assert all(main.database_integrity(p) for p in main.backup_dir().glob("*.db"))
    assert snapshot() == before
