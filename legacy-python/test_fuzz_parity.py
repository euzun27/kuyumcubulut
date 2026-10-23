import random
import pytest
from test_app import make_client, login

PRODUCTS = ["BILEZIK", "Bilezik", "KOLYE", "yüzük", "ÇEYREK", "HURDA", "b-hurda"]
TIPS = ["ODEME_YOK", "YOK", "HAS", "ADET_GRAM_MILYEM", "gram+milyem", "TAM_KAPAT"]
PEOPLE = ["Ali", "ALİ", "ayşe", "Ayşe ", "Mehmet Kuyum", "TEDARİK A", "tedarik a"]

def num(r, lo, hi, places):
    v = round(r.uniform(lo, hi), places)
    return r.choice([v, str(v), str(v).replace(".", ","), f" {v} "])

def tx(r):
    p = {"tarih": f"2026-0{r.randint(1, 9)}-{r.randint(10, 28)}", "cinsi": r.choice(PRODUCTS), "ayar": r.choice(["22", "14", "24"]),
         "gram": num(r, 0.01, 60, r.choice([0, 1, 2, 3])), "milyem": r.choice([916, 585, 995, 950, "916,5", num(r, 300, 1000, 1)]),
         "has_fiyati": num(r, 0, 4000, 2), "iscilik": num(r, 0, 300, 2), "odeme_tipi": r.choice(TIPS),
         "odenen_has": num(r, 0, 20, 3), "odenen_gram": num(r, 0, 20, 2), "odenen_milyem": r.choice([0, 916, 585]),
         "notlar": r.choice(["", "not", "a" * 10])}
    if r.random() < 0.15: p["has_override"] = num(r, 0, 50, 4)
    if r.random() < 0.05: p["gram"] = r.choice(["-1", "abc", ""])
    return p

def ids(client, path, key=None):
    data = client.get(path).json()["data"]
    if key: data = data[key]
    return [row["id"] for row in data] if isinstance(data, list) else []

@pytest.mark.parametrize("seed", range(int(__import__("os").environ.get("FUZZ_SEEDS", "12"))))
def test_random_ledger_parity(tmp_path, monkeypatch, seed):
    r = random.Random(seed)
    client = make_client(tmp_path, monkeypatch)
    login(client)
    for step in range(int(__import__("os").environ.get("FUZZ_STEPS", "70"))):
        op = r.choices(["alis", "satis", "hurda_alis", "hurda_satis", "cari", "gider", "edit", "delete", "rename"], [5, 5, 3, 3, 2, 1, 3, 1, 0.5])[0]
        if op == "alis":
            client.post("/api/alis", json={**tx(r), "tedarikci": r.choice(PEOPLE), "ek_masraf": num(r, 0, 100, 2), "odenen": num(r, 0, 5000, 2)})
        elif op == "satis":
            p = {**tx(r), "musteri": r.choice(PEOPLE), "ek_ucret": num(r, 0, 50, 2), "indirim": num(r, 0, 50, 2), "alinan": num(r, 0, 9000, 2)}
            if r.random() < 0.6: p["stoktan"] = True
            else:
                a = ids(client, "/api/alis")
                if a: p["alis_id"] = r.choice(a)
            if r.random() < 0.5: p["satis_milyem"] = r.choice([950, "", None, num(r, 500, 1000, 1)])
            client.post("/api/satis", json=p)
        elif op == "hurda_alis":
            client.post("/api/hurda", json={**tx(r), "islem_turu": r.choice(["ALIS", "alış"]), "kisi": r.choice(PEOPLE), "odenen_veya_alinan": num(r, 0, 3000, 2)})
        elif op == "hurda_satis":
            p = {**tx(r), "islem_turu": r.choice(["SATIS", "satış"]), "kisi": r.choice(PEOPLE), "odenen_veya_alinan": num(r, 0, 3000, 2)}
            if r.random() < 0.6: p["stoktan"] = True
            else:
                h = [row["id"] for row in client.get("/api/hurda").json()["data"]["kayitlar"] if row.get("islem_turu") == "ALIS"]
                if h: p["hurda_alis_id"] = r.choice(h)
            client.post("/api/hurda", json=p)
        elif op == "cari":
            client.post("/api/cari/odeme", json={"isim": r.choice(PEOPLE), "odeme_tipi": r.choice(["HAS", "ADET_GRAM_MILYEM", "TAM_KAPAT", "milyem"]),
                                                 "yon": r.choice(["OTOMATIK", "TAHSILAT", "ODEME"]), "odenen_has": num(r, 0, 10, 3),
                                                 "gram": num(r, 0, 10, 2), "milyem": r.choice([916, 585, 1000])})
        elif op == "gider":
            client.post("/api/giderler", json={"tutar": num(r, 0, 2000, 2), "kategori": r.choice(["Kira", "Elektrik"]), "notlar": ""})
        elif op == "edit":
            kind = r.choice(["alis", "satis", "hurda"])
            rows = client.get(f"/api/{kind}").json()["data"]
            rows = rows["kayitlar"] if kind == "hurda" else rows
            if rows:
                row = dict(r.choice(rows))
                row.update({k: v for k, v in tx(r).items() if k in r.sample(["gram", "milyem", "has_fiyati", "notlar", "odeme_tipi", "odenen_has"], 2)})
                row.pop("has", None)
                client.put(f"/api/{kind}/{row['id']}", json=row)
        elif op == "delete":
            kind = r.choice(["alis", "satis", "hurda"])
            rows = client.get(f"/api/{kind}").json()["data"]
            rows = rows["kayitlar"] if kind == "hurda" else rows
            if rows: client.delete(f"/api/{kind}/{r.choice(rows)['id']}")
        elif op == "rename":
            client.put("/api/cari/kisi", json={"eski_isim": r.choice(PEOPLE), "yeni_isim": r.choice(PEOPLE)})
        if step % 5 == 4:
            for path in ["/api/dashboard", "/api/stok/normal", "/api/stok/hurda", "/api/cari", "/api/stok/normal/secenekler", "/api/stok/hurda/secenekler", "/api/suggestions", "/api/alis/selectable", "/api/satis/urun-secenekleri", "/api/hurda/urun-secenekleri"]:
                client.get(path)
