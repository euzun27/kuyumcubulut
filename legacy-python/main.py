from __future__ import annotations

import os
import json
import shutil
import sqlite3
import sys
import unicodedata
import secrets
import time
import tempfile
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


BASE_DIR = Path(__file__).resolve().parent


def resource_path(relative_path: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", BASE_DIR))
    return base / relative_path


DEFAULT_DB_PATH = BASE_DIR / "data" / "kuyumcu.db"
LEGACY_DB_PATH = BASE_DIR / "kuyumcu.db"
DB_PATH = Path(os.getenv("DB_PATH", str(DEFAULT_DB_PATH)))
STATIC_DIR = resource_path("static")
BACKUP_KEEP_DAYS = 14
SCHEMA_VERSION = "5"

ZERO = Decimal("0")
MONEY_Q = Decimal("0.01")
HAS_Q = Decimal("0.001")
NUM_Q = Decimal("0.001")
SESSION_TIMEOUT = 60 * 60 * 8
sessions: dict[str, dict[str, Any]] = {}

PRODUCTS = [
    "B\u0130LEZ\u0130K",
    "Y\u00dcZ\u00dcK",
    "KOLYE",
    "K\u00dcPE",
    "SET",
    "\u00c7EYREK",
    "YARIM",
    "TAM",
    "GRAM ALTIN",
    "RE\u015eAT",
    "RE\u015eAT \u00c7EYREK",
    "RE\u015eAT YARIM",
    "RE\u015eAT TAM",
    "RE\u015eAT GREMSE",
    "RE\u015eAT BE\u015eL\u0130",
    "ATA L\u0130RA",
    "CUMHUR\u0130YET",
    "GREMSE",
    "BE\u015eL\u0130",
    "D\u0130\u011eER",
]

BUSINESS_TABLES = ("alis", "satis", "hurda", "cari_odeme", "giderler")


def db_has_business_rows(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        conn = sqlite3.connect(path)
        try:
            for table in BUSINESS_TABLES:
                exists = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
                    (table,),
                ).fetchone()
                if exists and conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] > 0:
                    return True
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return False
    return False


def maybe_copy_legacy_database() -> None:
    if os.getenv("DB_PATH"):
        return
    if DB_PATH.resolve() != DEFAULT_DB_PATH.resolve():
        return
    if db_has_business_rows(DB_PATH):
        return
    if db_has_business_rows(LEGACY_DB_PATH):
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LEGACY_DB_PATH, DB_PATH)


def ok(data: Any = None, message: str = "") -> dict[str, Any]:
    return {"status": "ok", "message": message, "data": data}


def fail(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"status": "error", "message": message, "data": None})




def client_ip(request: Request) -> str:
    return request.client.host if request.client else "local"


def cleanup_sessions() -> None:
    now = time.time()
    for token, session in list(sessions.items()):
        if now - session["last"] > SESSION_TIMEOUT:
            sessions.pop(token, None)


def require_auth(request: Request) -> None:
    cleanup_sessions()
    token = request.cookies.get("session_token")
    session = sessions.get(token or "")
    if not session or session.get("ip") != client_ip(request):
        raise HTTPException(status_code=401, detail="Oturum yok. Ltfen giris yapin.")
    session["last"] = time.time()

def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    text = clean_text(value).casefold()
    text = text.translate(str.maketrans({"\u0131": "i", "\u0130": "i"}))
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_product(value: Any) -> str:
    text = clean_text(value)
    key = normalize_text(text)
    for product in PRODUCTS:
        if normalize_text(product) == key:
            return product
    return text


def is_hurda_product(value: Any) -> bool:
    return "hurda" in normalize_text(value)


def normalize_islem_turu(value: Any) -> str:
    key = normalize_text(value).replace(" ", "")
    if key in {"alis", "al"}:
        return "ALIS"
    if key in {"satis", "sat"}:
        return "SATIS"
    raise ValueError("Islem tr ALIS veya SATIS olmali.")


def display_islem_turu(value: Any) -> str:
    return "ALIS" if clean_text(value) == "ALIS" else "SATIS"


def d(value: Any) -> Decimal:
    if value is None or value == "":
        return ZERO
    if isinstance(value, Decimal):
        return value
    text = str(value).strip().replace(" ", "").replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"Geersiz sayi: {value}") from exc


def non_negative(value: Any, field_name: str) -> Decimal:
    number = d(value)
    if number < 0:
        raise ValueError(f"{field_name} negatif olamaz.")
    return number


def q(value: Decimal, precision: Decimal) -> Decimal:
    return value.quantize(precision, rounding=ROUND_HALF_UP)


def as_float(value: Any, precision: Decimal = MONEY_Q) -> float:
    return float(q(d(value), precision))


def calc_has(adet: Any, gram: Any, milyem: Any) -> Decimal:
    return q(d(gram) * d(milyem) / Decimal("1000"), HAS_Q)


def normalize_odeme_tipi(value: Any) -> str:
    key = normalize_text(value).replace(" ", "_")
    if key in {"", "odeme_yok", "yok", "none"}:
        return "ODEME_YOK"
    if key in {"has", "has_ile_odeme"}:
        return "HAS"
    if key in {"gram_milyem", "gram+milyem", "adet_gram_milyem", "adet+gram+milyem", "milyem"}:
        return "ADET_GRAM_MILYEM"
    if key in {"tam", "borcu_tam_kapat", "tam_kapat"}:
        return "TAM_KAPAT"
    raise ValueError("deme tipi geersiz.")


def calc_transaction_payment(odeme_tipi: Any, odenen_has: Any, odenen_adet: Any, odenen_gram: Any, odenen_milyem: Any, transaction_has: Decimal) -> Decimal:
    tip = normalize_odeme_tipi(odeme_tipi)
    if tip == "ODEME_YOK":
        return ZERO
    if tip == "HAS":
        return q(non_negative(odenen_has, "odenen_has"), HAS_Q)
    if tip == "TAM_KAPAT":
        return q(transaction_has, HAS_Q)
    return calc_has(Decimal("1"), odenen_gram, odenen_milyem)


def purchase_total(row: sqlite3.Row | dict[str, Any]) -> Decimal:
    return q(d(row["has"]) * d(row["has_fiyati"]) + d(row["iscilik"]) + d(row["ek_masraf"]), MONEY_Q)


def sale_total(row: sqlite3.Row | dict[str, Any]) -> Decimal:
    return q(d(row["has"]) * d(row["has_fiyati"]) + d(row["iscilik"]) + d(row["ek_ucret"]) - d(row["indirim"]), MONEY_Q)


def scrap_total(row: sqlite3.Row | dict[str, Any]) -> Decimal:
    return q(d(row["has"]) * d(row["has_fiyati"]) + d(row["iscilik"]), MONEY_Q)


@contextmanager
def db(write: bool = False) -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    try:
        conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def backup_dir() -> Path:
    path = DB_PATH.parent / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def database_integrity(path: Path | None = None) -> bool:
    target = path or DB_PATH
    if not target.exists():
        return True
    try:
        conn = sqlite3.connect(target, timeout=10)
        try:
            return conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return False


def create_database_backup(reason: str = "manual") -> Path:
    if not DB_PATH.exists():
        raise FileNotFoundError("Veritabanı henüz oluşturulmadı.")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = backup_dir() / f"kuyumcu_{reason}_{stamp}.db"
    source = sqlite3.connect(DB_PATH, timeout=10)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    if not database_integrity(target):
        target.unlink(missing_ok=True)
        raise RuntimeError("Oluşturulan yedek doğrulanamadı.")
    return target


def cleanup_old_backups() -> None:
    cutoff = time.time() - BACKUP_KEEP_DAYS * 24 * 60 * 60
    for path in backup_dir().glob("kuyumcu_*.db"):
        if path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)


def create_daily_backup() -> Path:
    today_marker = datetime.now().strftime("%Y%m%d")
    existing = list(backup_dir().glob(f"kuyumcu_daily_{today_marker}_*.db"))
    result = existing[0] if existing else create_database_backup(f"daily_{today_marker}")
    cleanup_old_backups()
    return result



def read_ui_settings() -> dict[str, str]:
    try:
        data = json.loads((DB_PATH.parent / "ui_settings.json").read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("backup_frequency") in ("daily", "startup"):
            return {"backup_frequency": data["backup_frequency"]}
    except (OSError, ValueError):
        pass
    return {"backup_frequency": "daily"}


def settings_status() -> dict[str, Any]:
    candidates = sorted(backup_dir().glob("kuyumcu_*.db"), key=lambda path: path.stat().st_mtime, reverse=True)
    latest = next((path for path in candidates if database_integrity(path)), None)
    version_file = resource_path("SURUM.txt")
    version = "Yerel kaynak s\u00fcr\u00fcm\u00fc"
    if version_file.is_file():
        version = version_file.read_text(encoding="utf-8-sig").strip()
    metadata = resource_path("static/build-info.json")
    if metadata.is_file():
        try:
            info = json.loads(metadata.read_text(encoding="utf-8"))
            version = str(info["version"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return {**read_ui_settings(), "last_backup": datetime.fromtimestamp(latest.stat().st_mtime).astimezone().isoformat() if latest else None,
            "version": version, "update_info": "G\u00fcncelleme yeni uygulama paketiyle yap\u0131l\u0131r. Mevcut veritaban\u0131 korunur."}

def schema_version() -> str | None:
    if not DB_PATH.exists() or not database_integrity():
        return None
    conn = sqlite3.connect(DB_PATH)
    try:
        has_meta = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_meta'"
        ).fetchone()
        if not has_meta:
            return None
        row = conn.execute("SELECT value FROM app_meta WHERE key='schema_version'").fetchone()
        return row[0] if row else None
    finally:
        conn.close()



def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def add_column(conn: sqlite3.Connection, table: str, definition: str) -> None:
    name = definition.split()[0]
    if name not in columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")

def create_hurda_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE hurda (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hurda_alis_id INTEGER,
            tarih TEXT NOT NULL,
            islem_turu TEXT NOT NULL CHECK(islem_turu IN ('ALIS', 'SATIS')),
            kisi TEXT NOT NULL,
            cinsi TEXT NOT NULL,
            ayar TEXT NOT NULL,
            adet REAL NOT NULL DEFAULT 0,
            gram REAL NOT NULL DEFAULT 0,
            milyem REAL NOT NULL DEFAULT 0,
            has REAL NOT NULL DEFAULT 0,
            has_fiyati REAL NOT NULL DEFAULT 0,
            iscilik REAL NOT NULL DEFAULT 0,
            toplam_tutar REAL NOT NULL DEFAULT 0,
            odenen_veya_alinan REAL NOT NULL DEFAULT 0,
            notlar TEXT NOT NULL DEFAULT ''
        )
        """
    )


def migrate_hurda_if_needed(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'hurda'").fetchone()
    if not row:
        create_hurda_table(conn)
        return
    if "CHECK(islem_turu IN ('ALIS', 'SATIS'))" in row["sql"]:
        return

    conn.execute("ALTER TABLE hurda RENAME TO hurda_old")
    create_hurda_table(conn)
    old_rows = conn.execute("SELECT * FROM hurda_old").fetchall()
    for old in old_rows:
        try:
            islem_turu = normalize_islem_turu(old["islem_turu"])
        except ValueError:
            islem_turu = "ALIS"
        conn.execute(
            """
            INSERT INTO hurda (id, tarih, islem_turu, kisi, cinsi, ayar, adet, gram, milyem,
                               has, has_fiyati, iscilik, toplam_tutar, odenen_veya_alinan, notlar)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                old["id"],
                old["tarih"],
                islem_turu,
                old["kisi"],
                normalize_product(old["cinsi"]),
                old["ayar"],
                old["adet"],
                old["gram"],
                old["milyem"],
                old["has"],
                old["has_fiyati"],
                old["iscilik"],
                old["toplam_tutar"],
                old["odenen_veya_alinan"],
                old["notlar"],
            ),
        )
    conn.execute("DROP TABLE hurda_old")



def migrate_satis_if_needed(conn: sqlite3.Connection) -> None:
    add_column(conn, "satis", "alis_id INTEGER")
    add_column(conn, "satis", "purchase_id INTEGER")

