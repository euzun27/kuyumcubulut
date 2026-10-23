/**
 * Kasa: paranın (TL ve döviz) hangi hesapta olduğu.
 * Has esaslı cari ve stok hesapları buradan etkilenmez; satış, alış veya
 * cari ödemesiyle birlikte alınan/verilen para o kayda bağlı hareket olarak
 * saklanır ve kayıt silinince veritabanı tetikleyicisiyle silinir.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { all, type Stmt } from './db';
import { Dec, d, MONEY_Q } from './decimal';
import { HttpError, ValidationError } from './validate';
import { cleanText } from './text';

export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const;
export const ACCOUNT_TYPES = ['NAKIT', 'BANKA', 'POS'] as const;
/** Elle girilebilen hareket türleri (satış, alış, transfer kendi ekranından gelir). */
export const MANUAL_CATEGORIES = ['GELIR', 'GIDER', 'DEVIR', 'DIGER'] as const;

export type LinkedType = 'alis' | 'satis' | 'hurda' | 'cari_odeme' | 'siparis' | 'siparis_teslim' | 'metal' | 'gider' | 'doviz';

/** Bağlı hareketin ait olduğu tablo (sipariş kaporası ve teslim ödemesi aynı tabloya bağlanır). */
const LINK_TABLE: Record<LinkedType, string> = {
  alis: 'alis', satis: 'satis', hurda: 'hurda', cari_odeme: 'cari_odeme', siparis: 'siparisler', siparis_teslim: 'siparisler', metal: 'metal_islemleri', gider: 'giderler', doviz: 'doviz_islemleri',
};

export type Account = {
  id: number;
  ad: string;
  tur: string;
  para_birimi: string;
  komisyon_orani: number;
  aktif: number;
  sira: number;
};

export type KasaItem = { hesap_id: number; tutar: Dec; kur: Dec | null };

export function money(value: unknown): number {
  return d(value ?? 0).q(MONEY_Q).toNumber();
}

/** Pozitif ondalık; hata mesajı alan adıyla. */
export function positive(value: unknown, label: string): Dec {
  let n: Dec;
  try {
    n = d(value);
  } catch {
    throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`);
  }
  if (!n.gt(0)) throw new ValidationError(`${label} 0'dan büyük olmalıdır.`);
  return n;
}

export function optionalPositive(value: unknown, label: string): Dec | null {
  if (value === undefined || value === null || value === '') return null;
  return positive(value, label);
}

export function intId(value: unknown, label: string): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError(`${label} seçin.`);
  return n;
}

export function text(value: unknown, max = 200): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError('Metin girilmelidir.');
  const v = cleanText(value);
  if ([...v].length > max) throw new ValidationError(`En fazla ${max} karakter girilebilir.`);
  return v;
}

export function date(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) throw new ValidationError('Tarih YYYY-AA-GG biçiminde olmalıdır.');
  return value.trim();
}

export async function loadAccounts(db: D1Database): Promise<Map<number, Account>> {
  const rows = await all<Account>(db, `SELECT * FROM kasa_hesaplari ORDER BY sira, id`);
  return new Map(rows.map((r) => [Number(r.id), r]));
}

/**
 * İstek gövdesindeki `kasa` alanı: [{hesap_id, tutar, kur?}].
 * Alan hiç yoksa null döner (mevcut bağlı hareketler korunur).
 */
export function parseKasaItems(raw: unknown): KasaItem[] | null {
  if (raw === undefined) return null;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Kasa ödemeleri liste olmalıdır.');
  if (raw.length > 6) throw new ValidationError('En fazla 6 ödeme satırı girilebilir.');
  return raw.map((item) => {
    if (!item || typeof item !== 'object') throw new ValidationError('Geçersiz kasa ödemesi.');
    const r = item as Record<string, unknown>;
    return { hesap_id: intId(r.hesap_id, 'Kasa hesabı'), tutar: positive(r.tutar, 'Ödeme tutarı'), kur: optionalPositive(r.kur, 'Kur') };
  });
}

export function checkItems(items: KasaItem[], accounts: Map<number, Account>) {
  for (const item of items) {
    const account = accounts.get(item.hesap_id);
    if (!account) throw new ValidationError('Kasa hesabı bulunamadı.');
    if (!account.aktif) throw new ValidationError(`${account.ad} hesabı kullanımda değil.`);
  }
}

/** TL hesabı bu kayıtla eksiye düşecekse kullanıcıdan onay istenir (409, kod EKSI_BAKIYE). */
export class NegativeBalance extends HttpError {
  kod = 'EKSI_BAKIYE';
  constructor(message: string) {
    super(409, message);
  }
}

/**
 * Kasadan çıkacak TL tutarları hesapların bugünkü toplam bakiyesini eksiye
 * düşürecekse kayıt durdurulur; kullanıcı onaylarsa (`eksi_onay: true`) yazılır.
 * Kredili banka hesabı kullanan dükkânlar için kayıt engellenmez, yalnızca sorulur.
 * Düzenlemede kaydın eski hareketleri hesaba katılmaz.
 */
