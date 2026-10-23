-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0003 CARİ KARTLARI, SİPARİŞ VE TAMİR
-- Has esaslı cari bakiyesi yine alış/satış/ödeme kayıtlarından hesaplanır;
-- cari kartı yalnızca kişinin türünü (müşteri, toptancı, atölye), iletişim
-- bilgisini ve vade/limit ayarını tutar.
-- =====================================================================

CREATE TABLE IF NOT EXISTS cari_kartlari (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  anahtar    TEXT    NOT NULL UNIQUE,              -- büyük/küçük harf ve boşluktan bağımsız isim
  isim       TEXT    NOT NULL,
  tur        TEXT    NOT NULL DEFAULT 'MUSTERI' CHECK(tur IN ('MUSTERI', 'TOPTANCI', 'ATOLYE', 'DIGER')),
  kisi_tipi  TEXT    NOT NULL DEFAULT 'SAHIS' CHECK(kisi_tipi IN ('SAHIS', 'TUZEL')),  -- şahıs / şirket (tüzel kişi)
  telefon    TEXT    NOT NULL DEFAULT '',
  telefon2   TEXT    NOT NULL DEFAULT '',
  eposta     TEXT    NOT NULL DEFAULT '',
  adres      TEXT    NOT NULL DEFAULT '',
  il         TEXT    NOT NULL DEFAULT '',
  vergi_dairesi TEXT NOT NULL DEFAULT '',
  vergi_no   TEXT    NOT NULL DEFAULT '',              -- şahısta TC kimlik no, şirkette vergi no
  yetkili    TEXT    NOT NULL DEFAULT '',              -- şirketlerde ilgili kişi
  vade_gun   INTEGER,                              -- NULL: genel ayar, 0: uyarı yok
  limit_has  REAL    NOT NULL DEFAULT 0,           -- 0: limit yok
  notlar     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Sipariş ve tamir. Kapora ve teslimde alınan para kasaya bağlı hareket
-- olarak yazılır (bagli_tur = 'siparis' / 'siparis_teslim').
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS siparisler (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih          TEXT    NOT NULL,
  tur            TEXT    NOT NULL DEFAULT 'SIPARIS' CHECK(tur IN ('SIPARIS', 'TAMIR')),
  musteri        TEXT    NOT NULL,
  telefon        TEXT    NOT NULL DEFAULT '',
  urun           TEXT    NOT NULL,                 -- ürün / yapılacak iş tarifi
  cinsi          TEXT    NOT NULL DEFAULT '',
  ayar           TEXT    NOT NULL DEFAULT '',
  gram           REAL    NOT NULL DEFAULT 0,
  tutar          REAL    NOT NULL DEFAULT 0,       -- anlaşılan fiyat (TL)
  teslim_tarihi  TEXT,                             -- söz verilen gün
  durum          TEXT    NOT NULL DEFAULT 'ALINDI' CHECK(durum IN ('ALINDI', 'ATOLYEDE', 'HAZIR', 'TESLIM', 'IPTAL')),
  atolye         TEXT    NOT NULL DEFAULT '',
  teslim_edildi  TEXT,                             -- gerçek teslim günü
  notlar         TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_siparis_durum ON siparisler(durum, teslim_tarihi);

CREATE TRIGGER IF NOT EXISTS kasa_siparis_delete AFTER DELETE ON siparisler BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur IN ('siparis', 'siparis_teslim') AND bagli_id = OLD.id;
END;
