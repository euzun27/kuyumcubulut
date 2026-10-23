from decimal import Decimal
import sqlite3

import pytest

import main
from test_app import make_client, login, ok


def setup_pool(client, kind):
    product = {"cinsi": "BILEZIK" if kind == "normal" else "HURDA", "ayar": "22"}
    path = "/api/alis" if kind == "normal" else "/api/hurda"
    purchases = []
    for name, gram, milyem, price, date in [("FIRST", 20, 900, 1000, "2026-10-01"), ("SECOND", 30, 920, 2000, "2026-10-02")]:
        payload = {**product, "gram": gram, "milyem": milyem, "has_fiyati": price, "tarih": date}
        payload.update({"tedarikci": name} if kind == "normal" else {"kisi": name, "islem_turu": "ALIS"})
        purchases.append(ok(client.post(path, json=payload)))
    sale = {**product, "gram": 50, "stoktan": True, "has_fiyati": 3000, "odeme_tipi": "HAS", "odenen_has": "0.5"}
    sale.update({"musteri": "CUSTOMER", "satis_milyem": 950} if kind == "normal" else {"kisi": "CUSTOMER", "islem_turu": "SATIS", "milyem": 950})
    return purchases, sale


def sale_path(kind):
    return "/api/satis" if kind == "normal" else "/api/hurda"


