/**
 * Stok sayımı: ürünler barkod okutularak (ya da elle) sayılır.
 *  - ACILIS: programa geçişte eldeki ürünler. Sayım bitince sayılan ve henüz
 *    alışa bağlı olmayan her parça için "AÇILIŞ STOĞU" alışı açılır (stoğa girer,
 *    cari ve kasa değişmez).
 *  - KONTROL: stoğa dokunmaz; sayılanı sistem stoğuyla karşılaştırır ve
 *    sayılmayan etiketleri listeler.
 * Bizim etiket (DT…) okutulursa o etiket sayılır. Bilinmeyen barkod (eski
 * programın etiketi) ya da barkodsuz ürün için etiket kaydı açılır; eski barkod
 * saklanır, satışta okutulunca da ürün bulunur.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, ZERO, NUM_Q, HAS_Q, MONEY_Q, type Dec } from '../lib/decimal';
import { HttpError, ValidationError, today, calcHas } from '../lib/validate';
import { normalizeText } from '../lib/text';
import { audit } from '../lib/auth';
import { date, intId, text } from '../lib/kasa';
import { Ledger } from '../lib/ledger';
import { loadSnapshot } from '../lib/store';
import { parseItem, findByCode, withCode, barcodeOf, stockStmt } from './etiket';

const sayim = new Hono<Env>();
const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';
const TURLER = ['ACILIS', 'KONTROL'] as const;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'sayimlar', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function price(value: unknown) {
  if (value === undefined || value === null || value === '') return 0;
  let n: Dec;
  try { n = d(value); } catch { throw new ValidationError('Maliyet has fiyatı geçerli bir sayı olmalıdır.'); }
  if (n.lt(0)) throw new ValidationError('Maliyet has fiyatı negatif olamaz.');
  return n.q(MONEY_Q).toNumber();
}

async function load(c: Context<Env>, id: number) {
  const row = await first(c.env.DB, `SELECT * FROM sayimlar WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Sayım bulunamadı.');
  return row;
}

async function loadOpen(c: Context<Env>, id: number) {
  const row = await load(c, id);
  if (row.durum !== 'ACIK') throw new HttpError(400, 'Bu sayım bitirilmiş; değiştirilemez.');
  return row;
}

/** Açılış sayımında stoğa girecek parçanın gram ve milyemi olmalı. */
function checkStockable(s: Record<string, any>, tag: Record<string, any>) {
  if (s.tur === 'ACILIS' && (!Number(tag.gram) || !Number(tag.milyem))) {
    throw new ValidationError(`${barcodeOf(Number(tag.id))}: gram ve milyem olmadan stoğa alınamaz; etiketi düzenleyin.`);
  }
}

const key = (cinsi: unknown, ayar: unknown) => `${normalizeText(String(cinsi ?? ''))}|${normalizeText(String(ayar ?? ''))}`;

