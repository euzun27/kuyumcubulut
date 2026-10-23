-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0005 GÜMÜŞ / BAKIR VE ATÖLYE TAKİBİ
-- Altının has esaslı stok ve cari hesapları değişmez. Gümüş ve bakır kendi
-- tablosunda, saf (has) gram üzerinden tutulur: saf gram = gram x milyem / 1000.
-- Gümüş saf gram fiyatıyla (TL/gr), bakır kilo fiyatıyla (TL/kg) hesaplanır.
-- Atölye işleri: atölyeye verilen ve geri gelen maden, fire, işçilik ve
-- işin hangi aşamada olduğu (döküm, mıhlama, cila ...).
-- =====================================================================

CREATE TABLE IF NOT EXISTS metal_islemleri (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih       TEXT    NOT NULL,
  islem_turu  TEXT    NOT NULL CHECK(islem_turu IN ('ALIS', 'SATIS')),
  metal       TEXT    NOT NULL CHECK(metal IN ('GUMUS', 'BAKIR')),
  kisi        TEXT    NOT NULL,
  cinsi       TEXT    NOT NULL DEFAULT '',          -- hurda, külçe, takı, granül, tel ...
  ayar        TEXT    NOT NULL DEFAULT '',          -- 999, 925, 900, 800 / bakırda sınıf
  adet        REAL    NOT NULL DEFAULT 0,
  gram        REAL    NOT NULL DEFAULT 0,
  milyem      REAL    NOT NULL DEFAULT 1000,
  saf_gram    REAL    NOT NULL DEFAULT 0,           -- gram x milyem / 1000
  birim_fiyat REAL    NOT NULL DEFAULT 0,           -- gümüş: TL / saf gr, bakır: TL / kg
  iscilik     REAL    NOT NULL DEFAULT 0,           -- TL
  tutar       REAL    NOT NULL DEFAULT 0,           -- TL
  notlar      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metal_tarih ON metal_islemleri(metal, tarih);

CREATE TRIGGER IF NOT EXISTS kasa_metal_delete AFTER DELETE ON metal_islemleri BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'metal' AND bagli_id = OLD.id;
END;

-- ---------------------------------------------------------------------
-- Atölye işleri. İş bir siparişe bağlı olabilir (siparis_id); iş atölyeden
-- dönünce sipariş "Hazır" olur. Verilen/gelen has ve fire burada izlenir;
-- has cari bakiyesi ve stok bu tablodan etkilenmez.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atolye_isleri (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih          TEXT    NOT NULL,                 -- atölyeye veriliş günü
  atolye         TEXT    NOT NULL,
  tur            TEXT    NOT NULL DEFAULT 'IMALAT' CHECK(tur IN ('IMALAT', 'TAMIR')),
  is_tanimi      TEXT    NOT NULL,
  siparis_id     INTEGER,
  metal          TEXT    NOT NULL DEFAULT 'ALTIN' CHECK(metal IN ('ALTIN', 'GUMUS')),
  verilen_gram   REAL    NOT NULL DEFAULT 0,
  verilen_milyem REAL    NOT NULL DEFAULT 0,
  verilen_has    REAL    NOT NULL DEFAULT 0,
  gelen_gram     REAL    NOT NULL DEFAULT 0,
  gelen_milyem   REAL    NOT NULL DEFAULT 0,
  gelen_has      REAL    NOT NULL DEFAULT 0,
  fire_has       REAL    NOT NULL DEFAULT 0,       -- verilen has - gelen has (dönüşte)
  iscilik_tl     REAL    NOT NULL DEFAULT 0,
  iscilik_has    REAL    NOT NULL DEFAULT 0,
  asama          TEXT    NOT NULL DEFAULT 'VERILDI',
  durum          TEXT    NOT NULL DEFAULT 'ATOLYEDE' CHECK(durum IN ('ATOLYEDE', 'DONDU', 'IPTAL')),
  soz_tarihi     TEXT,                             -- atölyenin söz verdiği dönüş günü
  donus_tarihi   TEXT,                             -- gerçek dönüş günü
  notlar         TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_atolye_durum ON atolye_isleri(durum, soz_tarihi);
CREATE INDEX IF NOT EXISTS idx_atolye_siparis ON atolye_isleri(siparis_id);

-- Aşama geçmişi: iş hangi gün hangi aşamaya geçti.
CREATE TABLE IF NOT EXISTS atolye_asamalari (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  is_id      INTEGER NOT NULL,
  tarih      TEXT    NOT NULL,
  asama      TEXT    NOT NULL,
  notlar     TEXT    NOT NULL DEFAULT '',
  kullanici  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_atolye_asama_is ON atolye_asamalari(is_id, id);

CREATE TRIGGER IF NOT EXISTS atolye_is_delete AFTER DELETE ON atolye_isleri BEGIN
  DELETE FROM atolye_asamalari WHERE is_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS atolye_siparis_delete AFTER DELETE ON siparisler BEGIN
  UPDATE atolye_isleri SET siparis_id = NULL WHERE siparis_id = OLD.id;
END;
