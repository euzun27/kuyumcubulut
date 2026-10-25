/**
 * Ürün etiketleri: barkodlu parça kaydı (gram, işçilik, etiket fiyatı, taş /
 * pırlanta bilgisi). Satış formunda barkod okutulunca etiket bulunur; satış
 * kaydedilince etiket SATILDI olur (bkz. kuyumcu.ts etiketStmts).
 */

import { Hono, type Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today, calcHas } from '../lib/validate';
import { normalizeProduct } from '../lib/text';
import { audit } from '../lib/auth';
import { date, intId, text } from '../lib/kasa';

const etiket = new Hono<Env>();

export const STONE_TYPES = ['', 'PIRLANTA', 'RENKLI', 'ZIRKON', 'INCI', 'DIGER'] as const;
const MAX_BATCH = 200;

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

/** "DT000123", "dt123" veya "123" -> 123 */
export function parseBarcode(value: unknown): number | null {
  const m = /^\s*(?:DT)?0*(\d{1,9})\s*$/i.exec(String(value ?? ''));
  return m ? Number(m[1]) : null;
}

export const barcodeOf = (id: number) => `DT${String(id).padStart(6, '0')}`;

/**
 * Okutulan barkodun etiketi: önce eski programın barkodu (sayımda kaydedilen),
 * sonra bizim DT numarası. Eski barkod sayısal olabilir, bu yüzden önce o aranır.
 */
export async function findByCode(db: D1Database, code: unknown): Promise<Record<string, any> | null> {
  const kod = String(code ?? '').trim();
  if (!kod) return null;
  const old = await first(db, `SELECT * FROM etiketler WHERE eski_barkod = ? ORDER BY durum = 'STOKTA' DESC, id DESC LIMIT 1`, kod);
  if (old) return old;
  const id = parseBarcode(kod);
  return id ? first(db, `SELECT * FROM etiketler WHERE id = ?`, id) : null;
}

