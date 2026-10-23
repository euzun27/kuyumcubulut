-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0008 STOK SAYIMI
-- Ürünler barkod okutularak (ya da elle) sayılır.
--   ACILIS : programa geçişte eldeki ürünler; sayım bitince sayılan her
--            parça "AÇILIŞ STOĞU" adına ödemesi kapalı alışla stoğa girer.
--   KONTROL: stoğa dokunmaz; sayılanı sistem stoğuyla karşılaştırır.
-- Eski programın etiketi okutulursa parça için etiket kaydı açılır ve eski
-- barkod saklanır; satışta eski barkod okutulunca da ürün bulunur.
-- =====================================================================

ALTER TABLE etiketler ADD COLUMN eski_barkod TEXT;
CREATE INDEX IF NOT EXISTS idx_etiket_eski_barkod ON etiketler(eski_barkod);

CREATE TABLE IF NOT EXISTS sayimlar (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih      TEXT    NOT NULL,
  tur        TEXT    NOT NULL DEFAULT 'ACILIS' CHECK(tur IN ('ACILIS', 'KONTROL')),
  has_fiyati REAL    NOT NULL DEFAULT 0,           -- açılış stoğunun maliyet has fiyatı (TL/gr)
  durum      TEXT    NOT NULL DEFAULT 'ACIK' CHECK(durum IN ('ACIK', 'KAPALI')),
  notlar     TEXT    NOT NULL DEFAULT '',
  kullanici  TEXT    NOT NULL DEFAULT '',
  kapanis    TEXT,                                 -- bitirilme zamanı
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sayim_kalemleri (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sayim_id    INTEGER NOT NULL REFERENCES sayimlar(id) ON DELETE CASCADE,
  etiket_id   INTEGER NOT NULL,
  yeni_etiket INTEGER NOT NULL DEFAULT 0,          -- 1: etiket kaydı bu sayımda açıldı
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sayim_id, etiket_id)
);
CREATE INDEX IF NOT EXISTS idx_sayim_kalem ON sayim_kalemleri(sayim_id);