@pytest.mark.parametrize("kind", ["normal", "hurda"])
@pytest.mark.parametrize("stock_mode", [False, True])
def test_cari_decimal_difference_and_payments_independent_of_stock_mode(tmp_path, monkeypatch, kind, stock_mode):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    product = {"cinsi": "BILEZIK", "ayar": "22"}
    purchase = {**product, "gram": "3000", "milyem": "922.059", "odeme_tipi": "YOK"}
    purchase.update({"tedarikci": "ACCOUNT"} if kind == "normal" else {"kisi": "ACCOUNT", "islem_turu": "ALIS"})
    bought = ok(client.post("/api/alis" if kind == "normal" else "/api/hurda", json=purchase))
    sale = {**product, "gram": "2768.17", "stoktan": stock_mode, "odeme_tipi": "YOK"}
    sale.update({"musteri": "ACCOUNT", "satis_milyem": "1000"} if kind == "normal" else {"kisi": "ACCOUNT", "islem_turu": "SATIS", "milyem": "1000"})
    if not stock_mode:
        sale["alis_id" if kind == "normal" else "hurda_alis_id"] = bought["id"]
    ok(client.post(sale_path(kind), json=sale))

    def account():
        return next(row for row in ok(client.get("/api/cari"))["kisiler"] if row["isim"] == "ACCOUNT")

    row = account()
    assert row["toplam_alis_has"] == 2766.177
    assert row["toplam_satis_has"] == 2768.17
    assert row["net_bakiye_has"] == 1.993
    stock = ok(client.get(f"/api/stok/{kind}"))
    payment = ok(client.post("/api/cari/odeme", json={"isim": "ACCOUNT", "yon": "TAHSILAT", "odeme_tipi": "HAS", "odenen_has": "1"}))
    assert account()["net_bakiye_has"] == 0.993
    ok(client.put(f"/api/cari/odeme/{payment['id']}", json={"isim": "ACCOUNT", "yon": "ODEME", "odeme_tipi": "HAS", "odenen_has": "1"}))
    assert account()["net_bakiye_has"] == 2.993
    ok(client.delete(f"/api/cari/odeme/{payment['id']}"))
    assert account()["net_bakiye_has"] == 1.993
    assert ok(client.get(f"/api/stok/{kind}")) == stock


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_pool_cross_supplier_exact_total_profit_and_delete(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    purchases, payload = setup_pool(client, kind)
    options = ok(client.get(f"/api/stok/{kind}/secenekler"))
    assert len(options) == 1 and options[0]["kalan_gram"] == 50
    assert options[0]["kalan_has"] == 45.6
    assert all("tedarikci" not in row and "kisi" not in row for row in options)
    before = ok(client.get("/api/dashboard"))
    assert client.post(sale_path(kind), json={**payload, "gram": 51}).status_code == 400
    assert ok(client.get("/api/dashboard")) == before
    sale = ok(client.post(sale_path(kind), json=payload))
    assert sale["stoktan"] == 1
    assert sale["milyem_kari"] == 1.9
    assert sale["alis_milyem"] == 912
    assert sale["odenen_has"] == 0.5
    parts = sale["stok_dagilimi"]
    assert [part["purchase_id"] for part in parts] == [row["id"] for row in purchases]
    assert [Decimal(part["gram"]) for part in parts] == [Decimal(20), Decimal(30)]
    if kind == "normal":
        assert sale["alis_id"] is None and sale["purchase_id"] is None
        assert sale["alis_maliyeti"] == 73200
        assert sale["brut_kar"] == 69300
    else:
        assert sale["hurda_alis_id"] is None
        assert sale["hurda_kar"] == 69300
    stock = ok(client.get(f"/api/stok/{kind}"))[0]
    assert stock["kalan_gram"] == stock["kalan_has"] == stock["stok_degeri"] == 0
    assert stock["uyari"] == ""
    assert ok(client.get(f"/api/stok/{kind}/secenekler")) == []
    assert ok(client.get(f"/api/stok/{kind}/secenekler?exclude_sale_id={sale['id']}"))[0]["kalan_gram"] == 50
    expense = ok(client.post("/api/giderler", json={"tutar": "0.2", "kategori": "Yemek"}))
    assert ok(client.get("/api/dashboard"))["net_kar"] == 1.7
    assert ok(client.get(f"/api/stok/{kind}")) == [stock]
    ok(client.delete(f"/api/giderler/{expense['id']}"))
    ok(client.delete(f"{sale_path(kind)}/{sale['id']}"))
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_gram"] == 50
    assert ok(client.get("/api/dashboard"))["net_kar"] == 0
    with main.db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM sale_allocations").fetchone()[0] == 0


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_pool_edit_rollback_lot_guards_and_remaining_purity(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    purchases, payload = setup_pool(client, kind)
    first = ok(client.post(sale_path(kind), json={**payload, "gram": 25}))
    second = ok(client.post(sale_path(kind), json={**payload, "gram": 20}))
    assert first["alis_milyem"] == 904 and first["milyem_kari"] == 1.15
    assert second["alis_milyem"] == 920
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_has"] == 4.6
    snapshot = ok(client.get("/api/dashboard"))
    assert client.put(f"{sale_path(kind)}/{first['id']}", json={**payload, "gram": 31}).status_code == 400
    assert ok(client.get("/api/dashboard")) == snapshot
    first = ok(client.put(f"{sale_path(kind)}/{first['id']}", json={**payload, "gram": 30}))
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_gram"] == 0
    first = ok(client.put(f"{sale_path(kind)}/{first['id']}", json={**payload, "gram": 10}))
    stock = ok(client.get(f"/api/stok/{kind}"))[0]
    assert stock["kalan_gram"] == 20 and stock["kalan_has"] == 18.2
    assert stock["stok_degeri"] == 27400
    purchase_path = "/api/alis" if kind == "normal" else "/api/hurda"
    assert client.delete(f"{purchase_path}/{purchases[1]['id']}").status_code == 400
    reduced = {**purchases[0], "gram": 5, "milyem": 900}
    assert client.put(f"{purchase_path}/{purchases[0]['id']}", json=reduced).status_code == 400
    assert client.post("/api/cari/kisi/sil", json={"isim": "SECOND"}).status_code == 400
    third = ok(client.post(sale_path(kind), json={**payload, "gram": 15}))
    assert third["milyem_kari"] == 0.65
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_gram"] == 5


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_pool_note_edit_keeps_allocations_and_backup_restores_them(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    purchases, payload = setup_pool(client, kind)
    sale = ok(client.post(sale_path(kind), json={**payload, "gram": 25}))
    purchase_path = "/api/alis" if kind == "normal" else "/api/hurda"
    ok(client.put(f"{purchase_path}/{purchases[0]['id']}", json={**purchases[0], "has_fiyati": 5000}))
    edited = ok(client.put(f"{sale_path(kind)}/{sale['id']}", json={**payload, "gram": 25, "notlar": "NOTE ONLY"}))
    assert edited["stok_dagilimi"] == sale["stok_dagilimi"]
    assert edited["milyem_kari"] == sale["milyem_kari"]
    assert edited.get("alis_maliyeti", edited.get("hurda_kar")) == sale.get("alis_maliyeti", sale.get("hurda_kar"))
    baseline = ok(client.get("/api/dashboard"))
    ok(client.post("/api/backup"))
    ok(client.delete(f"{sale_path(kind)}/{sale['id']}"))
    ok(client.post("/api/restore-latest"))
    assert ok(client.get("/api/dashboard")) == baseline
    with main.db() as conn:
        assert len(main.allocation_rows(conn, kind, sale["id"])) == 2


def test_schema4_customer_upgrade_keeps_all_rows_reports_and_old_links(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    for kind in ("normal", "hurda"):
        purchases, payload = setup_pool(client, kind)
        payload.pop("stoktan")
        payload["gram"] = 5
        payload["alis_id" if kind == "normal" else "hurda_alis_id"] = purchases[0]["id"]
        ok(client.post(sale_path(kind), json=payload))
    ok(client.post("/api/giderler", json={"tutar": "0.2", "kategori": "Yemek", "notlar": "CUSTOMER DATA"}))
    ok(client.post("/api/cari/odeme", json={"isim": "CUSTOMER", "yon": "TAHSILAT", "odenen_has": "0.1"}))
    expected_dashboard = ok(client.get("/api/dashboard"))
    with main.db() as conn:
        conn.execute("DROP TRIGGER normal_allocation_delete")
        conn.execute("DROP TRIGGER scrap_allocation_delete")
        conn.execute("DROP TABLE sale_allocations")
        conn.execute("ALTER TABLE satis DROP COLUMN stoktan")
        conn.execute("ALTER TABLE hurda DROP COLUMN stoktan")
        conn.execute("UPDATE app_meta SET value='4' WHERE key='schema_version'")
        before = {table: [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY id")] for table in ("alis", "satis", "hurda", "giderler", "cari_odeme")}
    main.init_db()
    main.init_db()
    with main.db() as conn:
        for table, expected in before.items():
            rows = [{key: row[key] for key in expected[0]} for row in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
            assert rows == expected, table
        assert conn.execute("SELECT COUNT(*) FROM sale_allocations").fetchone()[0] == 0
    assert ok(client.get("/api/dashboard")) == expected_dashboard
    backups = list((tmp_path / "backups").glob("*pre_migration*.db"))
    assert backups
    with sqlite3.connect(backups[-1]) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT COUNT(*) FROM satis").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM giderler").fetchone()[0] == 1
    # A new stock sale also respects quantities already used by the customer's old sales.
    assert ok(client.get("/api/stok/normal/secenekler"))[0]["kalan_gram"] == 45


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_simultaneous_pool_sales_cannot_oversell(tmp_path, monkeypatch, kind):
    from concurrent.futures import ThreadPoolExecutor

    client = make_client(tmp_path, monkeypatch)
    login(client)
    _, payload = setup_pool(client, kind)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: client.post(sale_path(kind), json={**payload, "gram": 40}), range(2)))
    assert sorted(result.status_code for result in results) == [200, 400]
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_gram"] == 10


def test_fifo_uses_receipt_date_and_quantity_change_can_cross_lots(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    later = ok(client.post("/api/alis", json={"tedarikci": "LATER", "cinsi": "BILEZIK", "ayar": "22", "gram": 1, "milyem": 920, "tarih": "2026-10-10"}))
    older = ok(client.post("/api/alis", json={"tedarikci": "OLDER", "cinsi": "BILEZIK", "ayar": "22", "gram": 1, "milyem": 900, "tarih": "2026-10-01"}))
    payload = {"musteri": "C", "cinsi": "BILEZIK", "ayar": "22", "gram": "0.5", "satis_milyem": 950, "stoktan": True}
    sale = ok(client.post("/api/satis", json=payload))
    assert sale["stok_dagilimi"][0]["purchase_id"] == older["id"]
    assert sale["alis_milyem"] == 900
    sale = ok(client.put(f"/api/satis/{sale['id']}", json={**payload, "gram": "1.5"}))
    assert sale["milyem_kari"] == 0.065
    assert {part["purchase_id"] for part in sale["stok_dagilimi"]} == {later["id"], older["id"]}
    assert ok(client.get("/api/stok/normal"))[0]["kalan_has"] == 0.46


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_legacy_note_edit_does_not_convert_to_fifo(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    purchases, payload = setup_pool(client, kind)
    payload["stoktan"] = False
    payload["gram"] = 10
    payload["alis_id" if kind == "normal" else "hurda_alis_id"] = purchases[0]["id"]
    sale = ok(client.post(sale_path(kind), json=payload))
    dashboard = ok(client.get("/api/dashboard"))
    accounts = ok(client.get("/api/cari"))
    updated = ok(client.put(f"{sale_path(kind)}/{sale['id']}", json={**payload, "notlar": "CUSTOMER OLD RECORD"}))
    assert updated["stoktan"] == 0
    assert updated["milyem_kari"] == sale["milyem_kari"]
    assert updated["alis_id" if kind == "normal" else "hurda_alis_id"] == purchases[0]["id"]
    assert ok(client.get("/api/dashboard")) == dashboard
    assert ok(client.get("/api/cari")) == accounts
    with main.db() as conn:
        assert not main.allocation_rows(conn, kind, sale["id"])
    # The remaining stock includes both the historical receipt and the other supplier.
    new_sale = {**payload, "stoktan": True, "gram": 40}
    new_sale.pop("alis_id" if kind == "normal" else "hurda_alis_id")
    combined = ok(client.post(sale_path(kind), json=new_sale))
    assert len(combined["stok_dagilimi"]) == 2
    assert ok(client.get(f"/api/stok/{kind}"))[0]["kalan_gram"] == 0


def test_scrap_receipt_cannot_be_converted_into_its_own_stock_sale(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    purchases, sale = setup_pool(client, "hurda")
    before = ok(client.get("/api/dashboard"))
    assert client.put(f"/api/hurda/{purchases[0]['id']}", json=sale).status_code == 400
    assert ok(client.get("/api/dashboard")) == before



@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_manual_has_preserves_gram_stock_and_purity_profit(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    _, sale = setup_pool(client, kind)
    saved = ok(client.post(sale_path(kind), json={**sale, "has_override": "48.12345", "odeme_tipi": "TAM_KAPAT"}))
    assert saved["has"] == 48.123
    assert Decimal(saved["has_override"]) == Decimal("48.12345")
    assert saved["odenen_has"] == 48.123
    assert saved["milyem_kari"] == 1.9
    stock = ok(client.get(f"/api/stok/{kind}"))
    assert all(row["kalan_gram"] == 0 for row in stock)
    assert client.post(sale_path(kind), json={**sale, "gram": 1, "has_override": 0}).status_code == 400
    edited = ok(client.put(f"{sale_path(kind)}/{saved['id']}", json={**sale, "has_override": "48.12345", "notlar": "edited"}))
    assert Decimal(edited["has_override"]) == Decimal("48.12345")
    automatic = ok(client.put(f"{sale_path(kind)}/{saved['id']}", json=sale))
    assert automatic["has"] == 47.5
    assert client.put(f"{sale_path(kind)}/{saved['id']}", json={**sale, "has_override": -1}).status_code == 422


@pytest.mark.parametrize("kind", ["normal", "hurda"])
def test_purchase_manual_has_is_prorated_without_changing_grams(tmp_path, monkeypatch, kind):
    client = make_client(tmp_path, monkeypatch)
    login(client)
    product = {"cinsi": "BILEZIK", "ayar": "22", "gram": 10, "milyem": 900}
    path = "/api/alis" if kind == "normal" else "/api/hurda"
    purchase = {**product, "has_override": "8.98765"}
    purchase.update({"tedarikci": "S"} if kind == "normal" else {"kisi": "S", "islem_turu": "ALIS"})
    saved = ok(client.post(path, json=purchase))
    assert Decimal(saved["has_override"]) == Decimal("8.98765")
    sale = {**product, "gram": 5, "stoktan": True}
    sale.update({"musteri": "C", "satis_milyem": 950} if kind == "normal" else {"kisi": "C", "islem_turu": "SATIS", "milyem": 950})
    ok(client.post(sale_path(kind), json=sale))
    stock = ok(client.get(f"/api/stok/{kind}"))[0]
    assert stock["kalan_gram"] == 5
    assert stock["kalan_has"] == 4.494
