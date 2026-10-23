/**
 * Sipariş ve tamir takibi: müşteriden alınan iş, atölyeye gidişi, hazır
 * olması ve teslimi. Kapora ile teslimde alınan para kasaya bağlı hareket
 * olarak yazılır; stok ve has cari bakiyesi etkilenmez (ürün satılırken
 * normal satış kaydı girilir).
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { normalizeProduct, personName } from '../lib/text';
import { audit } from '../lib/auth';
import { checkItems, date, intId, linkedByRecord, linkedStmts, loadAccounts, money, parseKasaItems, text, type LinkedType } from '../lib/kasa';

const siparis = new Hono<Env>();

export const ORDER_TYPES = ['SIPARIS', 'TAMIR'] as const;
export const ORDER_STATES = ['ALINDI', 'ATOLYEDE', 'HAZIR', 'TESLIM', 'IPTAL'] as const;
export const OPEN_STATES = ['ALINDI', 'ATOLYEDE', 'HAZIR'];

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'siparisler', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T, label: string): T {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toUpperCase();
  if (!values.includes(v as T)) throw new ValidationError(`Geçersiz ${label}.`);
  return v as T;
}

function amount(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return d(0);
  let n;
  try {
    n = d(value);
  } catch {
    throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`);
  }
  if (n.lt(0)) throw new ValidationError(`${label} negatif olamaz.`);
  return n;
}

function parse(c: Context<Env>, b: Record<string, unknown>) {
  const musteri = personName(text(b.musteri, 120));
  if (!musteri) throw new ValidationError('Müşteri zorunlu.');
  const urun = text(b.urun, 300);
  if (!urun) throw new ValidationError('Ürün veya yapılacak iş zorunlu.');
  const tarih = date(b.tarih, today(tz(c)));
  const teslim = b.teslim_tarihi ? date(b.teslim_tarihi, tarih) : null;
  if (teslim && teslim < tarih) throw new ValidationError('Teslim tarihi kayıt tarihinden önce olamaz.');
  return {
    tarih,
    tur: oneOf(b.tur, ORDER_TYPES, 'SIPARIS', 'kayıt türü'),
    musteri,
    telefon: text(b.telefon, 30),
    urun,
    cinsi: normalizeProduct(text(b.cinsi, 80)),
    ayar: text(b.ayar, 20),
    gram: amount(b.gram, 'Gram').q(NUM_Q).toNumber(),
    tutar: amount(b.tutar, 'Fiyat').q(MONEY_Q).toNumber(),
    teslim_tarihi: teslim,
    atolye: personName(text(b.atolye, 120)),
    notlar: text(b.notlar, 500),
  };
}

async function kasaStmts(c: Context<Env>, raw: unknown, tur: LinkedType, id: number | null, meta: { tarih: string; cari: string; kategori: string }): Promise<Stmt[] | null> {
  const items = parseKasaItems(raw);
  if (items === null) return null;
  const accounts = await loadAccounts(c.env.DB);
  checkItems(items, accounts);
  return linkedStmts(tur, id, items, accounts, { ...meta, yon: 'GIRIS', aciklama: '', kullanici: c.get('user')?.name ?? null });
}

const tlOf = (items: Record<string, unknown>[]) => items.reduce((t, k) => t.add(d(k.tutar as number).mul(d((k.kur as number) || 1))), d(0));

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Kayıt + kasaya bağlı kapora/teslim ödemeleri + kalan ve gecikme bilgisi. */
export function orderOut(r: Record<string, any>, kapora: Record<string, unknown>[], teslim: Record<string, unknown>[], day: string): Record<string, any> {
  const alinan = tlOf(kapora).add(tlOf(teslim));
  const open = OPEN_STATES.includes(r.durum);
  const kalan = d(r.tutar ?? 0).gt(0) ? d(r.tutar).sub(alinan) : d(0);
  return {
    ...r,
    kapora_odemeleri: kapora,
    teslim_odemeleri: teslim,
    kapora: money(tlOf(kapora)),
    alinan_tl: money(alinan),
    kalan_tl: money(kalan.gt(0) ? kalan : d(0)),
    gecikme_gun: open && r.teslim_tarihi ? Math.max(daysBetween(r.teslim_tarihi, day), 0) : 0,
    kalan_gun: open && r.teslim_tarihi ? daysBetween(day, r.teslim_tarihi) : null,
  };
}

export async function loadOrders(c: Context<Env>) {
  const [rows, kapora, teslim] = await Promise.all([
    all(c.env.DB, `SELECT * FROM siparisler ORDER BY durum IN ('TESLIM', 'IPTAL'), COALESCE(teslim_tarihi, '9999'), tarih DESC, id DESC`),
    linkedByRecord(c.env.DB, 'siparis'),
    linkedByRecord(c.env.DB, 'siparis_teslim'),
  ]);
  const day = today(tz(c));
  return rows.map((r) => orderOut(r, kapora.get(Number(r.id)) ?? [], teslim.get(Number(r.id)) ?? [], day));
}

