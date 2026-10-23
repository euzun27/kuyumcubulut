/**
 * Kişi / firma adlarını bir kez büyük harfe çevirir (1.1.1 öncesi kayıtlar için).
 * Yeni kayıtlar girişte büyük harfle saklanır; bu bakım eski kayıtları da
 * aynı biçime getirir ki cari listesi ve ekstrede isimler tek tip görünsün.
 * SQLite'ın UPPER() işlevi Türkçe i/ı'yı bilmediği için dönüşüm burada yapılır.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { all, first, tx, type Stmt } from './db';
import { personName } from './text';

const NAME_COLUMNS: [string, string][] = [
  ['alis', 'tedarikci'], ['satis', 'musteri'], ['hurda', 'kisi'], ['cari_odeme', 'isim'], ['cari_kartlari', 'isim'],
  ['siparisler', 'musteri'], ['siparisler', 'atolye'], ['emanetler', 'kisi'], ['metal_islemleri', 'kisi'], ['atolye_isleri', 'atolye'],
  ['kasa_hareketleri', 'cari'],
];

export async function upgradeNames(db: D1Database) {
  if (await first(db, `SELECT value FROM app_meta WHERE key = 'isim_buyuk_harf'`)) return 0;
  const stmts: Stmt[] = [];
  for (const [table, col] of NAME_COLUMNS) {
    const rows = await all<{ id: number; ad: string }>(db, `SELECT id, ${col} AS ad FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`);
    for (const r of rows) {
      const upper = personName(r.ad);
      if (upper !== r.ad) stmts.push({ sql: `UPDATE ${table} SET ${col} = ? WHERE id = ?`, args: [upper, r.id] });
    }
  }
  stmts.push({ sql: `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('isim_buyuk_harf', '1')` });
  await tx(db, stmts);
  return stmts.length - 1;
}