/** Sayım ayrıntısı: kalemler, cinsi/ayar özeti ve (kontrol sayımında) sistem stoğuyla fark. */
async function detail(c: Context<Env>, id: number) {
  const s = await load(c, id);
  const rows = await all(c.env.DB,
    `SELECT k.id AS kalem_id, k.yeni_etiket, k.created_at AS okutma, e.* FROM sayim_kalemleri k JOIN etiketler e ON e.id = k.etiket_id WHERE k.sayim_id = ? ORDER BY k.id DESC`, id);
  const kalemler: Record<string, any>[] = rows.map((r) => ({ ...withCode(r), has: calcHas(r.gram, r.milyem).toNumber(), stokta: !!r.alis_id }));
  const groups = new Map<string, { cinsi: string; ayar: string; adet: number; gram: Dec; has: Dec }>();
  for (const r of kalemler) {
    const k = key(r.cinsi, r.ayar);
    const g = groups.get(k) ?? { cinsi: r.cinsi, ayar: r.ayar, adet: 0, gram: ZERO, has: ZERO };
    g.adet += 1; g.gram = g.gram.add(d(r.gram)); g.has = g.has.add(d(r.has));
    groups.set(k, g);
  }
  const ozet = [...groups.values()].map((g) => ({ cinsi: g.cinsi, ayar: g.ayar, adet: g.adet, gram: g.gram.q(NUM_Q).toNumber(), has: g.has.q(HAS_Q).toNumber() }))
    .sort((a, b) => `${a.cinsi} ${a.ayar}`.localeCompare(`${b.cinsi} ${b.ayar}`, 'tr'));
  const toplam = {
    adet: kalemler.length,
    gram: kalemler.reduce((t, r) => t.add(d(r.gram)), ZERO).q(NUM_Q).toNumber(),
    has: kalemler.reduce((t, r) => t.add(d(r.has)), ZERO).q(HAS_Q).toNumber(),
    stoga_girecek: kalemler.filter((r) => !r.stokta && r.durum === 'STOKTA').length,
  };
  let karsilastirma = null;
  let sayilmayan = null;
  if (s.tur === 'KONTROL') {
    const stock = new Ledger(await loadSnapshot(c.env.DB), tz(c)).stockItems();
    const keys = new Map<string, { cinsi: string; ayar: string }>();
    for (const r of stock) keys.set(key(r.cinsi, r.ayar), { cinsi: r.cinsi, ayar: r.ayar });
    for (const g of ozet) if (!keys.has(key(g.cinsi, g.ayar))) keys.set(key(g.cinsi, g.ayar), { cinsi: g.cinsi, ayar: g.ayar });
    karsilastirma = [...keys.entries()].map(([k, v]) => {
      const sys = stock.find((r) => key(r.cinsi, r.ayar) === k);
      const cnt = groups.get(k);
      const sGram = d(sys?.kalan_gram ?? 0); const sHas = d(sys?.kalan_has ?? 0);
      const cGram = cnt?.gram ?? ZERO; const cHas = cnt?.has ?? ZERO;
      return {
        ...v, sistem_gram: sGram.q(NUM_Q).toNumber(), sistem_has: sHas.q(HAS_Q).toNumber(), sayilan_adet: cnt?.adet ?? 0,
        sayilan_gram: cGram.q(NUM_Q).toNumber(), sayilan_has: cHas.q(HAS_Q).toNumber(),
        fark_gram: cGram.sub(sGram).q(NUM_Q).toNumber(), fark_has: cHas.sub(sHas).q(HAS_Q).toNumber(),
      };
    }).sort((a, b) => `${a.cinsi} ${a.ayar}`.localeCompare(`${b.cinsi} ${b.ayar}`, 'tr'));
    sayilmayan = (await all(c.env.DB,
      `SELECT * FROM etiketler WHERE durum = 'STOKTA' AND id NOT IN (SELECT etiket_id FROM sayim_kalemleri WHERE sayim_id = ?) ORDER BY id`, id)).map(withCode);
  }
  return { ...s, kalemler, ozet, toplam, karsilastirma, sayilmayan };
}

/** GET /api/sayim: sayımlar (en yenisi önce). */
sayim.get('/', async (c) => {
  const rows = await all(c.env.DB,
    `SELECT s.*, COUNT(k.id) AS adet, COALESCE(SUM(e.gram), 0) AS gram FROM sayimlar s LEFT JOIN sayim_kalemleri k ON k.sayim_id = s.id LEFT JOIN etiketler e ON e.id = k.etiket_id GROUP BY s.id ORDER BY s.id DESC`);
  return c.json(ok(rows));
});

/** POST /api/sayim {tur, tarih?, has_fiyati?, notlar?}: yeni sayım. */
sayim.post('/', async (c) => {
  const b = await body(c);
  const tur = String(b.tur ?? 'ACILIS').toUpperCase();
  if (!(TURLER as readonly string[]).includes(tur)) throw new ValidationError('Sayım türü geçersiz.');
  const row = { tarih: date(b.tarih, today(tz(c))), tur, has_fiyati: price(b.has_fiyati), notlar: text(b.notlar, 300), kullanici: c.get('user')?.name ?? '' };
  const cols = Object.keys(row);
  const [res] = await tx(c.env.DB, [{ sql: `INSERT INTO sayimlar (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`, args: Object.values(row) }]);
  const id = Number((res.results as any[])[0].id);
  await log(c, 'create', id, `${tur === 'ACILIS' ? 'Açılış' : 'Kontrol'} sayımı başlatıldı`);
  return c.json(ok(await detail(c, id), 'Sayım başlatıldı.'), 201);
});

