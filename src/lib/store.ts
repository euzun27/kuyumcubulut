/** D1 erişimi: tabloları tek seferde okur, yazmaları toplu (atomik) yapar. */

import type { D1Database } from '@cloudflare/workers-types';
import type { Snapshot, AllocationRow, Kind, PlanPart } from './ledger';
import type { Stmt } from './db';

export const BUSINESS_TABLES = ['alis', 'satis', 'hurda', 'cari_odeme', 'giderler', 'sale_allocations'] as const;
export type BusinessTable = (typeof BUSINESS_TABLES)[number];

/** Bulut sürümünün ek tabloları; eski yedeklerde yoksa geri yüklemede olduğu gibi kalır. Sıra: önce hesaplar. */
export const KASA_TABLES = ['kasa_hesaplari', 'kasa_hareketleri', 'gun_sonu', 'emanetler', 'cari_kartlari', 'siparisler', 'etiketler', 'metal_islemleri', 'atolye_isleri', 'atolye_asamalari', 'doviz_islemleri'] as const;
export type KasaTable = (typeof KASA_TABLES)[number];

export const COLUMNS: Record<BusinessTable | KasaTable, string[]> = {
  kasa_hesaplari: ['id', 'ad', 'tur', 'para_birimi', 'komisyon_orani', 'aktif', 'sira', 'created_at'],
  kasa_hareketleri: ['id', 'tarih', 'hesap_id', 'yon', 'tutar', 'komisyon', 'kur', 'kategori', 'cari', 'aciklama', 'bagli_tur', 'bagli_id', 'grup', 'kullanici', 'created_at'],
  gun_sonu: ['id', 'tarih', 'hesap_id', 'beklenen', 'sayilan', 'fark', 'notlar', 'kullanici', 'created_at'],
  emanetler: ['id', 'tarih', 'kisi', 'telefon', 'yon', 'tur', 'cinsi', 'ayar', 'adet', 'gram', 'milyem', 'has', 'tutar', 'para_birimi', 'durum', 'iade_tarihi', 'notlar', 'created_at'],
  cari_kartlari: ['id', 'anahtar', 'isim', 'tur', 'kisi_tipi', 'telefon', 'telefon2', 'eposta', 'adres', 'il', 'vergi_dairesi', 'vergi_no', 'yetkili', 'vade_gun', 'limit_has', 'notlar', 'created_at', 'updated_at'],
  siparisler: ['id', 'tarih', 'tur', 'musteri', 'telefon', 'urun', 'cinsi', 'ayar', 'gram', 'tutar', 'teslim_tarihi', 'durum', 'atolye', 'teslim_edildi', 'notlar', 'created_at'],
  etiketler: ['id', 'tarih', 'alis_id', 'cinsi', 'ayar', 'model', 'gram', 'milyem', 'iscilik', 'fiyat', 'tas_tipi', 'tas_adet', 'karat', 'renk', 'berraklik', 'kesim',
    'sertifika', 'notlar', 'durum', 'satis_id', 'created_at'],
  metal_islemleri: ['id', 'tarih', 'islem_turu', 'metal', 'kisi', 'cinsi', 'ayar', 'adet', 'gram', 'milyem', 'saf_gram', 'birim_fiyat', 'iscilik', 'tutar', 'notlar', 'created_at'],
  atolye_isleri: ['id', 'tarih', 'atolye', 'tur', 'is_tanimi', 'siparis_id', 'metal', 'verilen_gram', 'verilen_milyem', 'verilen_has', 'gelen_gram', 'gelen_milyem', 'gelen_has',
    'fire_has', 'iscilik_tl', 'iscilik_has', 'asama', 'durum', 'soz_tarihi', 'donus_tarihi', 'notlar', 'created_at'],
  atolye_asamalari: ['id', 'is_id', 'tarih', 'asama', 'notlar', 'kullanici', 'created_at'],
  doviz_islemleri: ['id', 'tarih', 'islem', 'doviz', 'miktar', 'kur', 'tutar_tl', 'kalan', 'kisi', 'telefon', 'kimlik_no', 'notlar', 'kullanici',
    'durum', 'iptal_gerekce', 'iptal_zamani', 'iptal_eden', 'islem_anahtari', 'created_at'],
  alis: ['id', 'tarih', 'tedarikci', 'cinsi', 'ayar', 'adet', 'gram', 'milyem', 'has', 'has_fiyati', 'iscilik', 'ek_masraf', 'odenen', 'notlar',
    'odeme_tipi', 'odenen_has', 'odenen_adet', 'odenen_gram', 'odenen_milyem'],
  satis: ['id', 'tarih', 'musteri', 'cinsi', 'ayar', 'adet', 'gram', 'milyem', 'has', 'has_fiyati', 'iscilik', 'ek_ucret', 'indirim', 'alinan', 'notlar',
    'purchase_id', 'alis_id', 'stoktan', 'odeme_tipi', 'odenen_has', 'odenen_adet', 'odenen_gram', 'odenen_milyem'],
  hurda: ['id', 'hurda_alis_id', 'tarih', 'islem_turu', 'kisi', 'cinsi', 'ayar', 'adet', 'gram', 'milyem', 'has', 'has_fiyati', 'iscilik', 'toplam_tutar',
    'odenen_veya_alinan', 'notlar', 'stoktan', 'odeme_tipi', 'odenen_has', 'odenen_adet', 'odenen_gram', 'odenen_milyem'],
  cari_odeme: ['id', 'tarih', 'isim', 'odeme_tipi', 'adet', 'gram', 'milyem', 'odenen_has', 'yon', 'notlar'],
  giderler: ['id', 'tarih', 'tutar', 'tl_tutar', 'has_fiyati', 'kategori', 'notlar'],
  sale_allocations: ['kind', 'sale_id', 'purchase_id', 'gram', 'has', 'cost', 'milyem'],
};

