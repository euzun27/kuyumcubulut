-- =====================================================================
-- Dünyatek Kuyumcu Portalı - 0006 GİDERLER TL OLARAK
-- Gider TL girilir, günün has fiyatıyla hasa çevrilir. `tutar` yine has'tır
-- (kâr hesabı has esaslı); yanında girilen TL tutarı ve çevirmede kullanılan
-- has fiyatı saklanır. Eski kayıtlarda bu iki alan boştur. Kasadan ödenen
-- gider kasaya bağlı hareket olarak yazılır.
-- =====================================================================

ALTER TABLE giderler ADD COLUMN tl_tutar REAL;
ALTER TABLE giderler ADD COLUMN has_fiyati REAL;

CREATE TRIGGER IF NOT EXISTS kasa_gider_delete AFTER DELETE ON giderler BEGIN
  DELETE FROM kasa_hareketleri WHERE bagli_tur = 'gider' AND bagli_id = OLD.id;
END;
