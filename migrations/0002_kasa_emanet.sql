-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0002 KASA, DÖVİZ, GÜN SONU, EMANET
-- Has esaslı cari ve stok hesapları değişmez; bu tablolar paranın
-- (TL, döviz) hangi kasada olduğunu ve müşteri emanetlerini tutar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kasa hesapları: nakit kasa, banka, POS (her biri tek para biriminde)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kasa_hesaplari (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ad             TEXT    NOT NULL UNIQUE,
  tur            TEXT    NOT NULL CHECK(tur IN ('NAKIT', 'BANKA', 'POS')),
  para_birimi    TEXT    NOT NULL CHECK(para_birimi IN ('TRY', 'USD', 'EUR', 'GBP')),
  komisyon_orani REAL    NOT NULL DEFAULT 0,   -- POS için yüzde (örn. 2.5)
  aktif          INTEGER NOT NULL DEFAULT 1,
  sira           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO kasa_hesaplari (id, ad, tur, para_birimi, sira) VALUES
  (1, 'Nakit TL',    'NAKIT', 'TRY', 1),
  (2, 'Nakit Dolar', 'NAKIT', 'USD', 2),
  (3, 'Nakit Euro',  'NAKIT', 'EUR', 3),
  (4, 'POS',         'POS',   'TRY', 4),
  (5, 'Banka',       'BANKA', 'TRY', 5);

-- ---------------------------------------------------------------------
-- Kasa hareketleri. Satış/alış/cari ödemesine bağlı olanlar bagli_tur +
-- bagli_id taşır ve o kayıt silinince otomatik silinir. Transfer ve döviz
-- bozdurma iki satırdır, aynı `grup` değerini paylaşır.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kasa_hareketleri (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih      TEXT    NOT NULL,
  hesap_id   INTEGER NOT NULL REFERENCES kasa_hesaplari(id),
  yon        TEXT    NOT NULL CHECK(yon IN ('GIRIS', 'CIKIS')),
  tutar      REAL    NOT NULL CHECK(tutar > 0),
  komisyon   REAL    NOT NULL DEFAULT 0,
  kur        REAL,                             -- dövizli hesapta 1 birimin TL karşılığı
  kategori   TEXT    NOT NULL,
  cari       TEXT    NOT NULL DEFAULT '',
  aciklama   TEXT    NOT NULL DEFAULT '',
  bagli_tur  TEXT,                             -- alis | satis | hurda | cari_odeme
  bagli_id   INTEGER,
  grup       TEXT,
  kullanici  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kasa_tarih ON kasa_hareketleri(tarih);
CREATE INDEX IF NOT EXISTS idx_kasa_hesap ON kasa_hareketleri(hesap_id, tarih);
CREATE INDEX IF NOT EXISTS idx_kasa_bagli ON kasa_hareketleri(bagli_tur, bagli_id);

CREATE TRIGGER IF NOT EXISTS kasa_alis_delete AFTER DELETE ON alis BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'alis' AND bagli_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS kasa_satis_delete AFTER DELETE ON satis BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'satis' AND bagli_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS kasa_hurda_delete AFTER DELETE ON hurda BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'hurda' AND bagli_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS kasa_cari_delete AFTER DELETE ON cari_odeme BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'cari_odeme' AND bagli_id = OLD.id;
END;

-- ---------------------------------------------------------------------
-- Gün sonu: her hesap için beklenen bakiye ve sayılan tutar
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gun_sonu (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih      TEXT    NOT NULL,
  hesap_id   INTEGER NOT NULL REFERENCES kasa_hesaplari(id),
  beklenen   REAL    NOT NULL DEFAULT 0,
  sayilan    REAL    NOT NULL DEFAULT 0,
  fark       REAL    NOT NULL DEFAULT 0,
  notlar     TEXT    NOT NULL DEFAULT '',
  kullanici  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tarih, hesap_id)
);

-- ---------------------------------------------------------------------
-- Emanet: müşterinin bıraktığı (ALINAN) veya bizim bıraktığımız (VERILEN)
-- altın ya da para. Stoku, kârı ve cari bakiyeyi etkilemez.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emanetler (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih       TEXT    NOT NULL,
  kisi        TEXT    NOT NULL,
  telefon     TEXT    NOT NULL DEFAULT '',
  yon         TEXT    NOT NULL DEFAULT 'ALINAN' CHECK(yon IN ('ALINAN', 'VERILEN')),
  tur         TEXT    NOT NULL DEFAULT 'ALTIN' CHECK(tur IN ('ALTIN', 'PARA')),
  cinsi       TEXT    NOT NULL DEFAULT '',
  ayar        TEXT    NOT NULL DEFAULT '',
  adet        REAL    NOT NULL DEFAULT 0,
  gram        REAL    NOT NULL DEFAULT 0,
  milyem      REAL    NOT NULL DEFAULT 0,
  has         REAL    NOT NULL DEFAULT 0,
  tutar       REAL    NOT NULL DEFAULT 0,
  para_birimi TEXT    NOT NULL DEFAULT 'TRY',
  durum       TEXT    NOT NULL DEFAULT 'ACIK' CHECK(durum IN ('ACIK', 'IADE')),
  iade_tarihi TEXT,
  notlar      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emanet_durum ON emanetler(durum, tarih);