export async function guardNegativeTl(
  db: D1Database,
  body: Record<string, unknown>,
  accounts: Map<number, Account>,
  outgoing: { hesap_id: number; tutar: Dec }[],
  own: { tur: LinkedType; id: number } | null = null
) {
  if (body.eksi_onay === true || body.eksi_onay === 'true' || body.eksi_onay === 1) return;
  const totals = new Map<number, Dec>();
  for (const o of outgoing) {
    if (accounts.get(o.hesap_id)?.para_birimi !== 'TRY' || !o.tutar.gt(d(0))) continue;
    totals.set(o.hesap_id, (totals.get(o.hesap_id) ?? d(0)).add(o.tutar));
  }
  if (!totals.size) return;
  const ids = [...totals.keys()];
  const rows = await all<{ hesap_id: number; b: number }>(
    db,
    `SELECT hesap_id, COALESCE(SUM(CASE WHEN yon = 'GIRIS' THEN tutar - komisyon ELSE -tutar END), 0) AS b
       FROM kasa_hareketleri
      WHERE hesap_id IN (${ids.map(() => '?').join(', ')})${own ? ` AND NOT (COALESCE(bagli_tur, '') = ? AND COALESCE(bagli_id, 0) = ?)` : ''}
      GROUP BY hesap_id`,
    ...ids,
    ...(own ? [own.tur, own.id] : [])
  );
  const balance = new Map(rows.map((r) => [Number(r.hesap_id), d(r.b ?? 0)]));
  const short = ids
    .map((id) => ({ account: accounts.get(id)!, now: balance.get(id) ?? d(0), after: (balance.get(id) ?? d(0)).sub(totals.get(id)!) }))
    .filter((x) => x.after.lt(d('-0.005')));
  if (!short.length) return;
  const tl = (x: Dec) => `${x.q(MONEY_Q).toNumber().toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  throw new NegativeBalance(
    `${short.map((x) => `${x.account.ad} eksiye düşecek: bakiye ${tl(x.now)}, bu işlemden sonra ${tl(x.after)}`).join('; ')}. Yine de kaydedilsin mi?`
  );
}

/** POS girişlerinde bankanın kestiği komisyon. */
export function commission(account: Account, yon: string, tutar: Dec): Dec {
  if (yon !== 'GIRIS' || !(Number(account.komisyon_orani) > 0)) return d(0);
  return tutar.mul(d(account.komisyon_orani)).div(100).q(MONEY_Q);
}

type LinkMeta = { tarih: string; yon: 'GIRIS' | 'CIKIS'; kategori: string; cari: string; aciklama: string; kullanici: string | null };

/**
 * Bir kayda bağlı kasa hareketlerini yazar. `id` null ise aynı batch'te az önce
 * eklenen kayıt kullanılır (AUTOINCREMENT olduğu için en büyük id).
 */
export function linkedStmts(tur: LinkedType, id: number | null, items: KasaItem[], accounts: Map<number, Account>, meta: LinkMeta): Stmt[] {
  const ref = id === null ? `(SELECT MAX(id) FROM ${LINK_TABLE[tur]})` : '?';
  const refArgs = id === null ? [] : [id];
  const stmts: Stmt[] = [];
  if (id !== null) stmts.push({ sql: `DELETE FROM kasa_hareketleri WHERE bagli_tur = ? AND bagli_id = ?`, args: [tur, id] });
  for (const item of items) {
    const account = accounts.get(item.hesap_id)!;
    const kur = account.para_birimi === 'TRY' ? null : item.kur ? item.kur.toNumber() : null;
    stmts.push({
      sql: `INSERT INTO kasa_hareketleri (tarih, hesap_id, yon, tutar, komisyon, kur, kategori, cari, aciklama, bagli_tur, bagli_id, kullanici)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${ref}, ?)`,
      args: [meta.tarih, item.hesap_id, meta.yon, item.tutar.q(MONEY_Q).toNumber(), commission(account, meta.yon, item.tutar).toNumber(), kur,
        meta.kategori, meta.cari, meta.aciklama, tur, ...refArgs, meta.kullanici],
    });
  }
  return stmts;
}

/** Bağlı hareketleri kayıtlara ekler (liste çıktısı için). */
export async function linkedByRecord(db: D1Database, tur: LinkedType): Promise<Map<number, Record<string, unknown>[]>> {
  const rows = await all(
    db,
    `SELECT k.id, k.bagli_id, k.hesap_id, k.tutar, k.komisyon, k.kur, h.ad AS hesap, h.para_birimi
       FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
      WHERE k.bagli_tur = ? ORDER BY k.id`,
    tur
  );
  const map = new Map<number, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = Number(r.bagli_id);
    const item = { hesap_id: r.hesap_id, hesap: r.hesap, para_birimi: r.para_birimi, tutar: money(r.tutar), komisyon: money(r.komisyon), kur: r.kur };
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Hesap bakiyeleri: `upTo` dahil o tarihe kadar (yoksa tüm hareketler). */
export async function balances(db: D1Database, day: string) {
  return all<Account & { bakiye: number; devir: number; giris: number; cikis: number; komisyon: number; hareket_sayisi: number }>(
    db,
    `SELECT h.*,
            COALESCE(SUM(CASE WHEN k.tarih < ?1 THEN (CASE WHEN k.yon = 'GIRIS' THEN k.tutar - k.komisyon ELSE -k.tutar END) END), 0) AS devir,
            COALESCE(SUM(CASE WHEN k.tarih = ?1 AND k.yon = 'GIRIS' THEN k.tutar END), 0) AS giris,
            COALESCE(SUM(CASE WHEN k.tarih = ?1 AND k.yon = 'CIKIS' THEN k.tutar END), 0) AS cikis,
            COALESCE(SUM(CASE WHEN k.tarih = ?1 THEN k.komisyon END), 0) AS komisyon,
            COALESCE(SUM(CASE WHEN k.yon = 'GIRIS' THEN k.tutar - k.komisyon ELSE -k.tutar END), 0) AS bakiye,
            COUNT(k.id) AS hareket_sayisi
       FROM kasa_hesaplari h
       LEFT JOIN kasa_hareketleri k ON k.hesap_id = h.id
      GROUP BY h.id
      ORDER BY h.sira, h.id`,
    day
  );
}
