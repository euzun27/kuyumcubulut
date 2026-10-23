/**
 * Atölye takibi: atölyeye verilen iş, işin hangi aşamada olduğu, verilen ve
 * geri gelen maden (gram, milyem, has), fire ve işçilik.
 *
 * Kuyum imalatında iş şu aşamalardan geçer (işe göre bazıları atlanır):
 *   atölyeye verildi -> model / mum -> döküm -> tesviye / montaj ->
 *   kaynak / lehim -> mıhlama (taş) -> cila / polisaj -> rodaj / kaplama ->
 *   kontrol / damga -> hazır
 * Dönüşte gelen has, verilen hastan düşülür; aradaki fark firedir.
 *
 * İş bir siparişe bağlıysa atölyeye verilince sipariş "Atölyede", geri
 * gelince "Hazır" olur. Has cari bakiyesi ve stok bu tablodan etkilenmez.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, Dec, HAS_Q, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { audit } from '../lib/auth';
import { date, intId, money, text } from '../lib/kasa';
import { personName } from '../lib/text';

const atolye = new Hono<Env>();

/** [kod, ad, imalatta, tamirde] */
export const STAGES: [string, string, boolean, boolean][] = [
  ['VERILDI', 'Atölyeye verildi', true, true],
  ['MODEL', 'Model / mum', true, false],
  ['DOKUM', 'Döküm', true, false],
  ['TESVIYE', 'Tesviye / montaj', true, true],
  ['KAYNAK', 'Kaynak / lehim', true, true],
  ['MIHLAMA', 'Mıhlama (taş)', true, true],
  ['CILA', 'Cila / polisaj', true, true],
  ['KAPLAMA', 'Rodaj / kaplama', true, true],
  ['KONTROL', 'Kontrol / damga', true, true],
  ['HAZIR', 'Hazır, alınmayı bekliyor', true, true],
];
const STAGE_CODES = STAGES.map(([k]) => k);
const STAGE_NAME = Object.fromEntries(STAGES.map(([k, n]) => [k, n])) as Record<string, string>;
export const JOB_TYPES = ['IMALAT', 'TAMIR'] as const;

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';
const userName = (c: Context<Env>) => c.get('user')?.name ?? null;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'atolye_isleri', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function amount(value: unknown, label: string): Dec {
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

function milyemOf(value: unknown, label: string): Dec {
  const n = amount(value, label);
  if (n.gt(1000)) throw new ValidationError(`${label} 1000'den büyük olamaz.`);
  return n;
}

const hasOf = (gram: Dec, milyem: Dec) => gram.mul(milyem).div(1000).q(HAS_Q);

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function parse(c: Context<Env>, b: Record<string, unknown>) {
  const atolyeAdi = personName(text(b.atolye, 120));
  if (!atolyeAdi) throw new ValidationError('Atölye adını girin.');
  const isTanimi = text(b.is_tanimi, 300);
  if (!isTanimi) throw new ValidationError('Yapılacak işi yazın.');
  const tur = String(b.tur ?? 'IMALAT').trim().toUpperCase();
  if (!(JOB_TYPES as readonly string[]).includes(tur)) throw new ValidationError('İş türü imalat veya tamir olmalı.');
  const metal = String(b.metal ?? 'ALTIN').trim().toUpperCase();
  if (metal !== 'ALTIN' && metal !== 'GUMUS') throw new ValidationError('Maden altın veya gümüş olmalı.');
  const tarih = date(b.tarih, today(tz(c)));
  const soz = b.soz_tarihi ? date(b.soz_tarihi, tarih) : null;
  if (soz && soz < tarih) throw new ValidationError('Atölyenin dönüş günü veriliş gününden önce olamaz.');
  const gram = amount(b.verilen_gram, 'Verilen gram');
  const milyem = milyemOf(b.verilen_milyem, 'Verilen milyem');
  const siparisId = b.siparis_id === undefined || b.siparis_id === null || b.siparis_id === '' ? null : intId(b.siparis_id, 'Sipariş');
  return {
    tarih,
    atolye: atolyeAdi,
    tur,
    is_tanimi: isTanimi,
    siparis_id: siparisId,
    metal,
    verilen_gram: gram.q(NUM_Q).toNumber(),
    verilen_milyem: milyem.q(NUM_Q).toNumber(),
    verilen_has: hasOf(gram, milyem).toNumber(),
    iscilik_tl: amount(b.iscilik_tl, 'İşçilik').q(MONEY_Q).toNumber(),
    soz_tarihi: soz,
    notlar: text(b.notlar, 500),
  };
}

type Row = Record<string, any>;

export function jobOut(r: Row, steps: Row[], day: string): Row {
  const open = r.durum === 'ATOLYEDE';
  const verilen = d(r.verilen_has);
  return {
    ...r,
    asama_adi: STAGE_NAME[r.asama] ?? r.asama,
    asamalar: steps.map((s) => ({ ...s, asama_adi: STAGE_NAME[s.asama] ?? (s.asama === 'DONDU' ? 'Atölyeden alındı' : s.asama) })),
    atolyedeki_has: open ? verilen.toNumber() : 0,
    fire_orani: r.durum === 'DONDU' && verilen.gt(0) ? d(r.fire_has).mul(100).div(verilen).q(2).toNumber() : null,
    gun: daysBetween(r.tarih, open ? day : r.donus_tarihi || day),
    gecikme_gun: open && r.soz_tarihi ? Math.max(daysBetween(r.soz_tarihi, day), 0) : 0,
    kalan_gun: open && r.soz_tarihi ? daysBetween(day, r.soz_tarihi) : null,
  };
}

export async function loadJobs(c: Context<Env>) {
  const [rows, steps] = await Promise.all([
    all(c.env.DB, `SELECT * FROM atolye_isleri ORDER BY durum <> 'ATOLYEDE', COALESCE(soz_tarihi, '9999'), tarih DESC, id DESC`),
    all(c.env.DB, `SELECT * FROM atolye_asamalari ORDER BY is_id, id`),
  ]);
  const byJob = new Map<number, Row[]>();
  for (const s of steps) {
    const list = byJob.get(Number(s.is_id));
    if (list) list.push(s);
    else byJob.set(Number(s.is_id), [s]);
  }
  const day = today(tz(c));
  return rows.map((r) => jobOut(r, byJob.get(Number(r.id)) ?? [], day));
}

function summary(rows: Row[], day: string) {
  const open = rows.filter((r) => r.durum === 'ATOLYEDE');
  const month = day.slice(0, 7);
  const done = rows.filter((r) => r.durum === 'DONDU');
  const sum = (list: Row[], key: string) => list.reduce((t, r) => t.add(d(r[key] ?? 0)), d(0));
  const per = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.durum === 'IPTAL') continue;
    const list = per.get(r.atolye);
    if (list) list.push(r);
    else per.set(r.atolye, [r]);
  }
  const atolyeler = [...per].map(([ad, list]) => {
    const fin = list.filter((r) => r.durum === 'DONDU');
    const verilen = sum(fin, 'verilen_has');
    const fire = sum(fin, 'fire_has');
    return {
      atolye: ad,
      acik_is: list.filter((r) => r.durum === 'ATOLYEDE').length,
      biten_is: fin.length,
      atolyedeki_has: sum(list.filter((r) => r.durum === 'ATOLYEDE' && r.metal === 'ALTIN'), 'verilen_has').q(HAS_Q).toNumber(),
      toplam_fire_has: fire.q(HAS_Q).toNumber(),
      fire_orani: verilen.gt(0) ? fire.mul(100).div(verilen).q(2).toNumber() : null,
      iscilik_tl: money(sum(fin, 'iscilik_tl')),
      iscilik_has: sum(fin, 'iscilik_has').q(HAS_Q).toNumber(),
    };
  }).sort((a, b) => b.acik_is - a.acik_is || a.atolye.localeCompare(b.atolye, 'tr'));
  const gold = (list: Row[]) => list.filter((r) => r.metal === 'ALTIN');
  return {
    ozet: {
      acik: open.length,
      hazir: open.filter((r) => r.asama === 'HAZIR').length,
      geciken: open.filter((r) => r.gecikme_gun > 0).length,
      atolyedeki_has: sum(gold(open), 'verilen_has').q(HAS_Q).toNumber(),
      atolyedeki_gumus: sum(open.filter((r) => r.metal === 'GUMUS'), 'verilen_has').q(HAS_Q).toNumber(),
      bu_ay_fire_has: sum(gold(done.filter((r) => String(r.donus_tarihi || '').startsWith(month))), 'fire_has').q(HAS_Q).toNumber(),
    },
    atolyeler,
  };
}

