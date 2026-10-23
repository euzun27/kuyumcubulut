"""Eski Python testlerindeki her API isteğini TS sunucusuna da gönderir ve cevapları karşılaştırır."""
import json, os
import httpx, pytest
from starlette.testclient import TestClient

TS = os.environ.get("TS_URL", "http://127.0.0.1:8790")
OUT = os.environ.get("PARITY_OUT", "parity.jsonl")
SKIP = {"/api/login", "/api/logout", "/api/session", "/api/ayarlar"}
DATA_SKIP = {"/api/export", "/api/backup", "/api/restore-latest", "/api/uygulama-ayarlari"}
TEXT = set()
# Bilerek değişen alanlar: bulut sürümü sarrafiye (çeyrek, yarım...) adedini saklar, eski sürüm 0 yazar.
INTENTIONAL = {"adet"}
# Kişi adları bulut sürümünde Türkçe büyük harfle kaydedilir ("ayşe" -> "AYŞE"); eski sürüm yazıldığı gibi tutar.
# Bulut sürümünün cinsi listesine eklenen ürünler (eski sürümde yok).
NEW_PRODUCTS = {"BİLEKLİK", "ZİNCİR", "KOLYE UCU"}
def _tr_upper(t): return " ".join(t.replace("i", "İ").replace("ı", "I").upper().split())
state = {"token": None, "db": None, "test": None, "count": 0, "diffs": 0}
ts = httpx.Client(base_url=TS, timeout=30)
out = open(OUT, "w", encoding="utf-8")

def reset():
    state["token"] = ts.post("/__reset").json()["token"]

_orig_request = TestClient.request

def _norm(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return v

def _diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k in INTENTIONAL: continue  # bulut sürümüne eklenen yeni alanlar (örn. TL kâr)
            elif k not in b: yield f"{path}.{k}: ts'de yok"
            else: yield from _diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): yield f"{path}: uzunluk {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)): yield from _diff(x, y, f"{path}[{i}]")
    elif a != b:
        if isinstance(a, str) and isinstance(b, str) and _tr_upper(a) == b:
            return
        if isinstance(a, str) and isinstance(b, str):
            import difflib, unicodedata
            fold = lambda t: "".join(ch for ch in unicodedata.normalize("NFKD", t.replace("ı", "i")) if ch.isascii())
            if difflib.SequenceMatcher(None, fold(a), fold(b)).ratio() > 0.8:
                TEXT.add((a, b)); return
        yield f"{path}: {a!r} != {b!r}"

def request(self, method, url, **kw):
    import main
    if state["db"] != str(main.DB_PATH):
        state["db"] = str(main.DB_PATH); reset()
    resp = _orig_request(self, method, url, **kw)
    path = httpx.URL(str(url)).path
    if not path.startswith("/api/") or path in SKIP:
        return resp
    fwd = {k: kw[k] for k in ("json", "params", "content") if kw.get(k) is not None}
    r = ts.request(method, str(url) if str(url).startswith("/") else path, cookies={"kuyumcu_session": state["token"]}, **fwd)
    try: py = resp.json()
    except Exception: py = None
    try: tb = r.json()
    except Exception: tb = {"raw": r.text[:300]}
    state["count"] += 1
    problems = []
    if resp.status_code == 401:
        return resp  # eski sürümde oturumsuz istek; bulutta oturum her zaman açık
    if resp.status_code != r.status_code: problems.append(f"HTTP {resp.status_code} != {r.status_code}")
    if py and py.get("status") != tb.get("status"): problems.append(f"status {py.get('status')} != {tb.get('status')}")
    if py and path not in DATA_SKIP and not path.startswith("/api/restore"):
        a, b = _norm(py.get("data")), _norm(tb.get("data"))
        if path == "/api/suggestions" and isinstance(a, dict) and isinstance(b, dict):
            # Python'da eşit sıralı adların sırası set düzenine bağlı (rastgele); bulutta "ayşe" ve "Ayşe" tek ad (AYŞE) olur.
            a = {k: sorted({_tr_upper(x) for x in v}) for k, v in a.items()}; b = {k: sorted({_tr_upper(x) for x in v} - (NEW_PRODUCTS - set(a.get(k, [])) if k == "products" else set())) for k, v in b.items()}
        problems += list(_diff(a, b))[:15]
    rec = {"test": state["test"], "req": f"{method} {url}", "body": kw.get("json"), "problems": problems,
           "py_msg": (py or {}).get("message"), "ts_msg": tb.get("message")}
    if problems: state["diffs"] += 1
    out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
    return resp

TestClient.request = request

import contextlib, sys
import main as _main
_orig_db = _main.db

class _Conn:
    def __init__(self, conn): self._c = conn
    def __getattr__(self, k): return getattr(self._c, k)
    def execute(self, sql, params=()):
        if "test_" in sys._getframe(1).f_code.co_filename and sql.strip().split()[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            ts.post("/__sql", json={"sql": sql, "params": list(params)})
        return self._c.execute(sql, params)

@contextlib.contextmanager
def _db(write=False):
    with contextlib.ExitStack() as stack:
        conn = stack.enter_context(_orig_db(write))
        yield _Conn(conn)

_main.db = _db

@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item):
    state["test"] = item.nodeid; state["db"] = None

def pytest_terminal_summary(terminalreporter):
    with open(OUT + ".text.txt", "w", encoding="utf-8") as f:
        for a, b in sorted(TEXT): f.write(f"{a}  ||  {b}\n")
    terminalreporter.write_line(f"PARITY: {state['count']} istek, {state['diffs']} farklı")
