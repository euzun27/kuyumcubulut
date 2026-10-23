-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0001 INIT
-- İş tabloları masaüstü (Python/SQLite) sürümün son şemasıyla (v5) aynıdır;
-- böylece eski veritabanından veri aktarımı kolon kolon yapılabilir.
-- Gram, milyem ve has değerleri REAL, stok dağılımları TEXT (tam ondalık)
-- olarak tutulur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kullanıcılar ve oturumlar (DunyaOne ile aynı yapı)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin',   -- admin | staff | viewer
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------
-- Alış
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih         TEXT NOT NULL,
  tedarikci     TEXT NOT NULL,
  cinsi         TEXT NOT NULL,
  ayar          TEXT NOT NULL,
  adet          REAL NOT NULL DEFAULT 0,
  gram          REAL NOT NULL DEFAULT 0,
  milyem        REAL NOT NULL DEFAULT 0,
  has           REAL NOT NULL DEFAULT 0,
  has_fiyati    REAL NOT NULL DEFAULT 0,
  iscilik       REAL NOT NULL DEFAULT 0,
  ek_masraf     REAL NOT NULL DEFAULT 0,
  odenen        REAL NOT NULL DEFAULT 0,
  notlar        TEXT NOT NULL DEFAULT '',
  odeme_tipi    TEXT NOT NULL DEFAULT 'ODEME_YOK',
  odenen_has    REAL NOT NULL DEFAULT 0,
  odenen_adet   REAL NOT NULL DEFAULT 0,
  odenen_gram   REAL NOT NULL DEFAULT 0,
  odenen_milyem REAL NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Satış
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih         TEXT NOT NULL,
  musteri       TEXT NOT NULL,
  cinsi         TEXT NOT NULL,
  ayar          TEXT NOT NULL,
  adet          REAL NOT NULL DEFAULT 0,
  gram          REAL NOT NULL DEFAULT 0,
  milyem        REAL NOT NULL DEFAULT 0,
  has           REAL NOT NULL DEFAULT 0,
  has_fiyati    REAL NOT NULL DEFAULT 0,
  iscilik       REAL NOT NULL DEFAULT 0,
  ek_ucret      REAL NOT NULL DEFAULT 0,
  indirim       REAL NOT NULL DEFAULT 0,
  alinan        REAL NOT NULL DEFAULT 0,
  notlar        TEXT NOT NULL DEFAULT '',
  purchase_id   INTEGER,
  alis_id       INTEGER,
  stoktan       INTEGER NOT NULL DEFAULT 0,
  odeme_tipi    TEXT NOT NULL DEFAULT 'ODEME_YOK',
  odenen_has    REAL NOT NULL DEFAULT 0,
  odenen_adet   REAL NOT NULL DEFAULT 0,
  odenen_gram   REAL NOT NULL DEFAULT 0,
  odenen_milyem REAL NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Hurda (alış ve satış aynı tabloda)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hurda (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  hurda_alis_id      INTEGER,
  tarih              TEXT NOT NULL,
  islem_turu         TEXT NOT NULL CHECK(islem_turu IN ('ALIS', 'SATIS')),
  kisi               TEXT NOT NULL,
  cinsi              TEXT NOT NULL,
  ayar               TEXT NOT NULL,
  adet               REAL NOT NULL DEFAULT 0,
  gram               REAL NOT NULL DEFAULT 0,
  milyem             REAL NOT NULL DEFAULT 0,
  has                REAL NOT NULL DEFAULT 0,
  has_fiyati         REAL NOT NULL DEFAULT 0,
  iscilik            REAL NOT NULL DEFAULT 0,
  toplam_tutar       REAL NOT NULL DEFAULT 0,
  odenen_veya_alinan REAL NOT NULL DEFAULT 0,
  notlar             TEXT NOT NULL DEFAULT '',
  stoktan            INTEGER NOT NULL DEFAULT 0,
  odeme_tipi         TEXT NOT NULL DEFAULT 'ODEME_YOK',
  odenen_has         REAL NOT NULL DEFAULT 0,
  odenen_adet        REAL NOT NULL DEFAULT 0,
  odenen_gram        REAL NOT NULL DEFAULT 0,
  odenen_milyem      REAL NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Cari ödeme / tahsilat ve giderler
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cari_odeme (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih      TEXT NOT NULL,
  isim       TEXT NOT NULL,
  odeme_tipi TEXT NOT NULL,
  adet       REAL NOT NULL DEFAULT 1,
  gram       REAL NOT NULL DEFAULT 0,
  milyem     REAL NOT NULL DEFAULT 0,
  odenen_has REAL NOT NULL DEFAULT 0,
  yon        TEXT NOT NULL DEFAULT 'TAHSILAT',
  notlar     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS giderler (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih    TEXT NOT NULL,
  tutar    REAL NOT NULL CHECK(tutar > 0),
  kategori TEXT NOT NULL,
  notlar   TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------
-- Stoktan (FIFO) satışların alışlara dağılımı
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_allocations (
  kind        TEXT    NOT NULL CHECK(kind IN ('normal', 'hurda')),
  sale_id     INTEGER NOT NULL,
  purchase_id INTEGER NOT NULL,
  gram        TEXT    NOT NULL,
  has         TEXT    NOT NULL,
  cost        TEXT    NOT NULL,
  milyem      TEXT    NOT NULL,
  PRIMARY KEY (kind, sale_id, purchase_id)
);
CREATE INDEX IF NOT EXISTS allocation_purchase ON sale_allocations(kind, purchase_id);

CREATE TRIGGER IF NOT EXISTS normal_allocation_delete AFTER DELETE ON satis BEGIN
  DELETE FROM sale_allocations WHERE kind = 'normal' AND sale_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS scrap_allocation_delete AFTER DELETE ON hurda BEGIN
  DELETE FROM sale_allocations WHERE kind = 'hurda' AND sale_id = OLD.id;
END;

-- ---------------------------------------------------------------------
-- Ayarlar ve uygulama içi yedekler
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '5');

CREATE TABLE IF NOT EXISTS yedekler (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reason     TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  parts      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS yedek_parcalari (
  yedek_id INTEGER NOT NULL REFERENCES yedekler(id) ON DELETE CASCADE,
  part     INTEGER NOT NULL,
  payload  TEXT    NOT NULL,
  PRIMARY KEY (yedek_id, part)
);

-- ---------------------------------------------------------------------
-- Denetim kaydı: kim, ne zaman, hangi kaydı ekledi/değiştirdi/sildi
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  user_name   TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  description TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