def migrate_quantity_to_total_gram(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    done = conn.execute("SELECT value FROM app_meta WHERE key = 'quantity_to_total_gram_v1'").fetchone()
    if done:
        return
    for table in ("alis", "satis", "hurda", "cari_odeme", "giderler"):
        if {"adet", "gram"}.issubset(columns(conn, table)):
            conn.execute(f"UPDATE {table} SET gram = adet * gram WHERE COALESCE(adet, 0) NOT IN (0, 1)")
            conn.execute(f"UPDATE {table} SET adet = CASE WHEN gram > 0 THEN 1 ELSE 0 END")
    for table in ("alis", "satis", "hurda"):
        if {"odenen_adet", "odenen_gram"}.issubset(columns(conn, table)):
            conn.execute(f"UPDATE {table} SET odenen_gram = odenen_adet * odenen_gram WHERE COALESCE(odenen_adet, 0) NOT IN (0, 1)")
            conn.execute(f"UPDATE {table} SET odenen_adet = CASE WHEN odenen_gram > 0 THEN 1 ELSE 0 END")
    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('quantity_to_total_gram_v1', 'done')")


def migrate_cari_payment_directions(conn: sqlite3.Connection) -> None:
    purchases: dict[str, Decimal] = {}
    sales: dict[str, Decimal] = {}
    for row in conn.execute("SELECT tedarikci, has, odenen_has FROM alis"):
        key = normalize_text(row["tedarikci"])
        purchases[key] = purchases.get(key, ZERO) + d(row["has"]) - d(row["odenen_has"])
    for row in conn.execute("SELECT musteri, has, odenen_has FROM satis"):
        key = normalize_text(row["musteri"])
        sales[key] = sales.get(key, ZERO) + d(row["has"]) - d(row["odenen_has"])
    for row in conn.execute("SELECT kisi, islem_turu, has, odenen_has FROM hurda"):
        key = normalize_text(row["kisi"])
        target = purchases if row["islem_turu"] == "ALIS" else sales
        target[key] = target.get(key, ZERO) + d(row["has"]) - d(row["odenen_has"])
    for row in conn.execute("SELECT id, isim FROM cari_odeme"):
        key = normalize_text(row["isim"])
        transaction_balance = sales.get(key, ZERO) - purchases.get(key, ZERO)
        direction = "TAHSILAT" if transaction_balance >= ZERO else "ODEME"
        conn.execute("UPDATE cari_odeme SET yon = ? WHERE id = ?", (direction, row["id"]))


def init_db() -> None:
    maybe_copy_legacy_database()
    database_existed = DB_PATH.exists()
    previous_schema_version = schema_version() if database_existed else None
    if database_existed and not database_integrity():
        raise RuntimeError(f"Veritabanı bütünlük kontrolü başarısız: {DB_PATH}")
    if database_existed and previous_schema_version != SCHEMA_VERSION:
        create_database_backup("pre_migration")
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS alis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tarih TEXT NOT NULL,
                tedarikci TEXT NOT NULL,
                cinsi TEXT NOT NULL,
                ayar TEXT NOT NULL,
                adet REAL NOT NULL DEFAULT 0,
                gram REAL NOT NULL DEFAULT 0,
                milyem REAL NOT NULL DEFAULT 0,
                has REAL NOT NULL DEFAULT 0,
                has_fiyati REAL NOT NULL DEFAULT 0,
                iscilik REAL NOT NULL DEFAULT 0,
                ek_masraf REAL NOT NULL DEFAULT 0,
                odenen REAL NOT NULL DEFAULT 0,
                notlar TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS satis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tarih TEXT NOT NULL,
                musteri TEXT NOT NULL,
                cinsi TEXT NOT NULL,
                ayar TEXT NOT NULL,
                adet REAL NOT NULL DEFAULT 0,
                gram REAL NOT NULL DEFAULT 0,
                milyem REAL NOT NULL DEFAULT 0,
                has REAL NOT NULL DEFAULT 0,
                has_fiyati REAL NOT NULL DEFAULT 0,
                iscilik REAL NOT NULL DEFAULT 0,
                ek_ucret REAL NOT NULL DEFAULT 0,
                indirim REAL NOT NULL DEFAULT 0,
                alinan REAL NOT NULL DEFAULT 0,
                notlar TEXT NOT NULL DEFAULT '',
                purchase_id INTEGER
            );

            CREATE TABLE IF NOT EXISTS giderler (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tarih TEXT NOT NULL,
                tutar REAL NOT NULL CHECK(tutar > 0),
                kategori TEXT NOT NULL,
                notlar TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS cari_odeme (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tarih TEXT NOT NULL,
                isim TEXT NOT NULL,
                odeme_tipi TEXT NOT NULL,
                adet REAL NOT NULL DEFAULT 1,
                gram REAL NOT NULL DEFAULT 0,
                milyem REAL NOT NULL DEFAULT 0,
                odenen_has REAL NOT NULL DEFAULT 0,
                yon TEXT NOT NULL DEFAULT 'TAHSILAT',
                notlar TEXT NOT NULL DEFAULT ''
            );
            """
        )
        migrate_hurda_if_needed(conn)
        migrate_satis_if_needed(conn)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sale_allocations (
                kind TEXT NOT NULL CHECK(kind IN ('normal','hurda')),
                sale_id INTEGER NOT NULL, purchase_id INTEGER NOT NULL,
                gram TEXT NOT NULL, has TEXT NOT NULL, cost TEXT NOT NULL, milyem TEXT NOT NULL,
                PRIMARY KEY(kind, sale_id, purchase_id)
            );
            CREATE INDEX IF NOT EXISTS allocation_purchase ON sale_allocations(kind,purchase_id);
            CREATE TRIGGER IF NOT EXISTS normal_allocation_delete AFTER DELETE ON satis BEGIN
                DELETE FROM sale_allocations WHERE kind='normal' AND sale_id=OLD.id;
            END;
            CREATE TRIGGER IF NOT EXISTS scrap_allocation_delete AFTER DELETE ON hurda BEGIN
                DELETE FROM sale_allocations WHERE kind='hurda' AND sale_id=OLD.id;
            END;
        """)
        add_column(conn, "hurda", "hurda_alis_id INTEGER")
        add_column(conn, "satis", "stoktan INTEGER NOT NULL DEFAULT 0")
        add_column(conn, "hurda", "stoktan INTEGER NOT NULL DEFAULT 0")
        for table in ("alis", "satis", "hurda"):
            add_column(conn, table, "odeme_tipi TEXT NOT NULL DEFAULT 'ODEME_YOK'")
            add_column(conn, table, "odenen_has REAL NOT NULL DEFAULT 0")
            add_column(conn, table, "odenen_adet REAL NOT NULL DEFAULT 0")
            add_column(conn, table, "odenen_gram REAL NOT NULL DEFAULT 0")
            add_column(conn, table, "odenen_milyem REAL NOT NULL DEFAULT 0")
        add_column(conn, "cari_odeme", "yon TEXT NOT NULL DEFAULT 'TAHSILAT'")
        migrate_quantity_to_total_gram(conn)
        if database_existed and previous_schema_version not in {"3", "4", "5"}:
            migrate_cari_payment_directions(conn)
        conn.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,),
        )
    if not database_integrity():
        raise RuntimeError(f"Migration sonrası veritabanı kontrolü başarısız: {DB_PATH}")
    create_daily_backup()
    if read_ui_settings()["backup_frequency"] == "startup":
        create_database_backup("startup")