sayim.get('/:id', async (c) => c.json(ok(await detail(c, intId(c.req.param('id'), 'Sayım')))));

/** PUT /api/sayim/:id {tarih?, has_fiyati?, notlar?}: açık sayımın bilgileri. */
sayim.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  const s = await loadOpen(c, id);
  const b = await body(c);
  await tx(c.env.DB, [{
    sql: `UPDATE sayimlar SET tarih = ?, has_fiyati = ?, notlar = ? WHERE id = ?`,
    args: [date(b.tarih, s.tarih), b.has_fiyati === undefined ? s.has_fiyati : price(b.has_fiyati), b.notlar === undefined ? s.notlar : text(b.notlar, 300), id],
  }]);
  return c.json(ok(await detail(c, id), 'Sayım güncellendi.'));
});

/**
 * POST /api/sayim/:id/okut {kod}: barkod okutma. Etiket bulunursa sayıma eklenir.
 * Bulunamazsa `yeni: true` döner; arayüz ürün bilgisini sorup /kalem çağırır.
 */
sayim.post('/:id/okut', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  const s = await loadOpen(c, id);
  const kod = text((await body(c)).kod, 80);
  if (!kod) throw new ValidationError('Barkod okutun.');
  const tag = await findByCode(c.env.DB, kod);
  if (!tag) return c.json(ok({ yeni: true, kod }, `${kod} barkodu kayıtlı değil. Ürün bilgisini girin.`));
  if (tag.durum === 'SATILDI') throw new HttpError(409, `${barcodeOf(Number(tag.id))} etiketli ürün satılmış görünüyor.`);
  const dup = await first(c.env.DB, `SELECT id FROM sayim_kalemleri WHERE sayim_id = ? AND etiket_id = ?`, id, tag.id);
  if (dup) throw new HttpError(409, `${barcodeOf(Number(tag.id))} bu sayımda zaten okutuldu.`);
  checkStockable(s, tag);
  await tx(c.env.DB, [{ sql: `INSERT INTO sayim_kalemleri (sayim_id, etiket_id) VALUES (?, ?)`, args: [id, tag.id] }]);
  const note = s.tur === 'ACILIS' && tag.alis_id ? ' (zaten stokta, tekrar stoğa girmez)' : '';
  return c.json(ok({ etiket: withCode(tag), sayim: await detail(c, id) }, `${barcodeOf(Number(tag.id))} ${tag.cinsi} ${tag.ayar} sayıldı${note}.`));
});

/**
 * POST /api/sayim/:id/kalem {eski_barkod?, cinsi, ayar, gram, milyem, ...}: kayıtlı
 * olmayan ürün (eski programın etiketi ya da barkodsuz). Etiket kaydı açılır.
 */