const ORDERED = 'ORDER BY tarih DESC, id DESC';

export async function loadSnapshot(db: D1Database): Promise<Snapshot> {
  const [alis, satis, hurda, cari, giderler, allocations] = await db.batch([
    db.prepare(`SELECT * FROM alis ${ORDERED}`),
    db.prepare(`SELECT * FROM satis ${ORDERED}`),
    db.prepare(`SELECT * FROM hurda ${ORDERED}`),
    db.prepare(`SELECT * FROM cari_odeme ${ORDERED}`),
    db.prepare(`SELECT * FROM giderler ${ORDERED}`),
    db.prepare(`SELECT * FROM sale_allocations ORDER BY kind, sale_id, purchase_id`),
  ]);
  return {
    alis: (alis.results ?? []) as any[],
    satis: (satis.results ?? []) as any[],
    hurda: (hurda.results ?? []) as any[],
    cari_odeme: (cari.results ?? []) as any[],
    giderler: (giderler.results ?? []) as any[],
    allocations: (allocations.results ?? []) as AllocationRow[],
  };
}

/** INSERT ... RETURNING * cümlesi üretir. */
export function insertStmt(table: string, values: Record<string, unknown>): Stmt {
  const cols = Object.keys(values);
  return {
    sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`,
    args: cols.map((c) => values[c]),
  };
}

/** UPDATE ... WHERE id = ? RETURNING * cümlesi üretir. */
export function updateStmt(table: string, id: number, values: Record<string, unknown>): Stmt {
  const cols = Object.keys(values);
  return {
    sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? RETURNING *`,
    args: [...cols.map((c) => values[c]), id],
  };
}

/**
 * Bir satışın stok dağılımını yeniden yazar. `saleId` null ise aynı batch'te
 * az önce eklenen satış kullanılır (AUTOINCREMENT olduğu için en büyük id).
 */
export function allocationStmts(kind: Kind, saleId: number | null, plan: PlanPart[]): Stmt[] {
  const table = kind === 'normal' ? 'satis' : 'hurda';
  const saleRef = saleId === null ? `(SELECT MAX(id) FROM ${table})` : '?';
  const saleArgs = saleId === null ? [] : [saleId];
  const stmts: Stmt[] = [{ sql: `DELETE FROM sale_allocations WHERE kind = ? AND sale_id = ${saleRef}`, args: [kind, ...saleArgs] }];
  for (const part of plan) {
    stmts.push({
      sql: `INSERT INTO sale_allocations (kind, sale_id, purchase_id, gram, has, cost, milyem) VALUES (?, ${saleRef}, ?, ?, ?, ?, ?)`,
      args: [kind, ...saleArgs, part.purchase_id, part.gram.toString(), part.has.toString(), part.cost.toString(), part.milyem.toString()],
    });
  }
  return stmts;
}

/** Çok sayıda id için tek cümle: WHERE id IN (json_each). */
export function idsParam(ids: number[]): string {
  return JSON.stringify(ids);
}