export const withCode = (r: Record<string, any>): Record<string, any> => ({ ...r, barkod: barcodeOf(Number(r.id)) });

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'etiketler', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function amount(value: unknown, label: string, q = NUM_Q) {
  if (value === undefined || value === null || value === '') return 0;
  let n;
  try {
    n = d(value);
  } catch {
    throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`);
  }
  if (n.lt(0)) throw new ValidationError(`${label} negatif olamaz.`);
  return n.q(q).toNumber();
}

export function parseItem(c: Context<Env>, r: Record<string, unknown>) {
  const cinsi = normalizeProduct(text(r.cinsi, 80));
  if (!cinsi) throw new ValidationError('Cinsi zorunlu.');
  const tas = String(r.tas_tipi ?? '').toUpperCase();
  if (!(STONE_TYPES as readonly string[]).includes(tas)) throw new ValidationError('Geçersiz taş türü.');
  const tasAdet = r.tas_adet === undefined || r.tas_adet === '' || r.tas_adet === null ? 0 : Number(r.tas_adet);
  if (!Number.isInteger(tasAdet) || tasAdet < 0 || tasAdet > 9999) throw new ValidationError('Taş adedi tam sayı olmalıdır.');
  const gram = amount(r.gram, 'Gram');
  const fiyat = amount(r.fiyat, 'Etiket fiyatı', MONEY_Q);
  if (!gram && !fiyat) throw new ValidationError('Gram veya etiket fiyatı girin.');
  return {
    tarih: date(r.tarih, today(tz(c))),
    alis_id: r.alis_id === undefined || r.alis_id === null || r.alis_id === '' ? null : intId(r.alis_id, 'Alış kaydı'),
    cinsi,
    ayar: text(r.ayar, 20),
    model: text(r.model, 60),
    gram,
    milyem: amount(r.milyem, 'Milyem'),
    iscilik: amount(r.iscilik, 'İşçilik', MONEY_Q),
    fiyat,
    tas_tipi: tas,
    tas_adet: tasAdet,
    karat: amount(r.karat, 'Karat'),
    renk: text(r.renk, 10).toUpperCase(),
    berraklik: text(r.berraklik, 10).toUpperCase(),
    kesim: text(r.kesim, 40),
    sertifika: text(r.sertifika, 60),
    notlar: text(r.notlar, 300),
  };
}

etiket.get('/', async (c) => {
  const durum = String(c.req.query('durum') ?? 'STOKTA').toUpperCase();
  const where = durum === 'ALL' ? '' : `WHERE durum = '${durum === 'SATILDI' ? 'SATILDI' : 'STOKTA'}'`;
  const rows = await all(c.env.DB, `SELECT * FROM etiketler ${where} ORDER BY id DESC`);
  const stock = rows.filter((r) => r.durum === 'STOKTA');
  const sum = (key: string) => stock.reduce((t, r) => t.add(d(r[key] ?? 0)), d(0));
  return c.json(ok({
    kayitlar: rows.map(withCode),
    ozet: { stokta: stock.length, gram: sum('gram').q(NUM_Q).toNumber(), karat: sum('karat').q(NUM_Q).toNumber(), fiyat: sum('fiyat').q(MONEY_Q).toNumber(), pirlanta: stock.filter((r) => r.tas_tipi === 'PIRLANTA').length },
  }));
});

/** GET /api/etiket/kod/DT000123: barkod okutma. */
etiket.get('/kod/:kod', async (c) => {
  const row = await findByCode(c.env.DB, c.req.param('kod'));
  if (!row) throw new HttpError(404, 'Bu barkoda ait etiket yok.');
  return c.json(ok(withCode(row)));
});

/** Etiketten stoğa alınan ürünlerin alış kaydındaki tedarikçi adı. */
export const ACILIS_TEDARIKCI = 'AÇILIŞ STOĞU';

/**
 * Açılış stoğu alışı (etiketten stoğa alma ve stok sayımı): ödemesi kapalıdır (TAM_KAPAT, kasa hareketi
 * yok), böylece cari ve kasa değişmez; stok ve FIFO maliyeti oluşur. Maliyet
 * olarak sayımın has fiyatı (genelde günün alış fiyatı) yazılır.
 */
export function stockStmt(v: { cinsi: unknown; ayar: unknown; gram: unknown; milyem: unknown }, hasFiyati: number, tarih: string, not: string): Stmt {
  const has = calcHas(v.gram, v.milyem).toNumber();
  const row = {
    tarih, tedarikci: ACILIS_TEDARIKCI, cinsi: v.cinsi, ayar: v.ayar, adet: 1, gram: v.gram, milyem: v.milyem, has, has_fiyati: hasFiyati,
    iscilik: 0, ek_masraf: 0, odenen: 0, notlar: not, odeme_tipi: 'TAM_KAPAT', odenen_has: has, odenen_adet: 0, odenen_gram: 0, odenen_milyem: 0,
  };
  const cols = Object.keys(row);
  return { sql: `INSERT INTO alis (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: Object.values(row) };
}

function stockOptions(c: Context<Env>, b: Record<string, unknown>) {
  const hasFiyati = amount(b.has_fiyati, 'Maliyet has fiyatı', MONEY_Q);
  if (!hasFiyati) throw new ValidationError('Stoğa almak için maliyet has fiyatını girin.');
  return { hasFiyati, tarih: date(b.tarih as string | undefined, today(tz(c))) };
}

/** POST /api/etiket {items: [...], kopya?}: bir veya çok etiket (her biri bir parça). */
etiket.post('/', async (c) => {
  const b = await body(c);
  const raw = Array.isArray(b.items) ? b.items : [b];
  const kopya = b.kopya === undefined ? 1 : Number(b.kopya);
  if (!Number.isInteger(kopya) || kopya < 1 || kopya > MAX_BATCH) throw new ValidationError(`Adet 1 ile ${MAX_BATCH} arasında olmalıdır.`);
  if (!raw.length || raw.length * kopya > MAX_BATCH) throw new ValidationError(`Tek seferde en fazla ${MAX_BATCH} etiket oluşturulur.`);
  const items = raw.map((r) => parseItem(c, (r ?? {}) as Record<string, unknown>));
  // stoga_al: elindeki ürünü etiketleyen kuyumcu için her parçaya açılış stoğu alışı.
  const stok = b.stoga_al ? stockOptions(c, b) : null;
  if (stok && items.some((v) => !Number(v.gram) || !Number(v.milyem))) throw new ValidationError('Stoğa almak için gram ve milyem girin.');
  const stmts: Stmt[] = [];
  for (const v of items) {
    const cols = Object.keys(v).filter((k) => !(stok && k === 'alis_id'));
    const args = cols.map((k) => v[k as keyof typeof v]);
    for (let i = 0; i < kopya; i++) {
      if (stok) stmts.push(stockStmt(v, stok.hasFiyati, stok.tarih, 'Etiketten açılış stoğu'));
      const allCols = stok ? [...cols, 'alis_id'] : cols;
      stmts.push({ sql: `INSERT INTO etiketler (${allCols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}${stok ? ', (SELECT MAX(id) FROM alis)' : ''}) RETURNING *`, args });
    }
  }
  const res = await tx(c.env.DB, stmts);
  const rows = res.filter((r) => (r.results as any[] | undefined)?.length).map((r) => withCode((r.results as any[])[0]));
  await log(c, 'create', rows[0]?.id ?? null, `${rows.length} etiket: ${items[0].cinsi} ${items[0].ayar}${stok ? ' (stoğa alındı)' : ''}`);
  return c.json(ok(rows, `${rows.length} etiket oluşturuldu${stok ? ' ve stoğa alındı' : ''}.`), 201);
});

/**
 * POST /api/etiket/stoga-al {ids, has_fiyati, tarih?}: daha önce oluşturulmuş,
 * satılmamış ve stoğa alınmamış etiketler için açılış stoğu alışı açar.
 */
etiket.post('/stoga-al', async (c) => {
  const b = await body(c);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new ValidationError('Etiket seçin.');
  if (ids.length > MAX_BATCH) throw new ValidationError(`Tek seferde en fazla ${MAX_BATCH} etiket stoğa alınır.`);
  const stok = stockOptions(c, b);
  const rows = await all(c.env.DB, `SELECT * FROM etiketler WHERE id IN (${ids.map(() => '?').join(', ')}) AND durum = 'STOKTA' AND alis_id IS NULL ORDER BY id`, ...ids);
  if (!rows.length) throw new ValidationError('Seçilen etiketler zaten stoğa alınmış ya da satılmış.');
  const missing = rows.filter((r) => !Number(r.gram) || !Number(r.milyem));
  if (missing.length) throw new ValidationError(`${missing.map((r) => barcodeOf(Number(r.id))).join(', ')}: gram ve milyem olmadan stoğa alınamaz.`);
  const stmts: Stmt[] = [];
  for (const r of rows) {
    stmts.push(stockStmt(r, stok.hasFiyati, stok.tarih, `Etiket ${barcodeOf(Number(r.id))}`));
    stmts.push({ sql: `UPDATE etiketler SET alis_id = (SELECT MAX(id) FROM alis) WHERE id = ?`, args: [r.id] });
  }
  await tx(c.env.DB, stmts);
  await log(c, 'update', Number(rows[0].id), `${rows.length} etiket stoğa alındı (açılış stoğu)`);
  return c.json(ok({ adet: rows.length, atlanan: ids.length - rows.length }, `${rows.length} etiket stoğa alındı.`));
});

etiket.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Etiket');
  const b = await body(c);
  const v = parseItem(c, b);
  // Formda alış bağı yok; gönderilmediyse stoğa alınmış etiketin bağı korunur.
  const cols = Object.keys(v).filter((k) => k !== 'alis_id' || b.alis_id !== undefined);
  const args = cols.map((k) => v[k as keyof typeof v]);
  const [res] = await tx(c.env.DB, [{ sql: `UPDATE etiketler SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...args, id] }]);
  const row = (res.results as any[])[0];
  if (!row) throw new HttpError(404, 'Etiket bulunamadı.');
  await log(c, 'update', id, `Etiket ${barcodeOf(id)}`);
  return c.json(ok(withCode(row), 'Etiket güncellendi.'));
});

etiket.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Etiket');
  const row = await first(c.env.DB, `SELECT durum FROM etiketler WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Etiket bulunamadı.');
  if (row.durum === 'SATILDI') throw new HttpError(400, 'Satılmış etiket silinemez; önce satışı silin.');
  await tx(c.env.DB, [{ sql: `DELETE FROM etiketler WHERE id = ?`, args: [id] }]);
  await log(c, 'delete', id, `Etiket ${barcodeOf(id)} silindi`);
  return c.json(ok({ id }, 'Etiket silindi.'));
});

/**
 * Satışa bağlanan etiket: `etiket_id` gövdede varsa o etiket SATILDI olur.
 * id null ise aynı batch'te eklenen satış kullanılır. Düzenlemede eski etiket
 * stoğa döner. Alan hiç yoksa (undefined) etiket bağlantısı değişmez.
 */
export async function etiketStmts(c: Context<Env>, raw: unknown, saleId: number | null): Promise<Stmt[]> {
  if (raw === undefined) return [];
  const stmts: Stmt[] = [];
  if (saleId !== null) stmts.push({ sql: `UPDATE etiketler SET durum = 'STOKTA', satis_id = NULL WHERE satis_id = ?`, args: [saleId] });
  if (raw === null || raw === '') return stmts;
  const id = parseBarcode(raw);
  if (!id) throw new ValidationError('Etiket numarası geçersiz.');
  const row = await first(c.env.DB, `SELECT durum, satis_id FROM etiketler WHERE id = ?`, id);
  if (!row) throw new ValidationError('Etiket bulunamadı.');
  if (row.durum === 'SATILDI' && Number(row.satis_id) !== saleId) throw new ValidationError(`${barcodeOf(id)} etiketli ürün zaten satılmış.`);
  stmts.push({
    sql: `UPDATE etiketler SET durum = 'SATILDI', satis_id = ${saleId === null ? '(SELECT MAX(id) FROM satis)' : '?'} WHERE id = ?`,
    args: saleId === null ? [id] : [saleId, id],
  });
  return stmts;
}

export default etiket;
