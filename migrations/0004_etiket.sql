-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0004 ÜRÜN ETİKETLERİ (BARKOD, PIRLANTA)
-- Her etiket tek bir parçayı temsil eder: gramı, işçiliği, etiket fiyatı
-- ve varsa taş (pırlanta) bilgisi. Barkod "DT" + 6 haneli numaradır.
-- Satışta okutulan etiket SATILDI olur; satış silinince stoğa döner.
-- Has/gram stoğu yine alış ve satış kayıtlarından (FIFO) hesaplanır.
-- =====================================================================

CREATE TABLE IF NOT EXISTS etiketler (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih      TEXT    NOT NULL,
  alis_id    INTEGER,                              -- parçanın geldiği alış (isteğe bağlı)
  cinsi      TEXT    NOT NULL,
  ayar       TEXT    NOT NULL DEFAULT '',
  model      TEXT    NOT NULL DEFAULT '',          -- model / ürün kodu
  gram       REAL    NOT NULL DEFAULT 0,
  milyem     REAL    NOT NULL DEFAULT 0,
  iscilik    REAL    NOT NULL DEFAULT 0,           -- TL
  fiyat      REAL    NOT NULL DEFAULT 0,           -- etiket satış fiyatı (TL), 0 = gram üzerinden
  tas_tipi   TEXT    NOT NULL DEFAULT '' CHECK(tas_tipi IN ('', 'PIRLANTA', 'RENKLI', 'ZIRKON', 'INCI', 'DIGER')),
  tas_adet   INTEGER NOT NULL DEFAULT 0,
  karat      REAL    NOT NULL DEFAULT 0,           -- toplam taş karatı
  renk       TEXT    NOT NULL DEFAULT '',          -- D-Z
  berraklik  TEXT    NOT NULL DEFAULT '',          -- IF, VVS1 ... I3
  kesim      TEXT    NOT NULL DEFAULT '',          -- yuvarlak, prenses ...
  sertifika  TEXT    NOT NULL DEFAULT '',          -- GIA/HRD no
  notlar     TEXT    NOT NULL DEFAULT '',
  durum      TEXT    NOT NULL DEFAULT 'STOKTA' CHECK(durum IN ('STOKTA', 'SATILDI')),
  satis_id   INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_etiket_durum ON etiketler(durum, cinsi);
CREATE INDEX IF NOT EXISTS idx_etiket_satis ON etiketler(satis_id);

CREATE TRIGGER IF NOT EXISTS etiket_satis_delete AFTER DELETE ON satis BEGIN
  UPDATE etiketler SET durum = 'STOKTA', satis_id = NULL WHERE satis_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS etiket_alis_delete AFTER DELETE ON alis BEGIN
  UPDATE etiketler SET alis_id = NULL WHERE alis_id = OLD.id;
END;
