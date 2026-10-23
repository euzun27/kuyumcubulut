/**
 * Ürün etiketleri: barkodlu parça kaydı (gram, işçilik, etiket fiyatı, taş /
 * pırlanta bilgisi). Satış formunda barkod okutulunca etiket bulunur; satış
 * kaydedilince etiket SATILDI olur (bkz. kuyumcu.ts etiketStmts).
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
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

const withCode = (r: Record<string, any>): Record<string, any> => ({ ...r, barkod: barcodeOf(Number(r.id)) });

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

function parseItem(c: Context<Env>, r: Record<string, unknown>) {
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
  const id = parseBarcode(c.req.param('kod'));
  if (!id) throw new HttpError(400, 'Barkod okunamadı.');
  const row = await first(c.env.DB, `SELECT * FROM etiketler WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Bu barkoda ait etiket yok.');
  return c.json(ok(withCode(row)));
});

/** POST /api/etiket {items: [...], kopya?}: bir veya çok etiket (her biri bir parça). */
etiket.post('/', async (c) => {
  const b = await body(c);
  const raw = Array.isArray(b.items) ? b.items : [b];
  const kopya = b.kopya === undefined ? 1 : Number(b.kopya);
  if (!Number.isInteger(kopya) || kopya < 1 || kopya > MAX_BATCH) throw new ValidationError(`Adet 1 ile ${MAX_BATCH} arasında olmalıdır.`);
  if (!raw.length || raw.length * kopya > MAX_BATCH) throw new ValidationError(`Tek seferde en fazla ${MAX_BATCH} etiket oluşturulur.`);
  const items = raw.map((r) => parseItem(c, (r ?? {}) as Record<string, unknown>));
  const stmts: Stmt[] = [];
  for (const v of items) {
    const cols = Object.keys(v);
    for (let i = 0; i < kopya; i++) stmts.push({ sql: `INSERT INTO etiketler (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(v) });
  }
  const res = await tx(c.env.DB, stmts);
  const rows = res.map((r) => withCode((r.results as any[])[0]));
  await log(c, 'create', rows[0]?.id ?? null, `${rows.length} etiket: ${items[0].cinsi} ${items[0].ayar}`);
  return c.json(ok(rows, `${rows.length} etiket oluşturuldu.`), 201);
});

etiket.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Etiket');
  const v = parseItem(c, await body(c));
  const cols = Object.keys(v);
  const [res] = await tx(c.env.DB, [{ sql: `UPDATE etiketler SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...Object.values(v), id] }]);
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