class BaseTransaction(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    tarih: str = Field(default_factory=lambda: date.today().isoformat())
    cinsi: str
    ayar: str
    adet: Any = ZERO
    gram: Any = ZERO
    milyem: Any = ZERO
    has_fiyati: Any = ZERO
    iscilik: Any = ZERO
    notlar: str = Field(default="", max_length=500)
    has_override: Any | None = None
    stoktan: bool = False
    odeme_tipi: str = "ODEME_YOK"
    odenen_has: Any = ZERO
    odenen_adet: Any = ""
    odenen_gram: Any = ZERO
    odenen_milyem: Any = ZERO

    @field_validator("cinsi", "ayar")
    @classmethod
    def required_text(cls, value: str, info) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Bu alan zorunlu.")
        return normalize_product(value) if info.field_name == "cinsi" else value

    @model_validator(mode="after")
    def validate_numbers(self):
        self.adet = ZERO if clean_text(self.adet) == "" else non_negative(self.adet, "adet")
        for field_name in ["gram", "milyem", "has_fiyati", "iscilik"]:
            setattr(self, field_name, non_negative(getattr(self, field_name), field_name))
        if self.has_override is not None:
            self.has_override = non_negative(self.has_override, "has_override")
        self.adet = ZERO
        self.cinsi = normalize_product(self.cinsi)
        self.ayar = clean_text(self.ayar)
        self.odeme_tipi = normalize_odeme_tipi(self.odeme_tipi)
        self.odenen_has = non_negative(self.odenen_has, "odenen_has")
        self.odenen_adet = ZERO if clean_text(self.odenen_adet) == "" else non_negative(self.odenen_adet, "odenen_adet")
        self.odenen_gram = non_negative(self.odenen_gram, "odenen_gram")
        self.odenen_adet = ZERO
        self.odenen_milyem = non_negative(self.odenen_milyem, "odenen_milyem")
        return self


class AlisIn(BaseTransaction):
    tedarikci: str
    ek_masraf: Any = ZERO
    odenen: Any = ZERO

    @field_validator("tedarikci")
    @classmethod
    def required_supplier(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Tedariki zorunlu.")
        return value

    @model_validator(mode="after")
    def validate_alis_numbers(self):
        if is_hurda_product(self.cinsi):
            raise ValueError("Hurda ALIS sayfasina girilemez. HURDA sayfasini kullanin.")
        self.ek_masraf = non_negative(self.ek_masraf, "ek_masraf")
        self.odenen = non_negative(self.odenen, "odenen")
        return self


class SatisIn(BaseTransaction):
    musteri: str
    satis_milyem: Any | None = None
    ek_ucret: Any = ZERO
    indirim: Any = ZERO
    alinan: Any = ZERO
    alis_id: int | None = None
    purchase_id: int | None = None

    @field_validator("musteri")
    @classmethod
    def required_customer(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Msteri zorunlu.")
        return value

    @model_validator(mode="after")
    def validate_satis_numbers(self):
        if self.satis_milyem is not None and clean_text(self.satis_milyem) != "":
            self.milyem = self.satis_milyem
        for field_name in ["ek_ucret", "indirim", "alinan"]:
            setattr(self, field_name, non_negative(getattr(self, field_name), field_name))
        self.alis_id = self.alis_id or self.purchase_id
        if not self.alis_id and not self.stoktan:
            raise ValueError("Satis iin alistan rn seilmeli.")
        return self


class CariOdemeIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    tarih: str = Field(default_factory=lambda: date.today().isoformat())
    isim: str
    odeme_tipi: str = "HAS"
    yon: str = "OTOMATIK"
    odenen_has: Any = ZERO
    adet: Any = ZERO
    gram: Any = ZERO
    milyem: Any = ZERO
    notlar: str = Field(default="", max_length=500)



    @field_validator("isim")
    @classmethod
    def required_name(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Cari kisi/firma zorunlu.")
        return value

    @field_validator("odeme_tipi")
    @classmethod
    def valid_payment_type(cls, value: str) -> str:
        key = normalize_text(value).replace(" ", "_")
        if key in {"has", "has_ile_odeme"}:
            return "HAS"
        if key in {"gram_milyem", "gram+milyem", "adet_gram_milyem", "adet+gram+milyem", "milyem"}:
            return "ADET_GRAM_MILYEM"
        if key in {"tam", "borcu_tam_kapat", "tam_kapat"}:
            return "TAM_KAPAT"
        raise ValueError("deme tipi geersiz.")

    @field_validator("yon")
    @classmethod
    def valid_direction(cls, value: str) -> str:
        key = normalize_text(value).replace(" ", "_")
        if key in {"otomatik", "auto"}:
            return "OTOMATIK"
        if key in {"tahsilat", "musteriden_tahsilat", "alinan"}:
            return "TAHSILAT"
        if key in {"odeme", "tedarikciye_odeme", "odenmis"}:
            return "ODEME"
        raise ValueError("Cari ödeme yönü geçersiz.")

    @model_validator(mode="after")
    def validate_payment_numbers(self):
        self.gram = non_negative(self.gram, "gram")
        self.adet = ZERO
        self.milyem = non_negative(self.milyem, "milyem")
        if self.odeme_tipi == "ADET_GRAM_MILYEM":
            self.odenen_has = calc_has(Decimal("1"), self.gram, self.milyem)
        elif self.odeme_tipi == "HAS":
            self.odenen_has = non_negative(self.odenen_has, "odenen_has")
        else:
            self.odenen_has = ZERO
        return self


class CariRenameIn(BaseModel):
    eski_isim: str
    yeni_isim: str

    @model_validator(mode="after")
    def validate_names(self):
        self.eski_isim = clean_text(self.eski_isim)
        self.yeni_isim = clean_text(self.yeni_isim)
        if not self.eski_isim or not self.yeni_isim:
            raise ValueError("Eski ve yeni cari adi zorunlu.")
        return self


class CariDeleteIn(BaseModel):
    isim: str

    @field_validator("isim")
    @classmethod
    def required_name(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Cari adi zorunlu.")
        return value

class HurdaIn(BaseTransaction):
    islem_turu: str
    kisi: str
    hurda_alis_id: int | None = None
    odenen_veya_alinan: Any = ZERO

    
    @field_validator("hurda_alis_id", mode="before")
    @classmethod
    def empty_hurda_purchase_id(cls, value: Any) -> int | None:
        if value is None or clean_text(value) == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValueError("Hurda alis secimi gecersiz.")

    @field_validator("islem_turu")
    @classmethod
    def valid_type(cls, value: str) -> str:
        return normalize_islem_turu(value)

    @field_validator("kisi")
    @classmethod
    def required_person(cls, value: str) -> str:
        value = clean_text(value)
        if not value:
            raise ValueError("Kisi zorunlu.")
        return value

    @model_validator(mode="after")
    def validate_hurda_numbers(self):
        self.odenen_veya_alinan = non_negative(self.odenen_veya_alinan, "odenen_veya_alinan")
        return self


def row_dict(row: sqlite3.Row, total_name: str | None = None, total: Decimal | None = None) -> dict[str, Any]:
    data = dict(row)
    if all(key in data for key in ("has", "gram", "milyem")) and d(data["has"]) != calc_has(ZERO, data["gram"], data["milyem"]):
        data["has_override"] = str(data["has"])
    if "notlar" in data:
        data["not"] = data.pop("notlar")
    if data.get("islem_turu") in {"ALIS", "SATIS"}:
        data["islem_turu"] = display_islem_turu(data["islem_turu"])
    for key in ["adet", "gram", "milyem", "has", "odenen_has", "odenen_adet", "odenen_gram", "odenen_milyem"]:
        if key in data:
            data[key] = as_float(data[key], HAS_Q if key == "has" else NUM_Q)
    for key in ["has_fiyati", "iscilik", "ek_masraf", "odenen", "ek_ucret", "indirim", "alinan", "toplam_tutar", "odenen_veya_alinan"]:
        if key in data:
            data[key] = as_float(data[key], MONEY_Q)
    if total_name and total is not None:
        data[total_name] = as_float(total, MONEY_Q)
    return data


def fetch_all(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    return conn.execute(f"SELECT * FROM {table} ORDER BY tarih DESC, id DESC").fetchall()


def sale_purchase_id(row: sqlite3.Row | dict[str, Any]) -> int | None:
    keys = list(row.keys())
    if "purchase_id" in keys and row["purchase_id"]:
        return int(row["purchase_id"])
    if "alis_id" in keys and row["alis_id"]:
        return int(row["alis_id"])
    return None


def allocation_rows(conn: sqlite3.Connection, kind: str, sale_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM sale_allocations WHERE kind=? AND sale_id=? ORDER BY purchase_id", (kind, sale_id)).fetchall()


def allocation_used_gram(conn: sqlite3.Connection, kind: str, purchase_id: int, exclude_id: int | None = None) -> Decimal:
    rows = conn.execute("SELECT gram FROM sale_allocations WHERE kind=? AND purchase_id=? AND sale_id!=?", (kind, purchase_id, exclude_id or -1)).fetchall()
    return sum((d(row["gram"]) for row in rows), ZERO)


def allocated_value(conn: sqlite3.Connection, kind: str, row: sqlite3.Row, key: str) -> Decimal:
    return sum((d(part[key]) for part in allocation_rows(conn, kind, row["id"])), ZERO)


def allocated_stock_has(conn: sqlite3.Connection, kind: str, row: sqlite3.Row) -> Decimal:
    total = ZERO
    for part in allocation_rows(conn, kind, row["id"]):
        purchase = conn.execute(f"SELECT gram,has FROM {'alis' if kind == 'normal' else 'hurda'} WHERE id=?", (part["purchase_id"],)).fetchone()
        total += d(part["gram"]) * d(purchase["has"]) / d(purchase["gram"]) if purchase and d(purchase["gram"]) else d(part["has"])
    return total


def allocated_milyem(conn: sqlite3.Connection, kind: str, row: sqlite3.Row) -> Decimal:
    return sum((d(part["gram"]) * d(part["milyem"]) for part in allocation_rows(conn, kind, row["id"])), ZERO) / d(row["gram"]) if d(row["gram"]) else ZERO


def stock_lots(conn: sqlite3.Connection, kind: str, cinsi: str, ayar: str, exclude_id: int | None = None) -> list[tuple[sqlite3.Row, Decimal]]:
    table = "alis" if kind == "normal" else "hurda"
    same = lambda row: normalize_text(row["cinsi"]) == normalize_text(cinsi) and normalize_text(row["ayar"]) == normalize_text(ayar)
    purchases = sorted((row for row in fetch_all(conn, table) if same(row) and ((kind == "normal" and not is_hurda_product(row["cinsi"])) or (kind == "hurda" and row["islem_turu"] == "ALIS"))), key=lambda row: (row["tarih"], row["id"]))
    sales = [row for row in fetch_all(conn, "satis" if kind == "normal" else "hurda") if same(row) and row["id"] != exclude_id and (kind == "normal" or row["islem_turu"] == "SATIS")]
    ids = {row["id"] for row in purchases}
    unlinked = sum((d(row["gram"]) for row in sales if not row["stoktan"] and (sale_purchase_id(row) if kind == "normal" else row["hurda_alis_id"]) not in ids), ZERO)
    available = max(sum((d(row["gram"]) for row in purchases), ZERO) - sum((d(row["gram"]) for row in sales), ZERO), ZERO)
    result = []
    for purchase in purchases:
        remaining = purchase_remaining(conn, purchase, exclude_id) if kind == "normal" else hurda_purchase_remaining(conn, purchase, exclude_id)
        free = max(remaining["kalan_gram"], ZERO)
        consume = min(free, unlinked)
        unlinked -= consume
        free = min(free - consume, available)
        if free > 0:
            result.append((purchase, free))
            available -= free
    return result


def plan_stock_sale(conn: sqlite3.Connection, kind: str, payload: BaseTransaction, exclude_id: int | None = None) -> list[dict[str, Any]]:
    if exclude_id:
        old = conn.execute(f"SELECT * FROM {'satis' if kind == 'normal' else 'hurda'} WHERE id=?", (exclude_id,)).fetchone()
        if old and old["stoktan"] and d(old["gram"]) == d(payload.gram) and normalize_text(old["cinsi"]) == normalize_text(payload.cinsi) and normalize_text(old["ayar"]) == normalize_text(payload.ayar):
            saved = allocation_rows(conn, kind, exclude_id)
            if saved and sum((d(part["gram"]) for part in saved), ZERO) == d(payload.gram):
                return [{"purchase_id": part["purchase_id"], **{key: d(part[key]) for key in ("gram", "has", "cost", "milyem")}} for part in saved]
    needed = d(payload.gram)
    if needed <= 0:
        raise HTTPException(status_code=400, detail="Satis grami sifirdan buyuk olmali.")
    plan = []
    for purchase, free in stock_lots(conn, kind, payload.cinsi, payload.ayar, exclude_id):
        take = min(needed, free)
        total = purchase_total(purchase) if kind == "normal" else scrap_total(purchase)
        plan.append({"purchase_id": purchase["id"], "gram": take, "has": take * d(purchase["has"]) / d(purchase["gram"]), "cost": take * total / d(purchase["gram"]), "milyem": d(purchase["milyem"])})
        needed -= take
        if needed == 0:
            return plan
    raise HTTPException(status_code=400, detail="STOK YETERSIZ")


def save_stock_plan(conn: sqlite3.Connection, kind: str, sale_id: int, plan: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM sale_allocations WHERE kind=? AND sale_id=?", (kind, sale_id))
    conn.executemany("INSERT INTO sale_allocations(kind,sale_id,purchase_id,gram,has,cost,milyem) VALUES(?,?,?,?,?,?,?)", [(kind,sale_id,part["purchase_id"],str(part["gram"]),str(part["has"]),str(part["cost"]),str(part["milyem"])) for part in plan])
    conn.execute(f"UPDATE {'satis' if kind == 'normal' else 'hurda'} SET stoktan=? WHERE id=?", (int(bool(plan)), sale_id))


def stock_options(conn: sqlite3.Connection, kind: str, exclude_id: int | None = None) -> list[dict[str, Any]]:
    purchases = fetch_all(conn, "alis" if kind == "normal" else "hurda")
    groups = {(normalize_text(row["cinsi"]), normalize_text(row["ayar"])): (normalize_product(row["cinsi"]), clean_text(row["ayar"])) for row in purchases if (kind == "normal" and not is_hurda_product(row["cinsi"])) or (kind == "hurda" and row["islem_turu"] == "ALIS")}
    result = []
    for cinsi, ayar in sorted(groups.values()):
        lots = stock_lots(conn, kind, cinsi, ayar, exclude_id)
        grams = sum((free for _, free in lots), ZERO)
        if grams <= 0:
            continue
        has = sum((free * d(row["has"]) / d(row["gram"]) for row, free in lots), ZERO)
        milyem = sum((free * d(row["milyem"]) for row, free in lots), ZERO) / grams
        result.append({"cinsi": cinsi, "ayar": ayar, "stoktan": True, "kalan_gram": as_float(grams, NUM_Q), "kalan_has": as_float(has, HAS_Q), "alis_milyem": as_float(milyem, NUM_Q), "kaynaklar": [{"gram": as_float(free, NUM_Q), "milyem": as_float(row["milyem"], NUM_Q)} for row, free in lots]})
    return result


def purchase_remaining(conn: sqlite3.Connection, alis: sqlite3.Row, exclude_sale_id: int | None = None) -> dict[str, Decimal]:
    params: list[Any] = [alis["id"]]
    extra = ""
    if exclude_sale_id:
        extra = " AND id != ?"
        params.append(exclude_sale_id)
    sold = conn.execute(
        f"SELECT COALESCE(SUM(gram),0) gram, COALESCE(SUM(has),0) has FROM satis WHERE stoktan = 0 AND COALESCE(purchase_id, alis_id) = ?{extra}",
        params,
    ).fetchone()
    allocated = allocation_used_gram(conn, "normal", alis["id"], exclude_sale_id)
    kalan_gram = q(row_total_gram(alis) - d(sold["gram"]) - allocated, NUM_Q)
    return {
        "kalan_gram": kalan_gram,
        "kalan_has": q(kalan_gram * d(alis["has"]) / row_total_gram(alis), HAS_Q) if row_total_gram(alis) > 0 else ZERO,
    }


def row_total_gram(row: sqlite3.Row | dict[str, Any]) -> Decimal:
    return d(row["gram"])


def stock_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    items: dict[tuple[str, str], dict[str, Any]] = {}

    def get(cinsi: str, ayar: str) -> dict[str, Any]:
        key = (normalize_text(cinsi), normalize_text(ayar))
        if key not in items:
            items[key] = {"cinsi": normalize_product(cinsi), "ayar": clean_text(ayar), "alis_gram": ZERO, "alis_has": ZERO, "alis_maliyet": ZERO, "satilan_maliyet": ZERO, "satis_stok_has": ZERO, "satis_gram": ZERO, "satis_has": ZERO}
        return items[key]

    purchases = fetch_all(conn, "alis")
    purchases_by_id = {row["id"]: row for row in purchases}
    for row in purchases:
        if is_hurda_product(row["cinsi"]):
            continue
        item = get(row["cinsi"], row["ayar"])
        item["alis_gram"] += row_total_gram(row)
        item["alis_has"] += d(row["has"])
        item["alis_maliyet"] += purchase_total(row)

    for row in fetch_all(conn, "satis"):
        if is_hurda_product(row["cinsi"]):
            continue
        item = get(row["cinsi"], row["ayar"])
        item["satis_gram"] += row_total_gram(row)
        item["satis_has"] += d(row["has"])
        purchase = purchases_by_id.get(sale_purchase_id(row))
        original_ratio = d(purchase["has"]) / row_total_gram(purchase) if purchase and row_total_gram(purchase) > 0 else (item["alis_has"] / item["alis_gram"] if item["alis_gram"] > 0 else ZERO)
        item["satis_stok_has"] += allocated_stock_has(conn, "normal", row) if row["stoktan"] else row_total_gram(row) * original_ratio
        item["satilan_maliyet"] += sale_purchase_cost(conn, row)

    result = []
    for item in items.values():
        kalan_gram = q(item["alis_gram"] - item["satis_gram"], NUM_Q)
        kalan_has = item["alis_has"] - item["satis_stok_has"] if kalan_gram != ZERO else ZERO
        avg = item["alis_maliyet"] / item["alis_has"] if item["alis_has"] > 0 else ZERO
        result.append({"cinsi": item["cinsi"], "ayar": item["ayar"], "alis_gram": as_float(item["alis_gram"], NUM_Q), "alis_has": as_float(item["alis_has"], HAS_Q), "satis_gram": as_float(item["satis_gram"], NUM_Q), "satis_has": as_float(item["satis_has"], HAS_Q), "kalan_gram": as_float(kalan_gram, NUM_Q), "kalan_has": as_float(kalan_has, HAS_Q), "ortalama_has_maliyeti": as_float(avg, MONEY_Q), "stok_degeri": as_float(item.get("alis_maliyet", item.get("hurda_alis_tutari", ZERO)) - item["satilan_maliyet"] if kalan_gram != ZERO else ZERO, MONEY_Q), "uyari": "STOK YETERSIZ" if kalan_gram < 0 else ""})
    return sorted(result, key=lambda x: (normalize_text(x["cinsi"]), normalize_text(x["ayar"])))


def stock_lookup(conn: sqlite3.Connection) -> dict[tuple[str, str], dict[str, Any]]:
    return {(normalize_text(item["cinsi"]), normalize_text(item["ayar"])): item for item in stock_items(conn)}


def hurda_purchase_remaining(conn: sqlite3.Connection, hurda_alis: sqlite3.Row, exclude_id: int | None = None) -> dict[str, Decimal]:
    params: list[Any] = [hurda_alis["id"]]
    extra = ""
    if exclude_id:
        extra = " AND id != ?"
        params.append(exclude_id)
    sold = conn.execute(
        f"SELECT COALESCE(SUM(gram),0) gram, COALESCE(SUM(has),0) has FROM hurda WHERE islem_turu = 'SATIS' AND stoktan = 0 AND hurda_alis_id = ?{extra}",
        params,
    ).fetchone()
    allocated = allocation_used_gram(conn, "hurda", hurda_alis["id"], exclude_id)
    kalan_gram = q(row_total_gram(hurda_alis) - d(sold["gram"]) - allocated, NUM_Q)
    return {
        "kalan_gram": kalan_gram,
        "kalan_has": q(kalan_gram * d(hurda_alis["has"]) / row_total_gram(hurda_alis), HAS_Q) if row_total_gram(hurda_alis) > 0 else ZERO,
    }


def hurda_stock_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    items: dict[tuple[str, str], dict[str, Any]] = {}

    def get(cinsi: str, ayar: str) -> dict[str, Any]:
        key = (normalize_text(cinsi), normalize_text(ayar))
        if key not in items:
            items[key] = {"cinsi": normalize_product(cinsi), "ayar": clean_text(ayar), "hurda_alis_gram": ZERO, "hurda_alis_has": ZERO, "hurda_alis_tutari": ZERO, "hurda_satis_gram": ZERO, "hurda_satis_has": ZERO, "hurda_satis_tutari": ZERO, "satilan_maliyet": ZERO, "satis_stok_has": ZERO, "unlinked_satis_gram": ZERO}
        return items[key]

    rows = fetch_all(conn, "hurda")
    purchases_by_id = {row["id"]: row for row in rows if row["islem_turu"] == "ALIS"}
    for row in rows:
        item = get(row["cinsi"], row["ayar"])
        if row["islem_turu"] == "ALIS":
            item["hurda_alis_gram"] += row_total_gram(row)
            item["hurda_alis_has"] += d(row["has"])
            item["hurda_alis_tutari"] += scrap_total(row)
        else:
            item["hurda_satis_gram"] += row_total_gram(row)
            item["hurda_satis_has"] += d(row["has"])
            purchase = purchases_by_id.get(row["hurda_alis_id"])
            if row["stoktan"]:
                item["satis_stok_has"] += allocated_stock_has(conn, "hurda", row)
            elif purchase and row_total_gram(purchase) > 0:
                item["satis_stok_has"] += row_total_gram(row) * d(purchase["has"]) / row_total_gram(purchase)
            else:
                item["unlinked_satis_gram"] += row_total_gram(row)
            item["hurda_satis_tutari"] += scrap_total(row)
            item["satilan_maliyet"] += scrap_total(row) - hurda_profit(conn, row)

    result = []
    for item in items.values():
        kalan_gram = q(item["hurda_alis_gram"] - item["hurda_satis_gram"], NUM_Q)
        original_ratio = item["hurda_alis_has"] / item["hurda_alis_gram"] if item["hurda_alis_gram"] > 0 else ZERO
        kalan_has = item["hurda_alis_has"] - item["satis_stok_has"] - item["unlinked_satis_gram"] * original_ratio if kalan_gram != ZERO else ZERO
        avg = item["hurda_alis_tutari"] / item["hurda_alis_has"] if item["hurda_alis_has"] > 0 else ZERO
        result.append({"cinsi": item["cinsi"], "ayar": item["ayar"], "hurda_alis_gram": as_float(item["hurda_alis_gram"], NUM_Q), "hurda_alis_has": as_float(item["hurda_alis_has"], HAS_Q), "hurda_alis_tutari": as_float(item["hurda_alis_tutari"], MONEY_Q), "hurda_satis_gram": as_float(item["hurda_satis_gram"], NUM_Q), "hurda_satis_has": as_float(item["hurda_satis_has"], HAS_Q), "hurda_satis_tutari": as_float(item["hurda_satis_tutari"], MONEY_Q), "kalan_gram": as_float(kalan_gram, NUM_Q), "kalan_has": as_float(kalan_has, HAS_Q), "ortalama_has_maliyeti": as_float(avg, MONEY_Q), "stok_degeri": as_float(item.get("alis_maliyet", item.get("hurda_alis_tutari", ZERO)) - item["satilan_maliyet"] if kalan_gram != ZERO else ZERO, MONEY_Q), "uyari": "STOK YETERSIZ" if kalan_gram < 0 else ""})
    return sorted(result, key=lambda x: (normalize_text(x["cinsi"]), normalize_text(x["ayar"])))


def hurda_stock_lookup(conn: sqlite3.Connection) -> dict[tuple[str, str], dict[str, Any]]:
    return {(normalize_text(item["cinsi"]), normalize_text(item["ayar"])): item for item in hurda_stock_items(conn)}

def ensure_stock(conn: sqlite3.Connection, cinsi: str, ayar: str, needed_gram: Decimal) -> None:
    key = (normalize_text(cinsi), normalize_text(ayar))
    stock = stock_lookup(conn).get(key)
    if not stock or d(stock["alis_gram"]) <= 0:
        raise HTTPException(status_code=400, detail="ALIS YOK")
    if d(stock["kalan_gram"]) < needed_gram:
        raise HTTPException(status_code=400, detail="STOK YETERSIZ")



def ensure_sale_stock(conn: sqlite3.Connection, payload: SatisIn, sale_has: Decimal, exclude_sale_id: int | None = None) -> sqlite3.Row:
    alis = conn.execute("SELECT * FROM alis WHERE id = ?", (payload.alis_id,)).fetchone()
    if not alis:
        raise HTTPException(status_code=400, detail="ALIS KAYDI BULUNAMADI")
    if normalize_text(alis["cinsi"]) != normalize_text(payload.cinsi) or normalize_text(alis["ayar"]) != normalize_text(payload.ayar):
        raise HTTPException(status_code=400, detail="Seilen alis ile satis rn uyusmuyor.")
    rem = purchase_remaining(conn, alis, exclude_sale_id)
    sale_gram = d(payload.gram)
    if sale_gram > rem["kalan_gram"]:
        raise HTTPException(status_code=400, detail="STOK YETERS\u0130Z")
    return alis

def ensure_hurda_stock(conn: sqlite3.Connection, payload: HurdaIn, has: Decimal, exclude_id: int | None = None) -> sqlite3.Row | None:
    if payload.islem_turu != "SATIS":
        return None
    if not payload.hurda_alis_id:
        raise HTTPException(status_code=400, detail="Hurda satis icin hurda alistan urun secilmeli.")
    alis = conn.execute("SELECT * FROM hurda WHERE id = ? AND islem_turu = 'ALIS'", (payload.hurda_alis_id,)).fetchone()
    if not alis:
        raise HTTPException(status_code=400, detail="Hurda alis kaydi bulunamadi.")
    if normalize_text(alis["cinsi"]) != normalize_text(payload.cinsi) or normalize_text(alis["ayar"]) != normalize_text(payload.ayar):
        raise HTTPException(status_code=400, detail="Secilen hurda alis ile satis urunu uyusmuyor.")
    rem = hurda_purchase_remaining(conn, alis, exclude_id)
    requested_gram = d(payload.gram)
    if requested_gram > rem["kalan_gram"]:
        raise HTTPException(status_code=400, detail="STOK YETERS\u0130Z")
    return alis


def cari_items(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cariler: dict[tuple[str, str], dict[str, Any]] = {}

    def get_or_create(isim: str, tip: str) -> dict[str, Any]:
        key = (normalize_text(isim), tip)
        if key not in cariler:
            cariler[key] = {
                "isim": clean_text(isim),
                "tip": tip,
                "alis_has": ZERO,
                "satis_has": ZERO,
                "kalan_has": ZERO,
                "toplam_islem": ZERO,
                "toplam_odeme_alma": ZERO,
                "son_islem_tarihi": "",
            }
        return cariler[key]

    for row in fetch_all(conn, "alis"):
        cari = get_or_create(row["tedarikci"], "TEDARIKI")
        cari["alis_has"] += d(row["has"])
        cari["kalan_has"] += d(row["has"])
        cari["toplam_islem"] += purchase_total(row)
        if row["tarih"] > cari["son_islem_tarihi"]:
            cari["son_islem_tarihi"] = row["tarih"]

    for row in fetch_all(conn, "satis"):
        cari = get_or_create(row["musteri"], "MSTERI")
        cari["satis_has"] += d(row["has"])
        cari["kalan_has"] -= d(row["has"])
        cari["toplam_odeme_alma"] += sale_total(row)
        if row["tarih"] > cari["son_islem_tarihi"]:
            cari["son_islem_tarihi"] = row["tarih"]

    for row in fetch_all(conn, "hurda"):
        tip = "TEDARIKI" if row["islem_turu"] == "ALIS" else "MSTERI"
        cari = get_or_create(row["kisi"], tip)
        has_val = d(row["has"])
        if row["islem_turu"] == "ALIS":
            cari["alis_has"] += has_val
            cari["kalan_has"] += has_val
            cari["toplam_islem"] += scrap_total(row)
        else:
            cari["satis_has"] += has_val
            cari["kalan_has"] -= has_val
            cari["toplam_odeme_alma"] += scrap_total(row)
        if row["tarih"] > cari["son_islem_tarihi"]:
            cari["son_islem_tarihi"] = row["tarih"]

    result = []
    for cari in cariler.values():
        bakiye = cari["toplam_islem"] - cari["toplam_odeme_alma"]
        result.append(
            {
                "isim": cari["isim"],
                "tip": cari["tip"],
                "alis_has": as_float(cari["alis_has"], HAS_Q),
                "satis_has": as_float(cari["satis_has"], HAS_Q),
                "kalan_has": as_float(cari["kalan_has"], HAS_Q),
                "toplam_islem": as_float(cari["toplam_islem"], MONEY_Q),
                "toplam_odeme_alma": as_float(cari["toplam_odeme_alma"], MONEY_Q),
                "bakiye": as_float(bakiye, MONEY_Q),
                "son_islem_tarihi": cari["son_islem_tarihi"],
            }
        )
    return sorted(result, key=lambda x: (normalize_text(x["isim"]), x["tip"]))



def cari_payment_out(row: sqlite3.Row) -> dict[str, Any]:
    item = row_dict(row)
    item["odenen_has"] = as_float(row["odenen_has"], HAS_Q)
    item["hesaplanan_has"] = item["odenen_has"]
    item["yon"] = row["yon"] if "yon" in row.keys() else "TAHSILAT"
    item["not"] = item.get("not", "")
    return item


def cari_data(conn: sqlite3.Connection) -> dict[str, Any]:
    combined: dict[str, dict[str, Any]] = {}
    customer_keys: set[str] = set()
    supplier_keys: set[str] = set()

    def get_combined(name: str) -> dict[str, Any]:
        key = normalize_text(name)
        if key not in combined:
            combined[key] = {
                "isim": clean_text(name),
                "toplam_alis": ZERO,
                "odenen": ZERO,
                "toplam_satis": ZERO,
                "alinan": ZERO,
                "normal_alis_has": ZERO,
                "normal_satis_has": ZERO,
                "hurda_alis_has": ZERO,
                "hurda_satis_has": ZERO,
                "odedigimiz_has": ZERO,
                "tahsil_edilen_has": ZERO,
                "son_islem_tarihi": "",
            }
        return combined[key]

    def add_purchase(name: str, total: Decimal, paid: Decimal, has_value: Decimal, paid_has: Decimal, tarih: str, hurda: bool = False) -> None:
        supplier_keys.add(normalize_text(name))
        person = get_combined(name)
        person["toplam_alis"] += total
        person["odenen"] += paid
        person["hurda_alis_has" if hurda else "normal_alis_has"] += has_value
        person["odedigimiz_has"] += paid_has
        person["son_islem_tarihi"] = max(person["son_islem_tarihi"], tarih)

    def add_sale(name: str, total: Decimal, received: Decimal, has_value: Decimal, paid_has: Decimal, tarih: str, hurda: bool = False) -> None:
        customer_keys.add(normalize_text(name))
        person = get_combined(name)
        person["toplam_satis"] += total
        person["alinan"] += received
        person["hurda_satis_has" if hurda else "normal_satis_has"] += has_value
        person["tahsil_edilen_has"] += paid_has
        person["son_islem_tarihi"] = max(person["son_islem_tarihi"], tarih)

    for row in fetch_all(conn, "alis"):
        add_purchase(row["tedarikci"], purchase_total(row), d(row["odenen"]), d(row["has"]), d(row["odenen_has"]), row["tarih"])

    for row in fetch_all(conn, "satis"):
        add_sale(row["musteri"], sale_total(row), d(row["alinan"]), d(row["has"]), d(row["odenen_has"]), row["tarih"])

    for row in fetch_all(conn, "hurda"):
        if row["islem_turu"] == "ALIS":
            add_purchase(row["kisi"], scrap_total(row), d(row["odenen_veya_alinan"]), d(row["has"]), d(row["odenen_has"]), row["tarih"], True)
        else:
            add_sale(row["kisi"], scrap_total(row), d(row["odenen_veya_alinan"]), d(row["has"]), d(row["odenen_has"]), row["tarih"], True)

    has_payment_table = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cari_odeme'").fetchone() is not None
    payments = fetch_all(conn, "cari_odeme") if has_payment_table else []
    for row in payments:
        paid_has = d(row["odenen_has"])
        person = get_combined(row["isim"])
        direction = row["yon"] if "yon" in row.keys() else "TAHSILAT"
        if direction == "ODEME":
            person["odedigimiz_has"] += paid_has
        else:
            person["tahsil_edilen_has"] += paid_has
        person["son_islem_tarihi"] = max(person["son_islem_tarihi"], row["tarih"])

    def out_combined() -> list[dict[str, Any]]:
        rows = []
        for cari in combined.values():
            alis_borcu = cari["toplam_alis"] - cari["odenen"]
            satis_borcu = cari["toplam_satis"] - cari["alinan"]
            net_bakiye = satis_borcu - alis_borcu
            toplam_alis_has = cari["normal_alis_has"] + cari["hurda_alis_has"]
            toplam_satis_has = cari["normal_satis_has"] + cari["hurda_satis_has"]
            toplam_has = toplam_alis_has + toplam_satis_has
            kalan_has = toplam_satis_has - cari["tahsil_edilen_has"] - toplam_alis_has + cari["odedigimiz_has"]
            rows.append({
                "isim": cari["isim"],
                "toplam_alis": as_float(cari["toplam_alis"], MONEY_Q),
                "odenen": as_float(cari["odenen"], MONEY_Q),
                "alis_borcu": as_float(alis_borcu, MONEY_Q),
                "toplam_satis": as_float(cari["toplam_satis"], MONEY_Q),
                "alinan": as_float(cari["alinan"], MONEY_Q),
                "satis_borcu": as_float(satis_borcu, MONEY_Q),
                "net_bakiye": as_float(net_bakiye, MONEY_Q),
                "normal_alis_has": as_float(cari["normal_alis_has"], HAS_Q),
                "normal_satis_has": as_float(cari["normal_satis_has"], HAS_Q),
                "hurda_alis_has": as_float(cari["hurda_alis_has"], HAS_Q),
                "hurda_satis_has": as_float(cari["hurda_satis_has"], HAS_Q),
                "toplam_alis_has": as_float(toplam_alis_has, HAS_Q),
                "toplam_satis_has": as_float(toplam_satis_has, HAS_Q),
                "toplam_has": as_float(toplam_has, HAS_Q),
                "odeme_has": as_float(cari["odedigimiz_has"] + cari["tahsil_edilen_has"], HAS_Q),
                "odedigimiz_has": as_float(cari["odedigimiz_has"], HAS_Q),
                "tahsil_edilen_has": as_float(cari["tahsil_edilen_has"], HAS_Q),
                "odeyecegimiz_has": as_float(max(-kalan_has, ZERO), HAS_Q),
                "tahsil_edilecek_has": as_float(max(kalan_has, ZERO), HAS_Q),
                "kalan_has": as_float(kalan_has, HAS_Q),
                "net_bakiye_has": as_float(kalan_has, HAS_Q),
                "son_islem_tarihi": cari["son_islem_tarihi"],
            })
        return sorted(rows, key=lambda item: normalize_text(item["isim"]))

    people = out_combined()
    by_key = {normalize_text(row["isim"]): row for row in people}

    def role_rows(keys: set[str], customer: bool) -> list[dict[str, Any]]:
        rows = []
        for key in sorted(keys):
            person = dict(by_key[key])
            if customer:
                person.update({"musteri_adi": person["isim"], "kalan_borc": person["satis_borcu"], "tip": "MSTERI"})
            else:
                person.update({"tedarikci_adi": person["isim"], "kalan_borc": person["alis_borcu"], "tip": "TEDARIKI"})
            rows.append(person)
        return rows

    return {
        "kisiler": people,
        "musteriler": role_rows(customer_keys, True),
        "tedarikciler": role_rows(supplier_keys, False),
        "odemeler": [cari_payment_out(row) for row in payments],
        "uyari": "Ayni kisi/firma farkli yazilirsa ayri cari olarak grnr.",
    }

def sale_purchase_cost(conn: sqlite3.Connection, row: sqlite3.Row) -> Decimal:
    if row["stoktan"]:
        return q(allocated_value(conn, "normal", row, "cost"), MONEY_Q)
    alis = conn.execute("SELECT * FROM alis WHERE id = ?", (sale_purchase_id(row),)).fetchone()
    if alis and row_total_gram(alis) > 0:
        return q(purchase_total(alis) * row_total_gram(row) / row_total_gram(alis), MONEY_Q)
    purchases = [r for r in fetch_all(conn, "alis") if normalize_text(r["cinsi"]) == normalize_text(row["cinsi"]) and normalize_text(r["ayar"]) == normalize_text(row["ayar"])]
    grams = sum((row_total_gram(r) for r in purchases), ZERO)
    return q(sum((purchase_total(r) for r in purchases), ZERO) * row_total_gram(row) / grams, MONEY_Q) if grams else ZERO


def sale_profit(conn: sqlite3.Connection, row: sqlite3.Row) -> Decimal:
    if row["stoktan"]:
        return q(d(row["gram"]) * (d(row["milyem"]) - allocated_milyem(conn, "normal", row)) / Decimal("1000"), HAS_Q)
    purchase_id = sale_purchase_id(row)
    if not purchase_id:
        return ZERO
    alis = conn.execute("SELECT * FROM alis WHERE id = ?", (purchase_id,)).fetchone()
    if not alis:
        return ZERO
    fark = d(row["milyem"]) - d(alis["milyem"])
    return q(row_total_gram(row) * fark / Decimal("1000"), HAS_Q)


def sale_metrics(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    purchase_id = sale_purchase_id(row)
    alis = conn.execute("SELECT * FROM alis WHERE id = ?", (purchase_id,)).fetchone() if purchase_id else None
    if not alis and not row["stoktan"]:
        return {
            "alis_milyem": 0.0, "satis_milyem": as_float(row["milyem"], NUM_Q), "milyem_farki": 0.0,
            "satis_has": as_float(row["has"], HAS_Q), "has_kari": 0.0, "milyem_kari": 0.0, "tahmini_kar": 0.0,
        }
    alis_milyem = allocated_milyem(conn, "normal", row) if row["stoktan"] else d(alis["milyem"])
    satis_milyem = d(row["milyem"])
    fark = satis_milyem - alis_milyem
    has_kari = q(row_total_gram(row) * fark / Decimal("1000"), HAS_Q)
    return {
        "alis_milyem": as_float(alis_milyem, NUM_Q),
        "satis_milyem": as_float(satis_milyem, NUM_Q),
        "milyem_farki": as_float(fark, NUM_Q),
        "satis_has": as_float(row["has"], HAS_Q),
        "milyem_farki_has_etkisi": as_float(has_kari, HAS_Q),
        "has_kari": as_float(has_kari, HAS_Q),
        "milyem_kari": as_float(has_kari, HAS_Q),
        "has_kari_milyem": as_float(fark, NUM_Q),
        "tahmini_kar": as_float(has_kari, HAS_Q),
    }


def sale_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = row_dict(row, "toplam_tutar", sale_total(row))
    item["kalan_borc"] = as_float(sale_total(row) - d(row["alinan"]), MONEY_Q)
    item.update(sale_metrics(conn, row))
    purchase_id = sale_purchase_id(row)
    item["purchase_id"] = purchase_id
    item["alis_id"] = purchase_id
    item["milyem_kari"] = item["has_kari"]
    item["kar"] = item["milyem_kari"]
    item["alis_maliyeti"] = as_float(sale_purchase_cost(conn, row))
    item["brut_kar"] = as_float(sale_total(row) - sale_purchase_cost(conn, row))
    item["uyari"] = ""
    if row["stoktan"]:
        item["stok_dagilimi"] = [dict(part) for part in allocation_rows(conn, "normal", row["id"])]
    return item

def hurda_profit(conn: sqlite3.Connection, row: sqlite3.Row) -> Decimal:
    if row["stoktan"] and row["islem_turu"] == "SATIS":
        return q(scrap_total(row) - allocated_value(conn, "hurda", row, "cost"), MONEY_Q)
    if row["islem_turu"] != "SATIS":
        return ZERO
    alis = conn.execute("SELECT * FROM hurda WHERE id = ? AND islem_turu = 'ALIS'", (row["hurda_alis_id"],)).fetchone() if "hurda_alis_id" in row.keys() and row["hurda_alis_id"] else None
    if alis and row_total_gram(alis) > 0:
        return q(scrap_total(row) - row_total_gram(row) * scrap_total(alis) / row_total_gram(alis), MONEY_Q)
    purchases = [r for r in fetch_all(conn, "hurda") if r["islem_turu"] == "ALIS" and normalize_text(r["cinsi"]) == normalize_text(row["cinsi"]) and normalize_text(r["ayar"]) == normalize_text(row["ayar"])]
    grams = sum((row_total_gram(r) for r in purchases), ZERO)
    cost = sum((scrap_total(r) for r in purchases), ZERO)
    return q(scrap_total(row) - row_total_gram(row) * cost / grams, MONEY_Q) if grams else scrap_total(row)


def hurda_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = row_dict(row, "toplam_tutar", scrap_total(row))
    item["kalan_borc"] = as_float(scrap_total(row) - d(row["odenen_veya_alinan"]), MONEY_Q)
    item["hurda_kar"] = as_float(hurda_profit(conn, row), MONEY_Q) if row["islem_turu"] == "SATIS" else 0.0
    remaining_source = row
    linked = None
    if row["islem_turu"] == "SATIS" and "hurda_alis_id" in row.keys() and row["hurda_alis_id"]:
        linked = conn.execute("SELECT * FROM hurda WHERE id = ? AND islem_turu = 'ALIS'", (row["hurda_alis_id"],)).fetchone()
        if linked:
            remaining_source = linked
    rem = hurda_purchase_remaining(conn, remaining_source) if remaining_source["islem_turu"] == "ALIS" else {"kalan_gram": ZERO, "kalan_has": ZERO}
    item["kalan_gram"] = as_float(rem["kalan_gram"], NUM_Q)
    item["kalan_has"] = as_float(rem["kalan_has"], HAS_Q)

    alis_milyem = d(linked["milyem"]) if linked else (d(row["milyem"]) if row["islem_turu"] == "ALIS" else ZERO)
    if row["stoktan"] and row["islem_turu"] == "SATIS":
        alis_milyem = allocated_milyem(conn, "hurda", row)
        stock = hurda_stock_lookup(conn).get((normalize_text(row["cinsi"]), normalize_text(row["ayar"])), {})
        item["kalan_gram"] = stock.get("kalan_gram", 0)
        item["kalan_has"] = stock.get("kalan_has", 0)
    satis_milyem = d(row["milyem"]) if row["islem_turu"] == "SATIS" else ZERO
    milyem_farki = satis_milyem - alis_milyem if row["islem_turu"] == "SATIS" else ZERO
    milyem_kari = q(row_total_gram(row) * milyem_farki / Decimal("1000"), HAS_Q) if row["islem_turu"] == "SATIS" else ZERO
    item["alis_milyem"] = as_float(alis_milyem, NUM_Q)
    item["satis_milyem"] = as_float(satis_milyem, NUM_Q)
    item["milyem_farki"] = as_float(milyem_farki, NUM_Q)
    item["milyem_kari"] = as_float(milyem_kari, HAS_Q)
    item["has_kari"] = item["milyem_kari"]
    if row["stoktan"]:
        item["stok_dagilimi"] = [dict(part) for part in allocation_rows(conn, "hurda", row["id"])]
    return item


def suggestions(conn: sqlite3.Connection) -> dict[str, list[str]]:
    products = set(PRODUCTS)
    customers: set[str] = set()
    suppliers: set[str] = set()
    people: set[str] = set()
    for row in conn.execute("SELECT cinsi, tedarikci FROM alis").fetchall():
        products.add(normalize_product(row["cinsi"]))
        suppliers.add(row["tedarikci"])
        people.add(row["tedarikci"])
    for row in conn.execute("SELECT cinsi, musteri FROM satis").fetchall():
        products.add(normalize_product(row["cinsi"]))
        customers.add(row["musteri"])
        people.add(row["musteri"])
    for row in conn.execute("SELECT cinsi, kisi, islem_turu FROM hurda").fetchall():
        products.add(normalize_product(row["cinsi"]))
        people.add(row["kisi"])
        if row["islem_turu"] == "ALIS":
            suppliers.add(row["kisi"])
        else:
            customers.add(row["kisi"])

    def sorted_values(values: set[str]) -> list[str]:
        return sorted((clean_text(v) for v in values if clean_text(v)), key=normalize_text)

    return {
        "products": sorted_values(products),
        "customers": sorted_values(customers),
        "suppliers": sorted_values(suppliers),
        "people": sorted_values(people),
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Kuyumcu Stok Cari Satis", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return fail(str(exc.detail), exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    message = first.get("msg", "Veri dogrulanamadi.")
    return fail(str(message).replace("Value error, ", ""), 422)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index(request: Request):
    try:
        require_auth(request)
    except HTTPException:
        return RedirectResponse("/login")
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/api/session")
def session(request: Request) -> dict[str, Any]:
    try:
        require_auth(request)
        return ok({"authenticated": True})
    except HTTPException:
        return ok({"authenticated": False})


@app.post("/api/login")
def login(request: Request, response: Response):
    cleanup_sessions()
    sessions.pop(request.cookies.get("session_token") or "", None)
    ip = client_ip(request)
    token = secrets.token_urlsafe(32)
    sessions[token] = {"ip": ip, "last": time.time()}
    response.set_cookie("session_token", token, max_age=SESSION_TIMEOUT, httponly=True, samesite="lax")
    return ok({"authenticated": True}, "Giriş başarılı")


@app.post("/api/logout")
def logout(request: Request, response: Response):
    sessions.pop(request.cookies.get("session_token") or "", None)
    response.delete_cookie("session_token")
    return ok({"authenticated": False}, "ikis yapildi")

@app.get("/api/suggestions")
def get_suggestions(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(suggestions(conn))


@app.get("/api/alis")
def list_alis(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        rows = []
        for row in fetch_all(conn, "alis"):
            item = row_dict(row, "toplam_tutar", purchase_total(row))
            item["kalan_borc"] = as_float(purchase_total(row) - d(row["odenen"]), MONEY_Q)
            rows.append(item)
        return ok(rows)


@app.post("/api/alis")
def create_alis(payload: AlisIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    with db() as conn:
        cur = conn.execute(
            """
            INSERT INTO alis (tarih, tedarikci, cinsi, ayar, adet, gram, milyem, has,
                              has_fiyati, iscilik, ek_masraf, odenen, notlar,
                              odeme_tipi, odenen_has, odenen_adet, odenen_gram, odenen_milyem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.tarih, payload.tedarikci, payload.cinsi, payload.ayar,
                float(payload.adet), float(payload.gram), float(payload.milyem), float(has),
                float(payload.has_fiyati), float(payload.iscilik), float(payload.ek_masraf), float(payload.odenen), payload.notlar,
                payload.odeme_tipi, float(paid_has), float(payload.odenen_adet), float(payload.odenen_gram), float(payload.odenen_milyem),
            ),
        )
        row = conn.execute("SELECT * FROM alis WHERE id = ?", (cur.lastrowid,)).fetchone()
        item = row_dict(row, "toplam_tutar", purchase_total(row))
        item["kalan_borc"] = as_float(purchase_total(row) - d(row["odenen"]), MONEY_Q)
        return ok(item, "Alis kaydedildi.")


@app.get("/api/satis/urun-secenekleri")
def sale_options(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        rows = []
        for row in fetch_all(conn, "alis"):
            if is_hurda_product(row["cinsi"]):
                continue
            rem = purchase_remaining(conn, row)
            if rem["kalan_gram"] > 0:
                item = row_dict(row, "toplam_tutar", purchase_total(row))
                item["alis_milyem"] = item["milyem"]
                item["alis_has_maliyeti"] = as_float(purchase_total(row) / d(row["has"]) if d(row["has"]) > 0 else ZERO, MONEY_Q)
                item["kalan_gram"] = as_float(rem["kalan_gram"], NUM_Q)
                item["kalan_has"] = as_float(rem["kalan_has"], HAS_Q)
                item["kalan_stok"] = f"{item['kalan_gram']} gr / {item['kalan_has']} has"
                rows.append(item)
        return ok(rows)


@app.get("/api/alis/selectable")
def sale_options_alias(_: None = Depends(require_auth)) -> dict[str, Any]:
    return sale_options(_)
@app.get("/api/satis")
def list_satis(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok([sale_out(conn, row) for row in fetch_all(conn, "satis")])


@app.post("/api/satis")
def create_satis(payload: SatisIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    with db(write=True) as conn:
        plan = plan_stock_sale(conn, "normal", payload) if payload.stoktan else []
        if payload.stoktan:
            payload.alis_id = None
        alis = conn.execute("SELECT * FROM alis WHERE id=?", (plan[0]["purchase_id"],)).fetchone() if plan else ensure_sale_stock(conn, payload, has)
        if d(payload.has_fiyati) == 0:
            payload.has_fiyati = d(alis["has_fiyati"])
        cur = conn.execute(
            """
            INSERT INTO satis (tarih, musteri, cinsi, ayar, adet, gram, milyem, has,
                               has_fiyati, iscilik, ek_ucret, indirim, alinan, notlar, alis_id, purchase_id,
                               odeme_tipi, odenen_has, odenen_adet, odenen_gram, odenen_milyem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.tarih, payload.musteri, payload.cinsi, payload.ayar,
                float(payload.adet), float(payload.gram), float(payload.milyem), float(has),
                float(payload.has_fiyati), float(payload.iscilik), float(payload.ek_ucret), float(payload.indirim), float(payload.alinan), payload.notlar,
                payload.alis_id, payload.alis_id, payload.odeme_tipi, float(paid_has), float(payload.odenen_adet), float(payload.odenen_gram), float(payload.odenen_milyem),
            ),
        )
        save_stock_plan(conn, "normal", cur.lastrowid, plan)
        row = conn.execute("SELECT * FROM satis WHERE id = ?", (cur.lastrowid,)).fetchone()
        return ok(sale_out(conn, row), "Satis kaydedildi.")

@app.get("/api/hurda/urun-secenekleri")
def hurda_sale_options(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        rows = []
        for row in fetch_all(conn, "hurda"):
            if row["islem_turu"] != "ALIS":
                continue
            rem = hurda_purchase_remaining(conn, row)
            if rem["kalan_gram"] > 0:
                item = hurda_out(conn, row)
                item["hurda_alis_id"] = item["id"]
                item["alis_milyem"] = item["milyem"]
                item["alis_has_maliyeti"] = as_float(scrap_total(row) / d(row["has"]) if d(row["has"]) > 0 else ZERO, MONEY_Q)
                item["kalan_gram"] = as_float(rem["kalan_gram"], NUM_Q)
                item["kalan_has"] = as_float(rem["kalan_has"], HAS_Q)
                item["kalan_stok"] = f"{item['kalan_gram']} gr / {item['kalan_has']} has"
                rows.append(item)
        return ok(rows)


@app.get("/api/hurda")
def list_hurda(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        hurda_rows = fetch_all(conn, "hurda")
        rows = [hurda_out(conn, row) for row in hurda_rows]
        alis_has = sum((d(row["has"]) for row in hurda_rows if row["islem_turu"] == "ALIS"), ZERO)
        satis_has = sum((d(row["has"]) for row in hurda_rows if row["islem_turu"] == "SATIS"), ZERO)
        alis_tutar = sum((scrap_total(row) for row in hurda_rows if row["islem_turu"] == "ALIS"), ZERO)
        satis_tutar = sum((scrap_total(row) for row in hurda_rows if row["islem_turu"] == "SATIS"), ZERO)
        summary = {
            "hurda_alis_has": as_float(alis_has, HAS_Q),
            "hurda_satis_has": as_float(satis_has, HAS_Q),
            "hurda_kalan_has": as_float(sum((d(item["kalan_has"]) for item in hurda_stock_items(conn)), ZERO), HAS_Q),
            "hurda_alis_tutari": as_float(alis_tutar, MONEY_Q),
            "hurda_satis_tutari": as_float(satis_tutar, MONEY_Q),
            "hurda_kar": as_float(sum((hurda_profit(conn, row) for row in hurda_rows), ZERO), MONEY_Q),
        }
        return ok({"ozet": summary, "stok": hurda_stock_items(conn), "kayitlar": rows})


@app.post("/api/hurda")
def create_hurda(payload: HurdaIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    total = q(has * payload.has_fiyati + payload.iscilik, MONEY_Q)
    with db(write=True) as conn:
        plan = plan_stock_sale(conn, "hurda", payload) if payload.stoktan and payload.islem_turu == "SATIS" else []
        if plan:
            payload.hurda_alis_id = None
        else:
            ensure_hurda_stock(conn, payload, has)
        cur = conn.execute(
            """
            INSERT INTO hurda (hurda_alis_id, tarih, islem_turu, kisi, cinsi, ayar, adet, gram, milyem,
                               has, has_fiyati, iscilik, toplam_tutar, odenen_veya_alinan, notlar,
                               odeme_tipi, odenen_has, odenen_adet, odenen_gram, odenen_milyem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.hurda_alis_id if payload.islem_turu == "SATIS" else None,
                payload.tarih, payload.islem_turu, payload.kisi, payload.cinsi, payload.ayar,
                float(payload.adet), float(payload.gram), float(payload.milyem), float(has),
                float(payload.has_fiyati), float(payload.iscilik), float(total), float(payload.odenen_veya_alinan), payload.notlar,
                payload.odeme_tipi, float(paid_has), float(payload.odenen_adet), float(payload.odenen_gram), float(payload.odenen_milyem),
            ),
        )
        save_stock_plan(conn, "hurda", cur.lastrowid, plan)
        row = conn.execute("SELECT * FROM hurda WHERE id = ?", (cur.lastrowid,)).fetchone()
        return ok(hurda_out(conn, row), "Hurda kaydedildi.")
@app.get("/api/stok/normal/secenekler")
def normal_stock_options(exclude_sale_id: int | None = None, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(stock_options(conn, "normal", exclude_sale_id))


@app.get("/api/stok/hurda/secenekler")
def scrap_stock_options(exclude_sale_id: int | None = None, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(stock_options(conn, "hurda", exclude_sale_id))


@app.get("/api/stok")
def list_stock(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(stock_items(conn))



@app.get("/api/stok/normal")
def list_normal_stock(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(stock_items(conn))


@app.get("/api/stok/hurda")
def list_hurda_stock(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(hurda_stock_items(conn))


@app.get("/api/cari")
def list_cari(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(cari_data(conn))


def resolved_cari_payment(conn: sqlite3.Connection, payload: CariOdemeIn, existing: sqlite3.Row | None = None) -> tuple[Decimal, str]:
    current = next((row for row in cari_data(conn)["kisiler"] if normalize_text(row["isim"]) == normalize_text(payload.isim)), None)
    if not current:
        raise HTTPException(status_code=404, detail="Cari bulunamadı.")
    balance = d(current["kalan_has"])
    if existing and normalize_text(existing["isim"]) == normalize_text(payload.isim):
        old_direction = existing["yon"] if "yon" in existing.keys() else "TAHSILAT"
        balance += d(existing["odenen_has"]) if old_direction == "TAHSILAT" else -d(existing["odenen_has"])
    direction = payload.yon
    if direction == "OTOMATIK":
        if balance == ZERO:
            raise HTTPException(status_code=400, detail="Cari bakiye kapalı; ödeme yönü belirlenemedi.")
        direction = "TAHSILAT" if balance > ZERO else "ODEME"
    payment_has = abs(balance) if payload.odeme_tipi == "TAM_KAPAT" else d(payload.odenen_has)
    return payment_has, direction



@app.post("/api/cari/odeme")
def create_cari_payment(payload: CariOdemeIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        payment_has, direction = resolved_cari_payment(conn, payload)
        cur = conn.execute(
            """
            INSERT INTO cari_odeme (tarih, isim, odeme_tipi, adet, gram, milyem, odenen_has, yon, notlar)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.tarih,
                payload.isim,
                payload.odeme_tipi,
                float(payload.adet),
                float(payload.gram),
                float(payload.milyem),
                float(payment_has),
                direction,
                payload.notlar,
            ),
        )
        row = conn.execute("SELECT * FROM cari_odeme WHERE id = ?", (cur.lastrowid,)).fetchone()
        return ok(cari_payment_out(row), "Cari deme kaydedildi.")


@app.put("/api/cari/odeme/{item_id}")
def update_cari_payment(item_id: int, payload: CariOdemeIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        existing = conn.execute("SELECT * FROM cari_odeme WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Cari deme kaydi bulunamadi.")
        payment_has, direction = resolved_cari_payment(conn, payload, existing)
        conn.execute(
            """
            UPDATE cari_odeme
            SET tarih = ?, isim = ?, odeme_tipi = ?, adet = ?, gram = ?, milyem = ?, odenen_has = ?, yon = ?, notlar = ?
            WHERE id = ? 
            """,
            (payload.tarih, payload.isim, payload.odeme_tipi, float(payload.adet), float(payload.gram), float(payload.milyem), float(payment_has), direction, payload.notlar, item_id),
        )
        row = conn.execute("SELECT * FROM cari_odeme WHERE id = ?", (item_id,)).fetchone()
        return ok(cari_payment_out(row), "Cari deme gncellendi.")


@app.delete("/api/cari/odeme/{item_id}")
def delete_cari_payment(item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        cur = conn.execute("DELETE FROM cari_odeme WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Cari deme kaydi bulunamadi.")
        return ok({"id": item_id}, "Cari deme silindi.")


@app.put("/api/cari/kisi")
def rename_cari_person(payload: CariRenameIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    old_key = normalize_text(payload.eski_isim)
    with db() as conn:
        updated = 0
        for table, col in (("alis", "tedarikci"), ("satis", "musteri"), ("hurda", "kisi"), ("cari_odeme", "isim")):
            rows = conn.execute(f"SELECT id, {col} FROM {table}").fetchall()
            ids = [row["id"] for row in rows if normalize_text(row[col]) == old_key]
            for row_id in ids:
                conn.execute(f"UPDATE {table} SET {col} = ? WHERE id = ?", (payload.yeni_isim, row_id))
            updated += len(ids)
        if updated == 0:
            raise HTTPException(status_code=404, detail="Cari bulunamadi.")
        return ok({"eski_isim": payload.eski_isim, "yeni_isim": payload.yeni_isim, "guncellenen": updated}, "Cari adi gncellendi.")


@app.post("/api/cari/kisi/sil")
def delete_cari_person(payload: CariDeleteIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    key = normalize_text(payload.isim)
    with db(write=True) as conn:
        for allocation in conn.execute("SELECT * FROM sale_allocations").fetchall():
            table, source_name, sale_name = ("alis", "tedarikci", "musteri") if allocation["kind"] == "normal" else ("hurda", "kisi", "kisi")
            purchase = conn.execute(f"SELECT * FROM {table} WHERE id=?", (allocation["purchase_id"],)).fetchone()
            sale = conn.execute(f"SELECT * FROM {'satis' if allocation['kind'] == 'normal' else 'hurda'} WHERE id=?", (allocation["sale_id"],)).fetchone()
            if purchase and sale and normalize_text(purchase[source_name]) == key and normalize_text(sale[sale_name]) != key:
                raise HTTPException(status_code=400, detail="Bu carinin stoktan satislarda kullanilan alislari var; once ilgili satislari kontrol edin.")
        deleted = 0
        for table, col in (("alis", "tedarikci"), ("satis", "musteri"), ("hurda", "kisi"), ("cari_odeme", "isim")):
            rows = conn.execute(f"SELECT id, {col} FROM {table}").fetchall()
            ids = [row["id"] for row in rows if normalize_text(row[col]) == key]
            for row_id in ids:
                conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
            deleted += len(ids)
        if deleted == 0:
            raise HTTPException(status_code=404, detail="Cari bulunamadi.")
        return ok({"isim": payload.isim, "silinen": deleted}, "Cari ve bagli kayitlar silindi.")
def dashboard_payload(conn: sqlite3.Connection) -> dict[str, Any]:
    alis_rows = fetch_all(conn, "alis")
    satis_rows = fetch_all(conn, "satis")
    hurda_rows = fetch_all(conn, "hurda")
    stocks = stock_items(conn)
    hurda_stocks = hurda_stock_items(conn)
    cari = cari_data(conn)
    today_text = date.today().isoformat()
    sale_dates = [row["tarih"] for row in satis_rows]
    daily_sales_date = today_text if any(row["tarih"] == today_text for row in satis_rows) else max(sale_dates, default=today_text)
    daily_sales_rows = [row for row in satis_rows if row["tarih"] == daily_sales_date]
    total_profit = sum((sale_profit(conn, row) for row in satis_rows), ZERO)
    daily_profit = sum((sale_profit(conn, row) for row in daily_sales_rows), ZERO)
    hurda_profit_total = sum((hurda_profit(conn, row) for row in hurda_rows), ZERO)
    hurda_milyem_profit_total = sum((d(hurda_out(conn, row)["milyem_kari"]) for row in hurda_rows if row["islem_turu"] == "SATIS"), ZERO)
    hurda_buy_total = sum((scrap_total(row) for row in hurda_rows if row["islem_turu"] == "ALIS"), ZERO)
    hurda_sale_total = sum((scrap_total(row) for row in hurda_rows if row["islem_turu"] == "SATIS"), ZERO)
    normal_alis_has_total = sum((d(row["has"]) for row in alis_rows), ZERO)
    normal_satis_has_total = sum((d(row["has"]) for row in satis_rows), ZERO)
    hurda_alis_has_total = sum((d(row["has"]) for row in hurda_rows if row["islem_turu"] == "ALIS"), ZERO)
    hurda_satis_has_total = sum((d(row["has"]) for row in hurda_rows if row["islem_turu"] == "SATIS"), ZERO)
    net_cari_alacak_has = sum((max(d(row["kalan_has"]), ZERO) for row in cari["kisiler"]), ZERO)
    net_cari_borc_has = sum((-min(d(row["kalan_has"]), ZERO) for row in cari["kisiler"]), ZERO)
    normal_stock_has = sum((d(item["kalan_has"]) for item in stocks), ZERO)
    normal_stock_gram = sum((d(item["kalan_gram"]) for item in stocks), ZERO)
    normal_stock_value = sum((d(item["stok_degeri"]) for item in stocks), ZERO)
    hurda_stock_has = sum((d(item["kalan_has"]) for item in hurda_stocks), ZERO)
    hurda_stock_gram = sum((d(item["kalan_gram"]) for item in hurda_stocks), ZERO)
    hurda_stock_value = sum((d(item["stok_degeri"]) for item in hurda_stocks), ZERO)
    gross_milyem = total_profit + hurda_milyem_profit_total
    expenses = sum((d(row["tutar"]) for row in fetch_all(conn, "giderler")), ZERO)
    return {
        "kar_birimi": "HAS",
        "genel_milyem_kari": as_float(gross_milyem, HAS_Q),
        "brut_kar": as_float(gross_milyem, HAS_Q),
        "toplam_gider": as_float(expenses, HAS_Q),
        "net_kar": as_float(gross_milyem - expenses, HAS_Q),
        "toplam_normal_alis": as_float(sum((purchase_total(row) for row in alis_rows), ZERO), MONEY_Q),
        "toplam_normal_satis": as_float(sum((sale_total(row) for row in satis_rows), ZERO), MONEY_Q),
        "toplam_normal_alis_has": as_float(normal_alis_has_total, HAS_Q),
        "toplam_normal_satis_has": as_float(normal_satis_has_total, HAS_Q),
        "toplam_alis": as_float(sum((purchase_total(row) for row in alis_rows), ZERO), MONEY_Q),
        "toplam_satis": as_float(sum((sale_total(row) for row in satis_rows), ZERO), MONEY_Q),
        "gunluk_tarih": daily_sales_date,
        "gunluk_satis": as_float(sum((sale_total(row) for row in daily_sales_rows), ZERO), MONEY_Q),
        "gunluk_urun_kari": as_float(daily_profit, HAS_Q),
        "genel_urun_kari": as_float(total_profit, HAS_Q),
        "gunluk_kar": as_float(daily_profit, HAS_Q),
        "toplam_kar": as_float(total_profit, HAS_Q),
        "hurda_alis_toplami": as_float(hurda_buy_total, MONEY_Q),
        "hurda_satis_toplami": as_float(hurda_sale_total, MONEY_Q),
        "hurda_alis_has_toplami": as_float(hurda_alis_has_total, HAS_Q),
        "hurda_satis_has_toplami": as_float(hurda_satis_has_total, HAS_Q),
        "hurda_kar": as_float(hurda_profit_total, MONEY_Q),
        "hurda_milyem_kari": as_float(hurda_milyem_profit_total, HAS_Q),
        "toplam_musteri_borcu": as_float(sum((d(row["kalan_borc"]) for row in cari["musteriler"]), ZERO), MONEY_Q),
        "toplam_tedarikci_borcu": as_float(sum((d(row["kalan_borc"]) for row in cari["tedarikciler"]), ZERO), MONEY_Q),
        "toplam_musteri_has_borcu": as_float(net_cari_alacak_has, HAS_Q),
        "musteri_emanet_has": as_float(net_cari_borc_has, HAS_Q),
        "toplam_tedarikci_has_borcu": as_float(net_cari_borc_has, HAS_Q),
        "tedarikci_alacak_has": as_float(net_cari_alacak_has, HAS_Q),
        "net_cari_alacak_has": as_float(net_cari_alacak_has, HAS_Q),
        "net_cari_borc_has": as_float(net_cari_borc_has, HAS_Q),
        "alacakli_cari_sayisi": sum(1 for row in cari["kisiler"] if d(row["kalan_has"]) > ZERO),
        "borclu_cari_sayisi": sum(1 for row in cari["kisiler"] if d(row["kalan_has"]) < ZERO),
        "normal_stok_has": as_float(normal_stock_has, HAS_Q),
        "normal_stok_gram": as_float(normal_stock_gram, NUM_Q),
        "normal_stok_degeri": as_float(normal_stock_value, MONEY_Q),
        "toplam_stok_has": as_float(normal_stock_has + hurda_stock_has, HAS_Q),
        "stok_degeri": as_float(normal_stock_value + hurda_stock_value, MONEY_Q),
        "hurda_kalan_has": as_float(hurda_stock_has, HAS_Q),
        "hurda_kalan_gram": as_float(hurda_stock_gram, NUM_Q),
        "hurda_stok_degeri": as_float(hurda_stock_value, MONEY_Q),
        "uyari_sayisi": sum(1 for item in stocks + hurda_stocks if item["uyari"]),
        "alis_adedi": len(alis_rows),
        "satis_adedi": len(satis_rows),
        "hurda_adedi": len(hurda_rows),
    }


class GiderIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    tarih: date = Field(default_factory=date.today)
    tutar: Decimal = Field(gt=0, max_digits=14, decimal_places=3, allow_inf_nan=False)
    kategori: str = Field(min_length=1, max_length=100)
    notlar: str = Field(default="", max_length=500)


@app.get("/api/giderler")
def list_expenses(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok([dict(row) for row in fetch_all(conn, "giderler")])


@app.post("/api/giderler")
def create_expense(payload: GiderIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO giderler (tarih, tutar, kategori, notlar) VALUES (?, ?, ?, ?)",
                           (payload.tarih.isoformat(), float(payload.tutar), payload.kategori, payload.notlar))
        return ok(dict(conn.execute("SELECT * FROM giderler WHERE id = ?", (cur.lastrowid,)).fetchone()))


@app.put("/api/giderler/{item_id}")
def update_expense(item_id: int, payload: GiderIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        cur = conn.execute("UPDATE giderler SET tarih=?, tutar=?, kategori=?, notlar=? WHERE id=?",
                           (payload.tarih.isoformat(), float(payload.tutar), payload.kategori, payload.notlar, item_id))
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Gider bulunamad\u0131.")
        return ok(dict(conn.execute("SELECT * FROM giderler WHERE id=?", (item_id,)).fetchone()))


@app.delete("/api/giderler/{item_id}")
def delete_expense(item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        if not conn.execute("DELETE FROM giderler WHERE id=?", (item_id,)).rowcount:
            raise HTTPException(status_code=404, detail="Gider bulunamad\u0131.")
        return ok(message="Gider silindi.")


@app.get("/api/dashboard")
def dashboard(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        return ok(dashboard_payload(conn))


@app.get("/api/export")
def export_all(_: None = Depends(require_auth)) -> dict[str, Any]:
    with db() as conn:
        alis_rows = [row_dict(row, "toplam_tutar", purchase_total(row)) for row in fetch_all(conn, "alis")]
        satis_rows = [sale_out(conn, row) for row in fetch_all(conn, "satis")]
        hurda_rows = [hurda_out(conn, row) for row in fetch_all(conn, "hurda")]
        return ok({
            "exported_at": datetime.now().isoformat(timespec="seconds"),
            "version": "1.0",
            "alis": alis_rows,
            "satis": satis_rows,
            "hurda": hurda_rows,
            "stok_normal": stock_items(conn),
            "stok_hurda": hurda_stock_items(conn),
            "cari": cari_data(conn),
            "dashboard": dashboard_payload(conn),
            "giderler": [dict(row) for row in fetch_all(conn, "giderler")],
        })


@app.get("/api/ayarlar")
def settings(_: None = Depends(require_auth)) -> dict[str, Any]:
    return ok([{"baslik": "Giris", "deger": "Sifresiz otomatik acilis"}, {"baslik": "Stok", "deger": "Otomatik hesaplanir"}, {"baslik": "Hurda", "deger": "Normal stoktan ayridir"}])



class UiSettingsIn(BaseModel):
    backup_frequency: str

    @field_validator("backup_frequency")
    @classmethod
    def valid_frequency(cls, value: str) -> str:
        if value not in {"daily", "startup"}:
            raise ValueError("Gecersiz yedekleme sikligi.")
        return value


@app.get("/api/uygulama-ayarlari")
def get_ui_settings(_: None = Depends(require_auth)) -> dict[str, Any]:
    return ok(settings_status())


@app.put("/api/uygulama-ayarlari")
def save_ui_settings(payload: UiSettingsIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    # Preferences live beside the DB; business tables and restore files are untouched.
    target = DB_PATH.parent / "ui_settings.json"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, prefix="ui-settings-", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(payload.model_dump(), handle)
    try:
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return ok(settings_status())

@app.post("/api/backup")
def create_backup(_: None = Depends(require_auth)) -> dict[str, Any]:
    path = create_database_backup("manual")
    cleanup_old_backups()
    return ok({"file": path.name}, "Veritabanı yedeği oluşturuldu.")


@app.post("/api/restore-latest")
def restore_latest_backup(_: None = Depends(require_auth)) -> dict[str, Any]:
    candidates = sorted(
        (path for path in backup_dir().glob("kuyumcu_*.db") if "pre_restore" not in path.name),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise HTTPException(status_code=404, detail="Geri yüklenecek yedek bulunamadı.")
    source = candidates[0]
    if not database_integrity(source):
        raise HTTPException(status_code=500, detail="Son yedek bozuk; geri yükleme yapılmadı.")
    safety_copy = create_database_backup("pre_restore")
    fd, temp_name = tempfile.mkstemp(prefix="restore_", suffix=".db", dir=DB_PATH.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        shutil.copy2(source, temp_path)
        if not database_integrity(temp_path):
            raise HTTPException(status_code=500, detail="Yedek doğrulanamadı.")
        os.replace(temp_path, DB_PATH)
        for suffix in ("-wal", "-shm"):
            Path(f"{DB_PATH}{suffix}").unlink(missing_ok=True)
        init_db()
    finally:
        temp_path.unlink(missing_ok=True)
    return ok(
        {"restored_from": source.name, "safety_backup": safety_copy.name},
        "Son yedek başarıyla geri yüklendi.",
    )


@app.put("/api/alis/{item_id}")
def update_alis(item_id: int, payload: AlisIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    with db(write=True) as conn:
        existing = conn.execute("SELECT * FROM alis WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        sold_gram = d(existing["gram"]) - purchase_remaining(conn, existing)["kalan_gram"]
        has_linked_sale = sold_gram > 0
        if has_linked_sale and (normalize_text(existing["cinsi"]) != normalize_text(payload.cinsi) or normalize_text(existing["ayar"]) != normalize_text(payload.ayar)):
            raise HTTPException(status_code=400, detail="Bu alis kaydina bagli satis var; cinsi veya ayar degistirilemez.")
        if sold_gram > d(payload.gram):
            raise HTTPException(status_code=400, detail="Bu alis kaydina bagli satis var; gram mevcut satisin altina dsrlemez.")
        if d(payload.has_fiyati) == 0 and d(payload.iscilik) == 0 and d(payload.ek_masraf) == 0 and d(payload.odenen) == 0:
            payload.has_fiyati = d(existing["has_fiyati"])
            payload.iscilik = d(existing["iscilik"])
            payload.ek_masraf = d(existing["ek_masraf"])
            payload.odenen = d(existing["odenen"])
        cur = conn.execute(
            """
            UPDATE alis
            SET tarih = ?, tedarikci = ?, cinsi = ?, ayar = ?, adet = ?, gram = ?,
                milyem = ?, has = ?, has_fiyati = ?, iscilik = ?, ek_masraf = ?,
                odenen = ?, notlar = ?, odeme_tipi = ?, odenen_has = ?, odenen_adet = ?,
                odenen_gram = ?, odenen_milyem = ?
            WHERE id = ? 
            """,
            (payload.tarih, payload.tedarikci, payload.cinsi, payload.ayar, float(payload.adet), float(payload.gram),
             float(payload.milyem), float(has), float(payload.has_fiyati), float(payload.iscilik), float(payload.ek_masraf),
             float(payload.odenen), payload.notlar, payload.odeme_tipi, float(paid_has), float(payload.odenen_adet),
             float(payload.odenen_gram), float(payload.odenen_milyem), item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        row = conn.execute("SELECT * FROM alis WHERE id = ?", (item_id,)).fetchone()
        item = row_dict(row, "toplam_tutar", purchase_total(row))
        item["kalan_borc"] = as_float(purchase_total(row) - d(row["odenen"]), MONEY_Q)
        return ok(item, "Alis gncellendi.")

@app.put("/api/satis/{item_id}")
def update_satis(item_id: int, payload: SatisIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    with db(write=True) as conn:
        existing = conn.execute("SELECT * FROM satis WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        plan = plan_stock_sale(conn, "normal", payload, item_id) if payload.stoktan else []
        if payload.stoktan:
            payload.alis_id = None
        alis = conn.execute("SELECT * FROM alis WHERE id=?", (plan[0]["purchase_id"],)).fetchone() if plan else ensure_sale_stock(conn, payload, has, item_id)
        if d(payload.has_fiyati) == 0 and d(payload.iscilik) == 0 and d(payload.ek_ucret) == 0 and d(payload.indirim) == 0 and d(payload.alinan) == 0:
            payload.has_fiyati = d(existing["has_fiyati"])
            payload.iscilik = d(existing["iscilik"])
            payload.ek_ucret = d(existing["ek_ucret"])
            payload.indirim = d(existing["indirim"])
            payload.alinan = d(existing["alinan"])
        elif d(payload.has_fiyati) == 0:
            payload.has_fiyati = d(alis["has_fiyati"])
        cur = conn.execute(
            """
            UPDATE satis
            SET tarih = ?, musteri = ?, cinsi = ?, ayar = ?, adet = ?, gram = ?,
                milyem = ?, has = ?, has_fiyati = ?, iscilik = ?, ek_ucret = ?,
                indirim = ?, alinan = ?, notlar = ?, alis_id = ?, purchase_id = ?,
                odeme_tipi = ?, odenen_has = ?, odenen_adet = ?, odenen_gram = ?, odenen_milyem = ?
            WHERE id = ? 
            """,
            (payload.tarih, payload.musteri, payload.cinsi, payload.ayar, float(payload.adet), float(payload.gram),
             float(payload.milyem), float(has), float(payload.has_fiyati), float(payload.iscilik), float(payload.ek_ucret),
             float(payload.indirim), float(payload.alinan), payload.notlar, payload.alis_id, payload.alis_id,
             payload.odeme_tipi, float(paid_has), float(payload.odenen_adet), float(payload.odenen_gram), float(payload.odenen_milyem), item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        save_stock_plan(conn, "normal", item_id, plan)
        row = conn.execute("SELECT * FROM satis WHERE id = ?", (item_id,)).fetchone()
        return ok(sale_out(conn, row), "Satis gncellendi.")
@app.put("/api/hurda/{item_id}")
def update_hurda(item_id: int, payload: HurdaIn, _: None = Depends(require_auth)) -> dict[str, Any]:
    has = payload.has_override if payload.has_override is not None else calc_has(payload.adet, payload.gram, payload.milyem)
    paid_has = calc_transaction_payment(payload.odeme_tipi, payload.odenen_has, payload.odenen_adet, payload.odenen_gram, payload.odenen_milyem, has)
    with db(write=True) as conn:
        existing = conn.execute("SELECT * FROM hurda WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        if payload.islem_turu != existing["islem_turu"]:
            raise HTTPException(status_code=400, detail="Kayit duzenlerken alis/satis turu degistirilemez.")
        if existing["islem_turu"] == "ALIS":
            used = d(existing["gram"]) - hurda_purchase_remaining(conn, existing)["kalan_gram"]
            if used > 0 and (payload.islem_turu != "ALIS" or normalize_text(existing["cinsi"]) != normalize_text(payload.cinsi) or normalize_text(existing["ayar"]) != normalize_text(payload.ayar) or d(payload.gram) < used):
                raise HTTPException(status_code=400, detail="Bu hurda alisina bagli satis var; urun veya satilan gram korunmali.")
        if d(payload.has_fiyati) == 0 and d(payload.iscilik) == 0 and d(payload.odenen_veya_alinan) == 0:
            payload.has_fiyati = d(existing["has_fiyati"])
            payload.iscilik = d(existing["iscilik"])
            payload.odenen_veya_alinan = d(existing["odenen_veya_alinan"])
        total = q(has * payload.has_fiyati + payload.iscilik, MONEY_Q)
        plan = plan_stock_sale(conn, "hurda", payload, item_id) if payload.stoktan and payload.islem_turu == "SATIS" else []
        if plan:
            payload.hurda_alis_id = None
        else:
            ensure_hurda_stock(conn, payload, has, item_id)
        cur = conn.execute(
            """
            UPDATE hurda
            SET hurda_alis_id = ?, tarih = ?, islem_turu = ?, kisi = ?, cinsi = ?, ayar = ?, adet = ?,
                gram = ?, milyem = ?, has = ?, has_fiyati = ?, iscilik = ?, toplam_tutar = ?,
                odenen_veya_alinan = ?, notlar = ?, odeme_tipi = ?, odenen_has = ?, odenen_adet = ?,
                odenen_gram = ?, odenen_milyem = ?
            WHERE id = ? 
            """,
            (payload.hurda_alis_id if payload.islem_turu == "SATIS" else None, payload.tarih, payload.islem_turu,
             payload.kisi, payload.cinsi, payload.ayar, float(payload.adet), float(payload.gram), float(payload.milyem),
             float(has), float(payload.has_fiyati), float(payload.iscilik), float(total), float(payload.odenen_veya_alinan),
             payload.notlar, payload.odeme_tipi, float(paid_has), float(payload.odenen_adet), float(payload.odenen_gram), float(payload.odenen_milyem), item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Kayit bulunamadi.")
        save_stock_plan(conn, "hurda", item_id, plan)
        row = conn.execute("SELECT * FROM hurda WHERE id = ?", (item_id,)).fetchone()
        return ok(hurda_out(conn, row), "Hurda gncellendi.")
@app.delete("/api/alis/{item_id}")
def delete_alis_item(item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    return delete_item("alis", item_id, _)


@app.delete("/api/satis/{item_id}")
def delete_satis_item(item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    return delete_item("satis", item_id, _)


@app.delete("/api/hurda/{item_id}")
def delete_hurda_item(item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    return delete_item("hurda", item_id, _)

@app.delete("/api/{table}/{item_id}")
def delete_item(table: str, item_id: int, _: None = Depends(require_auth)) -> dict[str, Any]:
    if table not in {"alis", "satis", "hurda"}:
        raise HTTPException(status_code=404, detail="Tablo bulunamad\u0131.")
    with db(write=True) as conn:
        if table == "alis":
            linked = conn.execute("SELECT COUNT(*) count FROM satis WHERE COALESCE(purchase_id, alis_id) = ?", (item_id,)).fetchone()["count"]
            linked += conn.execute("SELECT COUNT(*) FROM sale_allocations WHERE kind='normal' AND purchase_id=?", (item_id,)).fetchone()[0]
            if linked:
                raise HTTPException(status_code=400, detail="Bu al\u0131\u015f kayd\u0131na ba\u011fl\u0131 sat\u0131\u015f var. \u00d6nce ilgili sat\u0131\u015f\u0131 silin.")
        if table == "hurda":
            row = conn.execute("SELECT islem_turu FROM hurda WHERE id = ?", (item_id,)).fetchone()
            if row and row["islem_turu"] == "ALIS":
                linked = conn.execute("SELECT COUNT(*) count FROM hurda WHERE islem_turu = 'SATIS' AND hurda_alis_id = ?", (item_id,)).fetchone()["count"]
                linked += conn.execute("SELECT COUNT(*) FROM sale_allocations WHERE kind='hurda' AND purchase_id=?", (item_id,)).fetchone()[0]
                if linked:
                    raise HTTPException(status_code=400, detail="Bu hurda al\u0131\u015f kayd\u0131na ba\u011fl\u0131 hurda sat\u0131\u015f var. \u00d6nce ilgili hurda sat\u0131\u015f\u0131 silin.")
        cur = conn.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Kay\u0131t bulunamad\u0131.")
        return ok({"deleted": True}, "Kay\u0131t silindi.")