function summary(rows: ReturnType<typeof orderOut>[]) {
  const open = rows.filter((r) => OPEN_STATES.includes(r.durum));
  return {
    acik: open.length,
    atolyede: open.filter((r) => r.durum === 'ATOLYEDE').length,
    hazir: open.filter((r) => r.durum === 'HAZIR').length,
    geciken: open.filter((r) => r.gecikme_gun > 0).length,
    bugun: open.filter((r) => r.kalan_gun === 0).length,
    alinan_kapora: money(open.reduce((t, r) => t.add(d(r.alinan_tl)), d(0))),
  };
}

siparis.get('/', async (c) => {
  const rows = await loadOrders(c);
  return c.json(ok({ kayitlar: rows, ozet: summary(rows) }));
});

siparis.post('/', async (c) => {
  const b = await body(c);
  const v = parse(c, b);
  const durum = oneOf(b.durum, ['ALINDI', 'ATOLYEDE', 'HAZIR'] as const, 'ALINDI', 'durum');
  const values = { ...v, durum };
  const cols = Object.keys(values);
  const kasa = (await kasaStmts(c, b.kasa, 'siparis', null, { tarih: v.tarih, cari: v.musteri, kategori: 'SIPARIS_KAPORA' })) ?? [];
  const [res] = await tx(c.env.DB, [
    { sql: `INSERT INTO siparisler (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(values) },
    ...kasa,
  ]);
  const row = (res.results as any[])[0];
  await log(c, 'create', row.id, `${v.tur === 'TAMIR' ? 'Tamir' : 'Sipariş'}: ${v.musteri} - ${v.urun}`);
  return c.json(ok(row, v.tur === 'TAMIR' ? 'Tamir kaydı alındı.' : 'Sipariş kaydedildi.'), 201);
});

siparis.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Sipariş');
  const b = await body(c);
  const v = parse(c, b);
  const existing = await first(c.env.DB, `SELECT * FROM siparisler WHERE id = ?`, id);
  if (!existing) throw new HttpError(404, 'Sipariş bulunamadı.');
  const cols = Object.keys(v);
  const kasa = (await kasaStmts(c, b.kasa, 'siparis', id, { tarih: v.tarih, cari: v.musteri, kategori: 'SIPARIS_KAPORA' })) ?? [
    { sql: `UPDATE kasa_hareketleri SET tarih = ?, cari = ? WHERE bagli_tur = 'siparis' AND bagli_id = ?`, args: [v.tarih, v.musteri, id] },
  ];
  const [res] = await tx(c.env.DB, [
    { sql: `UPDATE siparisler SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...Object.values(v), id] },
    { sql: `UPDATE kasa_hareketleri SET cari = ? WHERE bagli_tur = 'siparis_teslim' AND bagli_id = ?`, args: [v.musteri, id] },
    ...kasa,
  ]);
  await log(c, 'update', id, `${v.tur === 'TAMIR' ? 'Tamir' : 'Sipariş'}: ${v.musteri} - ${v.urun}`);
  return c.json(ok((res.results as any[])[0], 'Kayıt güncellendi.'));
});

const STATE_TEXT: Record<string, string> = { ALINDI: 'alındı', ATOLYEDE: 'atölyede', HAZIR: 'hazır', TESLIM: 'teslim edildi', IPTAL: 'iptal edildi' };

/**
 * POST /api/siparis/:id/durum {durum, tarih?, atolye?, kasa?}
 * TESLIM: teslim günü yazılır, `kasa` varsa teslimde alınan para kaydedilir.
 * Başka bir duruma dönülürse teslim ödemesi silinir.
 */
siparis.post('/:id/durum', async (c) => {
  const id = intId(c.req.param('id'), 'Sipariş');
  const b = await body(c);
  const durum = oneOf(b.durum, ORDER_STATES, 'ALINDI', 'durum');
  const row = await first(c.env.DB, `SELECT * FROM siparisler WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Sipariş bulunamadı.');
  const tarih = date(b.tarih, today(tz(c)));
  const atolye = b.atolye === undefined ? String(row.atolye ?? '') : personName(text(b.atolye, 120));
  if (durum === 'ATOLYEDE' && !atolye) throw new ValidationError('Atölye adını girin.');
  const stmts: Stmt[] = [
    { sql: `UPDATE siparisler SET durum = ?, atolye = ?, teslim_edildi = ? WHERE id = ?`, args: [durum, atolye, durum === 'TESLIM' ? tarih : null, id] },
  ];
  if (durum === 'TESLIM') {
    const kasa = await kasaStmts(c, b.kasa, 'siparis_teslim', id, { tarih, cari: String(row.musteri), kategori: 'SIPARIS_TESLIM' });
    if (kasa) stmts.push(...kasa);
  } else {
    stmts.push({ sql: `DELETE FROM kasa_hareketleri WHERE bagli_tur = 'siparis_teslim' AND bagli_id = ?`, args: [id] });
  }
  await tx(c.env.DB, stmts);
  await log(c, 'update', id, `${row.musteri} - ${row.urun}: ${STATE_TEXT[durum]}`);
  return c.json(ok({ id, durum }, `Kayıt ${STATE_TEXT[durum]}.`));
});

siparis.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Sipariş');
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM siparisler WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Sipariş bulunamadı.');
  await log(c, 'delete', id, 'Sipariş/tamir kaydı silindi');
  return c.json(ok({ id }, 'Kayıt silindi.'));
});

export default siparis;