atolye.get('/', async (c) => {
  const rows = await loadJobs(c);
  return c.json(ok({ kayitlar: rows, ...summary(rows, today(tz(c))), asamalar: STAGES.map(([kod, ad, imalat, tamir]) => ({ kod, ad, imalat, tamir })) }));
});

/** Sipariş açık mı; atölyeye verilen işin bağlanacağı sipariş. */
async function openOrder(c: Context<Env>, id: number | null) {
  if (id === null) return null;
  const row = await first(c.env.DB, `SELECT * FROM siparisler WHERE id = ?`, id);
  if (!row) throw new ValidationError('Bağlanacak sipariş bulunamadı.');
  if (!['ALINDI', 'ATOLYEDE', 'HAZIR'].includes(String(row.durum))) throw new ValidationError('Teslim edilmiş veya iptal edilmiş siparişe atölye işi bağlanamaz.');
  return row;
}

atolye.post('/', async (c) => {
  const v = parse(c, await body(c));
  await openOrder(c, v.siparis_id);
  const cols = Object.keys(v);
  const stmts: Stmt[] = [
    { sql: `INSERT INTO atolye_isleri (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(v) },
    { sql: `INSERT INTO atolye_asamalari (is_id, tarih, asama, notlar, kullanici) VALUES ((SELECT MAX(id) FROM atolye_isleri), ?, 'VERILDI', '', ?)`, args: [v.tarih, userName(c)] },
  ];
  if (v.siparis_id !== null) stmts.push({ sql: `UPDATE siparisler SET durum = 'ATOLYEDE', atolye = ?, teslim_edildi = NULL WHERE id = ?`, args: [v.atolye, v.siparis_id] });
  const [res] = await tx(c.env.DB, stmts);
  const row = (res.results as any[])[0];
  await log(c, 'create', row.id, `Atölyeye verildi: ${v.atolye} - ${v.is_tanimi}`);
  return c.json(ok(row, 'İş atölyeye verildi.'), 201);
});

atolye.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Atölye işi');
  const b = await body(c);
  const v = parse(c, b);
  const row = await first(c.env.DB, `SELECT * FROM atolye_isleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Atölye işi bulunamadı.');
  if (v.siparis_id !== null && Number(row.siparis_id) !== v.siparis_id) await openOrder(c, v.siparis_id);
  // Dönmüş işte verilen has değişirse fire yeniden hesaplanır.
  const values: Record<string, unknown> = { ...v };
  if (row.durum === 'DONDU') values.fire_has = d(v.verilen_has).sub(d(row.gelen_has)).q(HAS_Q).toNumber();
  const cols = Object.keys(values);
  const [res] = await tx(c.env.DB, [
    { sql: `UPDATE atolye_isleri SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...Object.values(values), id] },
  ]);
  await log(c, 'update', id, `${v.atolye} - ${v.is_tanimi}`);
  return c.json(ok((res.results as any[])[0], 'Atölye işi güncellendi.'));
});

/** POST /api/atolye/:id/asama {asama, tarih?, notlar?}: iş bir sonraki aşamaya geçer. */
atolye.post('/:id/asama', async (c) => {
  const id = intId(c.req.param('id'), 'Atölye işi');
  const b = await body(c);
  const asama = String(b.asama ?? '').trim().toUpperCase();
  if (!STAGE_CODES.includes(asama)) throw new ValidationError('Geçersiz aşama.');
  const row = await first(c.env.DB, `SELECT * FROM atolye_isleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Atölye işi bulunamadı.');
  if (row.durum !== 'ATOLYEDE') throw new ValidationError('Atölyeden alınmış işin aşaması değiştirilemez.');
  const tarih = date(b.tarih, today(tz(c)));
  await tx(c.env.DB, [
    { sql: `UPDATE atolye_isleri SET asama = ? WHERE id = ?`, args: [asama, id] },
    { sql: `INSERT INTO atolye_asamalari (is_id, tarih, asama, notlar, kullanici) VALUES (?, ?, ?, ?, ?)`, args: [id, tarih, asama, text(b.notlar, 300), userName(c)] },
  ]);
  await log(c, 'update', id, `${row.atolye} - ${row.is_tanimi}: ${STAGE_NAME[asama]}`);
  return c.json(ok({ id, asama }, `Aşama: ${STAGE_NAME[asama]}`));
});

/**
 * POST /api/atolye/:id/donus {tarih?, gelen_gram, gelen_milyem?, iscilik_tl?, iscilik_has?, notlar?}
 * İş atölyeden alınır: gelen has ve fire yazılır; bağlı sipariş "Hazır" olur.
 */
atolye.post('/:id/donus', async (c) => {
  const id = intId(c.req.param('id'), 'Atölye işi');
  const b = await body(c);
  const row = await first(c.env.DB, `SELECT * FROM atolye_isleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Atölye işi bulunamadı.');
  if (row.durum !== 'ATOLYEDE') throw new ValidationError('Bu iş zaten atölyeden alınmış.');
  const tarih = date(b.tarih, today(tz(c)));
  if (tarih < row.tarih) throw new ValidationError('Dönüş günü veriliş gününden önce olamaz.');
  const gram = amount(b.gelen_gram, 'Gelen gram');
  const milyem = b.gelen_milyem === undefined || b.gelen_milyem === null || b.gelen_milyem === '' ? d(row.verilen_milyem) : milyemOf(b.gelen_milyem, 'Gelen milyem');
  const gelenHas = hasOf(gram, milyem);
  const fire = d(row.verilen_has).sub(gelenHas).q(HAS_Q);
  const iscilikTl = b.iscilik_tl === undefined ? d(row.iscilik_tl) : amount(b.iscilik_tl, 'İşçilik');
  const notlar = text(b.notlar, 300);
  const stmts: Stmt[] = [
    {
      sql: `UPDATE atolye_isleri SET durum = 'DONDU', asama = 'HAZIR', donus_tarihi = ?, gelen_gram = ?, gelen_milyem = ?, gelen_has = ?, fire_has = ?, iscilik_tl = ?, iscilik_has = ? WHERE id = ?`,
      args: [tarih, gram.q(NUM_Q).toNumber(), milyem.q(NUM_Q).toNumber(), gelenHas.toNumber(), fire.toNumber(), iscilikTl.q(MONEY_Q).toNumber(), amount(b.iscilik_has, 'Has işçilik').q(HAS_Q).toNumber(), id],
    },
    { sql: `INSERT INTO atolye_asamalari (is_id, tarih, asama, notlar, kullanici) VALUES (?, ?, 'DONDU', ?, ?)`, args: [id, tarih, notlar, userName(c)] },
  ];
  if (row.siparis_id) stmts.push({ sql: `UPDATE siparisler SET durum = 'HAZIR' WHERE id = ? AND durum IN ('ALINDI', 'ATOLYEDE')`, args: [row.siparis_id] });
  await tx(c.env.DB, stmts);
  await log(c, 'update', id, `${row.atolye} - ${row.is_tanimi}: atölyeden alındı, fire ${fire.toString()} has`);
  return c.json(ok({ id, gelen_has: gelenHas.toNumber(), fire_has: fire.toNumber() }, 'İş atölyeden alındı.'));
});

/** POST /api/atolye/:id/geri-al: yanlışlıkla "alındı" yapılan iş yeniden atölyede olur. */
atolye.post('/:id/geri-al', async (c) => {
  const id = intId(c.req.param('id'), 'Atölye işi');
  const row = await first(c.env.DB, `SELECT * FROM atolye_isleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Atölye işi bulunamadı.');
  if (row.durum === 'ATOLYEDE') throw new ValidationError('İş zaten atölyede.');
  const stmts: Stmt[] = [
    { sql: `UPDATE atolye_isleri SET durum = 'ATOLYEDE', donus_tarihi = NULL, gelen_gram = 0, gelen_milyem = 0, gelen_has = 0, fire_has = 0, iscilik_has = 0 WHERE id = ?`, args: [id] },
    { sql: `DELETE FROM atolye_asamalari WHERE is_id = ? AND asama = 'DONDU'`, args: [id] },
  ];
  if (row.siparis_id) stmts.push({ sql: `UPDATE siparisler SET durum = 'ATOLYEDE' WHERE id = ? AND durum = 'HAZIR'`, args: [row.siparis_id] });
  await tx(c.env.DB, stmts);
  await log(c, 'update', id, `${row.atolye} - ${row.is_tanimi}: yeniden atölyede`);
  return c.json(ok({ id }, 'İş yeniden atölyede.'));
});

atolye.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Atölye işi');
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM atolye_isleri WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Atölye işi bulunamadı.');
  await log(c, 'delete', id, 'Atölye işi silindi');
  return c.json(ok({ id }, 'Atölye işi silindi.'));
});

export default atolye;
