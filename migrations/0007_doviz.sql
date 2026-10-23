-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0007 DÖVİZ ALIŞ / SATIŞ
-- Döviz işlemi kasaya bağlıdır (bagli_tur = 'doviz'): alınan veya verilen
-- döviz Nakit Dolar / Nakit Euro hesabına, karşılığındaki TL (nakit, POS,
-- havale) kendi hesabına yazılır. Döviz stoku bu hesapların bakiyesidir.
-- Ödenmeyen kısım cariye döviz olarak (kur değişse de aynı miktar) geçer;
-- TAHSILAT / ODEME bu döviz borcunu kapatır. Has esaslı cari değişmez.
-- Kayıt silinmez; iptalde bağlı hareketlerin tersi yazılır (kategori DOVIZ_IPTAL).
-- =====================================================================

CREATE TABLE IF NOT EXISTS doviz_islemleri (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tarih       TEXT    NOT NULL,
  islem       TEXT    NOT NULL CHECK(islem IN ('AL', 'SAT', 'TAHSILAT', 'ODEME')),
  doviz       TEXT    NOT NULL CHECK(doviz IN ('USD', 'EUR', 'GBP')),
  miktar      REAL    NOT NULL,                     -- döviz miktarı
  kur         REAL    NOT NULL,                     -- 1 döviz = ? TL
  tutar_tl    REAL    NOT NULL,                     -- miktar x kur
  kalan       REAL    NOT NULL DEFAULT 0,           -- ödenmeyen kısım (döviz); cariye geçer
  kisi        TEXT    NOT NULL DEFAULT '',
  telefon     TEXT    NOT NULL DEFAULT '',
  kimlik_no   TEXT    NOT NULL DEFAULT '',
  notlar      TEXT    NOT NULL DEFAULT '',
  kullanici   TEXT,
  -- Finansal kayıt silinmez: iptal edilir, kasaya ters kayıt atılır.
  durum         TEXT  NOT NULL DEFAULT 'AKTIF' CHECK(durum IN ('AKTIF', 'IPTAL')),
  iptal_gerekce TEXT  NOT NULL DEFAULT '',
  iptal_zamani  TEXT,
  iptal_eden    TEXT,
  -- Aynı isteğin (çift tıklama, bağlantı tekrarı) ikinci kez kaydını önler.
  islem_anahtari TEXT NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doviz_tarih ON doviz_islemleri(tarih, id);
CREATE INDEX IF NOT EXISTS idx_kasa_bagli ON kasa_hareketleri(bagli_tur, bagli_id);

CREATE TRIGGER IF NOT EXISTS kasa_doviz_delete AFTER DELETE ON doviz_islemleri BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'doviz' AND bagli_id = OLD.id;
END;