sayim.post('/:id/kalem', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  const s = await loadOpen(c, id);
  const b = await body(c);
  const eski = text(b.eski_barkod, 80) || null;
  if (eski && (await findByCode(c.env.DB, eski))) throw new HttpError(409, `${eski} barkodu zaten kayıtlı; okutarak ekleyin.`);
  const v = { ...parseItem(c, b), alis_id: null, tarih: s.tarih };
  if (s.tur === 'ACILIS' && (!Number(v.gram) || !Number(v.milyem))) throw new ValidationError('Stoğa almak için gram ve milyem girin.');
  const row = { ...v, eski_barkod: eski };
  const cols = Object.keys(row);
  const res = await tx(c.env.DB, [
    { sql: `INSERT INTO etiketler (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(row) },
    { sql: `INSERT INTO sayim_kalemleri (sayim_id, etiket_id, yeni_etiket) VALUES (?, (SELECT MAX(id) FROM etiketler), 1)`, args: [id] },
  ]);
  const tag = withCode((res[0].results as any[])[0]);
  return c.json(ok({ etiket: tag, sayim: await detail(c, id) }, `${tag.barkod} ${tag.cinsi} ${tag.ayar} sayıma eklendi.`), 201);
});

/** DELETE /api/sayim/:id/kalem/:kalem: okutmayı geri al (bu sayımda açılan etiket de silinir). */
sayim.delete('/:id/kalem/:kalem', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  await loadOpen(c, id);
  const k = await first(c.env.DB, `SELECT * FROM sayim_kalemleri WHERE id = ? AND sayim_id = ?`, intId(c.req.param('kalem'), 'Kalem'), id);
  if (!k) throw new HttpError(404, 'Kalem bulunamadı.');
  const stmts: Stmt[] = [{ sql: `DELETE FROM sayim_kalemleri WHERE id = ?`, args: [k.id] }];
  if (Number(k.yeni_etiket)) stmts.push({ sql: `DELETE FROM etiketler WHERE id = ? AND durum = 'STOKTA' AND alis_id IS NULL`, args: [k.etiket_id] });
  await tx(c.env.DB, stmts);
  return c.json(ok(await detail(c, id), 'Okutma geri alındı.'));
});

/**
 * POST /api/sayim/:id/bitir: sayımı kapatır. Açılış sayımında alışa bağlı olmayan
 * her parça için açılış stoğu alışı açılır ve etiket o alışa bağlanır.
 */
sayim.post('/:id/bitir', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  const s = await loadOpen(c, id);
  const tags = await all(c.env.DB,
    `SELECT e.* FROM sayim_kalemleri k JOIN etiketler e ON e.id = k.etiket_id WHERE k.sayim_id = ? AND e.durum = 'STOKTA' AND e.alis_id IS NULL ORDER BY k.id`, id);
  const stmts: Stmt[] = [];
  if (s.tur === 'ACILIS' && tags.length) {
    if (!Number(s.has_fiyati)) throw new ValidationError('Stoğa almak için maliyet has fiyatını girin.');
    for (const t of tags) {
      checkStockable(s, t);
      stmts.push(stockStmt(t, Number(s.has_fiyati), s.tarih, `Sayım #${id} · ${t.eski_barkod ? `eski barkod ${t.eski_barkod}` : barcodeOf(Number(t.id))}`));
      stmts.push({ sql: `UPDATE etiketler SET alis_id = (SELECT MAX(id) FROM alis) WHERE id = ?`, args: [t.id] });
    }
  }
  stmts.push({ sql: `UPDATE sayimlar SET durum = 'KAPALI', kapanis = datetime('now') WHERE id = ?`, args: [id] });
  await tx(c.env.DB, stmts);
  const adet = s.tur === 'ACILIS' ? tags.length : 0;
  await log(c, 'update', id, `Sayım bitirildi${adet ? `; ${adet} parça stoğa alındı` : ''}`);
  return c.json(ok({ ...(await detail(c, id)), stoga_alinan: adet }, adet ? `Sayım bitti; ${adet} parça stoğa alındı.` : 'Sayım bitti.'));
});

/** DELETE /api/sayim/:id: açık sayımı iptal eder; bu sayımda açılan etiketler de silinir. */
sayim.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Sayım');
  await loadOpen(c, id);
  await tx(c.env.DB, [
    { sql: `DELETE FROM etiketler WHERE durum = 'STOKTA' AND alis_id IS NULL AND id IN (SELECT etiket_id FROM sayim_kalemleri WHERE sayim_id = ? AND yeni_etiket = 1)`, args: [id] },
    { sql: `DELETE FROM sayim_kalemleri WHERE sayim_id = ?`, args: [id] },
    { sql: `DELETE FROM sayimlar WHERE id = ?`, args: [id] },
  ]);
  await log(c, 'delete', id, 'Sayım iptal edildi');
  return c.json(ok({ id }, 'Sayım iptal edildi.'));
});

export default sayim;
