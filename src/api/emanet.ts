/**
 * Emanet API'si: müşterinin bıraktığı (ALINAN) veya bizim bir yere
 * bıraktığımız (VERILEN) altın ya da para. Stok, kâr ve cari bakiyeyi
 * etkilemez; teslim edilince "iade" olarak kapatılır.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx } from '../lib/db';
import { d, HAS_Q, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, calcHas, today } from '../lib/validate';
import { normalizeProduct, personName } from '../lib/text';
import { audit } from '../lib/auth';
import { CURRENCIES, date, intId, money, text } from '../lib/kasa';

const emanet = new Hono<Env>();

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'emanetler', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
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
  const kisi = personName(text(b.kisi, 120));
  if (!kisi) throw new ValidationError('Kişi zorunlu.');
  const yon = String(b.yon ?? 'ALINAN').toUpperCase();
  if (yon !== 'ALINAN' && yon !== 'VERILEN') throw new ValidationError('Geçersiz emanet yönü.');
  const tur = String(b.tur ?? 'ALTIN').toUpperCase();
  if (tur !== 'ALTIN' && tur !== 'PARA') throw new ValidationError('Geçersiz emanet türü.');
  const base = { tarih: date(b.tarih, today(tz(c))), kisi, telefon: text(b.telefon, 30), yon, tur, notlar: text(b.notlar, 500) };
  if (tur === 'PARA') {
    const tutar = amount(b.tutar, 'Tutar');
    if (!tutar.gt(0)) throw new ValidationError("Tutar 0'dan büyük olmalıdır.");
    const para_birimi = String(b.para_birimi ?? 'TRY').toUpperCase();
    if (!(CURRENCIES as readonly string[]).includes(para_birimi)) throw new ValidationError('Geçersiz para birimi.');
    return { ...base, cinsi: '', ayar: '', adet: 0, gram: 0, milyem: 0, has: 0, tutar: tutar.q(MONEY_Q).toNumber(), para_birimi };
  }
  const cinsi = normalizeProduct(text(b.cinsi, 80));
  if (!cinsi) throw new ValidationError('Cinsi zorunlu.');
  const adet = amount(b.adet, 'Adet');
  const gram = amount(b.gram, 'Gram');
  const milyem = amount(b.milyem, 'Milyem');
  if (!gram.gt(0) && !adet.gt(0)) throw new ValidationError('Gram veya adet girin.');
  const has = b.has !== undefined && b.has !== '' && b.has !== null ? amount(b.has, 'Has') : calcHas(gram, milyem);
  return {
    ...base, cinsi, ayar: text(b.ayar, 20), adet: adet.q(NUM_Q).toNumber(), gram: gram.q(NUM_Q).toNumber(), milyem: milyem.q(NUM_Q).toNumber(),
    has: has.q(HAS_Q).toNumber(), tutar: 0, para_birimi: 'TRY',
  };
}

function summary(rows: Record<string, any>[]) {
  const open = rows.filter((r) => r.durum === 'ACIK');
  const sum = (list: Record<string, any>[], key: string) => list.reduce((t, r) => t.add(d(r[key] ?? 0)), d(0));
  const para: Record<string, number> = {};
  for (const cur of CURRENCIES) {
    const v = sum(open.filter((r) => r.tur === 'PARA' && r.para_birimi === cur && r.yon === 'ALINAN'), 'tutar');
    if (!v.isZero()) para[cur] = money(v);
  }
  return {
    acik_sayisi: open.length,
    alinan_has: sum(open.filter((r) => r.tur === 'ALTIN' && r.yon === 'ALINAN'), 'has').q(HAS_Q).toNumber(),
    verilen_has: sum(open.filter((r) => r.tur === 'ALTIN' && r.yon === 'VERILEN'), 'has').q(HAS_Q).toNumber(),
    alinan_para: para,
  };
}

emanet.get('/', async (c) => {
  const rows = await all(c.env.DB, `SELECT * FROM emanetler ORDER BY durum = 'IADE', tarih DESC, id DESC`);
  return c.json(ok({ kayitlar: rows, ozet: summary(rows) }));
});

emanet.post('/', async (c) => {
  const v = parse(c, await body(c));
  const cols = Object.keys(v);
  const [res] = await tx(c.env.DB, [{ sql: `INSERT INTO emanetler (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(v) }]);
  const row = (res.results as any[])[0];
  await log(c, 'create', row.id, `${v.yon} emanet: ${v.kisi}`);
  return c.json(ok(row, 'Emanet kaydedildi.'), 201);
});

emanet.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Emanet');
  const v = parse(c, await body(c));
  const cols = Object.keys(v);
  const [res] = await tx(c.env.DB, [{ sql: `UPDATE emanetler SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...Object.values(v), id] }]);
  const row = (res.results as any[])[0];
  if (!row) throw new HttpError(404, 'Emanet bulunamadı.');
  await log(c, 'update', id, `${v.yon} emanet: ${v.kisi}`);
  return c.json(ok(row, 'Emanet güncellendi.'));
});

/** POST /api/emanet/:id/iade {iade: true|false, tarih}: teslim edildi olarak kapatır veya yeniden açar. */
emanet.post('/:id/iade', async (c) => {
  const id = intId(c.req.param('id'), 'Emanet');
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const reopen = b.iade === false;
  const row = await first(c.env.DB, `SELECT * FROM emanetler WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Emanet bulunamadı.');
  const tarih = reopen ? null : date(b.tarih, today(tz(c)));
  await tx(c.env.DB, [{ sql: `UPDATE emanetler SET durum = ?, iade_tarihi = ? WHERE id = ?`, args: [reopen ? 'ACIK' : 'IADE', tarih, id] }]);
  await log(c, 'update', id, reopen ? `Emanet yeniden açıldı: ${row.kisi}` : `Emanet teslim edildi: ${row.kisi}`);
  return c.json(ok({ id, durum: reopen ? 'ACIK' : 'IADE', iade_tarihi: tarih }, reopen ? 'Emanet yeniden açıldı.' : 'Emanet teslim edildi.'));
});

emanet.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Emanet');
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM emanetler WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Emanet bulunamadı.');
  await log(c, 'delete', id, 'Emanet silindi');
  return c.json(ok({ id }, 'Emanet silindi.'));
});

export default emanet;
