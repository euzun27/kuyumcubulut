/**
 * Gümüş ve bakır alım-satımı. Altının has esaslı stok ve cari hesabına
 * karışmaz; her metal kendi saf gramıyla (gram x milyem / 1000) izlenir.
 *
 *   Gümüş: tutar = saf gram x saf gram fiyatı (TL/gr) + işçilik
 *   Bakır: tutar = saf gram / 1000 x kilo fiyatı (TL/kg) + işçilik
 *
 * Ödenen veya alınan para kasaya bağlı hareket olarak yazılır
 * (bagli_tur = 'metal'); kalan tutar kayıtta "kalan" olarak görünür.
 * Kâr, satılan saf gram ile o metalin ortalama alış maliyeti üzerinden hesaplanır.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, Dec, NUM_Q, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { audit } from '../lib/auth';
import { checkItems, date, guardNegativeTl, intId, linkedByRecord, linkedStmts, loadAccounts, money, parseKasaItems, text } from '../lib/kasa';
import { personName } from '../lib/text';

const metal = new Hono<Env>();

export const METAL_TYPES = ['GUMUS', 'BAKIR'] as const;
export const METAL_NAME: Record<string, string> = { GUMUS: 'Gümüş', BAKIR: 'Bakır' };
/** Fiyat birimi: gümüş saf gram, bakır kilo. */
export const PRICE_UNIT: Record<string, 'GR' | 'KG'> = { GUMUS: 'GR', BAKIR: 'KG' };

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'metal_islemleri', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
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

/** Milyem boşsa ayardan çıkarılır: "925" -> 925, "999" -> 999; bulunamazsa 1000 (saf). */
export function defaultMilyem(ayar: string): number {
  const m = /^(\d{3,4})$/.exec(ayar.trim());
  const n = m ? Number(m[1]) : NaN;
  return n >= 100 && n <= 1000 ? n : 1000;
}

/** Saf gram ve TL tutar. */
export function metalTotals(metalType: string, gram: Dec, milyem: Dec, fiyat: Dec, iscilik: Dec) {
  const saf = gram.mul(milyem).div(1000).q(NUM_Q);
  const base = PRICE_UNIT[metalType] === 'KG' ? saf.div(1000).mul(fiyat) : saf.mul(fiyat);
  return { saf, tutar: base.add(iscilik).q(MONEY_Q) };
}

function parse(c: Context<Env>, b: Record<string, unknown>) {
  const islem = String(b.islem_turu ?? '').trim().toUpperCase();
  if (islem !== 'ALIS' && islem !== 'SATIS') throw new ValidationError('İşlem türü ALIŞ veya SATIŞ olmalı.');
  const m = String(b.metal ?? '').trim().toUpperCase();
  if (!(METAL_TYPES as readonly string[]).includes(m)) throw new ValidationError('Metal gümüş veya bakır olmalı.');
  const kisi = personName(text(b.kisi, 120));
  if (!kisi) throw new ValidationError('Kişi / firma zorunlu.');
  const ayar = text(b.ayar, 20);
  const gram = amount(b.gram, 'Gram');
  if (!gram.gt(0)) throw new ValidationError('Gram 0\'dan büyük olmalıdır.');
  const milyem = b.milyem === undefined || b.milyem === null || b.milyem === '' ? d(defaultMilyem(ayar)) : amount(b.milyem, 'Milyem');
  if (!milyem.gt(0) || milyem.gt(1000)) throw new ValidationError('Milyem 1 ile 1000 arasında olmalıdır.');
  const fiyat = amount(b.birim_fiyat, 'Fiyat');
  const iscilik = amount(b.iscilik, 'İşçilik');
  const { saf, tutar } = metalTotals(m, gram, milyem, fiyat, iscilik);
  return {
    tarih: date(b.tarih, today(tz(c))),
    islem_turu: islem,
    metal: m,
    kisi,
    cinsi: text(b.cinsi, 80),
    ayar,
    adet: amount(b.adet, 'Adet').q(NUM_Q).toNumber(),
    gram: gram.q(NUM_Q).toNumber(),
    milyem: milyem.q(NUM_Q).toNumber(),
    saf_gram: saf.toNumber(),
    birim_fiyat: fiyat.q(MONEY_Q).toNumber(),
    iscilik: iscilik.q(MONEY_Q).toNumber(),
    tutar: tutar.toNumber(),
    notlar: text(b.notlar, 500),
  };
}

type Row = Record<string, any>;

/** Metal bazında stok: alınan / satılan saf gram, kalan, ortalama maliyet. */
export function metalStock(rows: Row[], excludeId: number | null = null) {
  const out = new Map<string, { alis_saf: Dec; satis_saf: Dec; alis_tutar: Dec; alis_gram: Dec; satis_gram: Dec }>();
  for (const m of METAL_TYPES) out.set(m, { alis_saf: d(0), satis_saf: d(0), alis_tutar: d(0), alis_gram: d(0), satis_gram: d(0) });
  for (const r of rows) {
    if (excludeId !== null && Number(r.id) === excludeId) continue;
    const s = out.get(r.metal);
    if (!s) continue;
    if (r.islem_turu === 'ALIS') {
      s.alis_saf = s.alis_saf.add(d(r.saf_gram)); s.alis_tutar = s.alis_tutar.add(d(r.tutar)); s.alis_gram = s.alis_gram.add(d(r.gram));
    } else {
      s.satis_saf = s.satis_saf.add(d(r.saf_gram)); s.satis_gram = s.satis_gram.add(d(r.gram));
    }
  }
  return out;
}

const avgCost = (s: { alis_saf: Dec; alis_tutar: Dec }) => (s.alis_saf.gt(0) ? s.alis_tutar.div(s.alis_saf) : d(0));

function tlOf(items: Record<string, unknown>[]) {
  return items.reduce((t: Dec, k) => t.add(d(k.tutar as number).mul(d((k.kur as number) || 1))), d(0));
}

async function listData(c: Context<Env>) {
  const [rows, kasa] = await Promise.all([
    all(c.env.DB, `SELECT * FROM metal_islemleri ORDER BY tarih DESC, id DESC`),
    linkedByRecord(c.env.DB, 'metal'),
  ]);
  const stock = metalStock(rows);
  const kayitlar = rows.map((r) => {
    const odemeler = kasa.get(Number(r.id)) ?? [];
    const odenen = tlOf(odemeler);
    const kalan = d(r.tutar).sub(odenen);
    const s = stock.get(r.metal)!;
    const kar = r.islem_turu === 'SATIS' ? d(r.tutar).sub(d(r.saf_gram).mul(avgCost(s))) : null;
    return { ...r, kasa_odemeleri: odemeler, odenen_tl: money(odenen), kalan_tl: money(kalan.gt(0) ? kalan : d(0)), kar_tl: kar === null ? null : money(kar), fiyat_birimi: PRICE_UNIT[r.metal] };
  });
  const stok = METAL_TYPES.map((m) => {
    const s = stock.get(m)!;
    const kalan = s.alis_saf.sub(s.satis_saf);
    const ort = avgCost(s);
    // Ayar kırılımı: alınan - satılan gram (aynı ayar yazımıyla).
    const ayarlar = new Map<string, Dec>();
    for (const r of rows.filter((x) => x.metal === m)) {
      const key = String(r.ayar || '-');
      ayarlar.set(key, (ayarlar.get(key) ?? d(0))[r.islem_turu === 'ALIS' ? 'add' : 'sub'](d(r.gram)));
    }
    return {
      metal: m,
      ad: METAL_NAME[m],
      alis_saf: s.alis_saf.q(NUM_Q).toNumber(),
      satis_saf: s.satis_saf.q(NUM_Q).toNumber(),
      kalan_saf: kalan.q(NUM_Q).toNumber(),
      ortalama_maliyet: money(PRICE_UNIT[m] === 'KG' ? ort.mul(1000) : ort),
      stok_degeri: money(kalan.gt(0) ? kalan.mul(ort) : d(0)),
      fiyat_birimi: PRICE_UNIT[m],
      ayarlar: [...ayarlar].filter(([, g]) => !g.isZero()).map(([ayar, g]) => ({ ayar, gram: g.q(NUM_Q).toNumber() })),
    };
  });
  const sum = (pred: (r: Row) => boolean, key: string) => money(kayitlar.filter(pred).reduce((t, r) => t.add(d(r[key] ?? 0)), d(0)));
  const ozet = {
    toplam_alis_tl: sum((r) => r.islem_turu === 'ALIS', 'tutar'),
    toplam_satis_tl: sum((r) => r.islem_turu === 'SATIS', 'tutar'),
    toplam_kar_tl: sum((r) => r.islem_turu === 'SATIS', 'kar_tl'),
    odenecek_tl: sum((r) => r.islem_turu === 'ALIS', 'kalan_tl'),
    tahsil_edilecek_tl: sum((r) => r.islem_turu === 'SATIS', 'kalan_tl'),
  };
  return { kayitlar, stok, ozet };
}

async function ensureStock(c: Context<Env>, v: ReturnType<typeof parse>, excludeId: number | null) {
  if (v.islem_turu !== 'SATIS') return;
  const rows = await all(c.env.DB, `SELECT id, metal, islem_turu, saf_gram, gram, tutar FROM metal_islemleri WHERE metal = ?`, v.metal);
  const s = metalStock(rows, excludeId).get(v.metal)!;
  const kalan = s.alis_saf.sub(s.satis_saf);
  if (d(v.saf_gram).gt(kalan)) {
    throw new ValidationError(`Stokta yeterli ${METAL_NAME[v.metal].toLocaleLowerCase('tr-TR')} yok (kalan ${kalan.q(NUM_Q).toString()} gr saf). Elinizdeki stoğu önce alış (açılış) kaydı olarak girin.`);
  }
}

async function kasaStmts(c: Context<Env>, b: Record<string, unknown>, id: number | null, v: ReturnType<typeof parse>): Promise<Stmt[] | null> {
  const items = parseKasaItems(b.kasa);
  if (items === null) return null;
  const accounts = await loadAccounts(c.env.DB);
  checkItems(items, accounts);
  const alis = v.islem_turu === 'ALIS';
  if (alis) await guardNegativeTl(c.env.DB, b, accounts, items, id === null ? null : { tur: 'metal', id });
  return linkedStmts('metal', id, items, accounts, {
    tarih: v.tarih, cari: v.kisi, yon: alis ? 'CIKIS' : 'GIRIS', kategori: alis ? 'METAL_ALIS' : 'METAL_SATIS',
    aciklama: `${METAL_NAME[v.metal]} ${v.ayar} ${v.gram} gr`.replace(/\s+/g, ' '), kullanici: c.get('user')?.name ?? null,
  });
}

const describe = (v: ReturnType<typeof parse>) => `${METAL_NAME[v.metal]} ${v.islem_turu === 'ALIS' ? 'alış' : 'satış'}: ${v.kisi} ${v.gram} gr ${v.ayar}`.trim();

metal.get('/', async (c) => c.json(ok(await listData(c))));

metal.post('/', async (c) => {
  const b = await body(c);
  const v = parse(c, b);
  await ensureStock(c, v, null);
  const cols = Object.keys(v);
  const kasa = (await kasaStmts(c, b, null, v)) ?? [];
  const [res] = await tx(c.env.DB, [
    { sql: `INSERT INTO metal_islemleri (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(v) },
    ...kasa,
  ]);
  const row = (res.results as any[])[0];
  await log(c, 'create', row.id, describe(v));
  return c.json(ok(row, `${METAL_NAME[v.metal]} ${v.islem_turu === 'ALIS' ? 'alışı' : 'satışı'} kaydedildi.`), 201);
});

metal.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Kayıt');
  const b = await body(c);
  const v = parse(c, b);
  const existing = await first(c.env.DB, `SELECT * FROM metal_islemleri WHERE id = ?`, id);
  if (!existing) throw new HttpError(404, 'Kayıt bulunamadı.');
  await ensureStock(c, v, id);
  if (existing.islem_turu === 'ALIS' && (v.islem_turu !== 'ALIS' || v.metal !== existing.metal || d(v.saf_gram).lt(d(existing.saf_gram)))) {
    // Alış azaltılınca satılmış miktarın altına düşülmesin.
    const rows = await all(c.env.DB, `SELECT id, metal, islem_turu, saf_gram, gram, tutar FROM metal_islemleri WHERE metal = ?`, existing.metal);
    const s = metalStock(rows, id).get(existing.metal)!;
    const added = v.islem_turu === 'ALIS' && v.metal === existing.metal ? d(v.saf_gram) : d(0);
    if (s.alis_saf.add(added).lt(s.satis_saf)) throw new ValidationError('Bu alıştan satış yapılmış; alış miktarı satılan miktarın altına düşürülemez.');
  }
  const cols = Object.keys(v);
  const kasa = (await kasaStmts(c, b, id, v)) ?? [
    { sql: `UPDATE kasa_hareketleri SET tarih = ?, cari = ? WHERE bagli_tur = 'metal' AND bagli_id = ?`, args: [v.tarih, v.kisi, id] },
  ];
  const [res] = await tx(c.env.DB, [
    { sql: `UPDATE metal_islemleri SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`, args: [...Object.values(v), id] },
    ...kasa,
  ]);
  await log(c, 'update', id, describe(v));
  return c.json(ok((res.results as any[])[0], 'Kayıt güncellendi.'));
});

metal.delete('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Kayıt');
  const row = await first(c.env.DB, `SELECT * FROM metal_islemleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı.');
  if (row.islem_turu === 'ALIS') {
    const rows = await all(c.env.DB, `SELECT id, metal, islem_turu, saf_gram, gram, tutar FROM metal_islemleri WHERE metal = ?`, row.metal);
    const s = metalStock(rows, id).get(row.metal)!;
    if (s.alis_saf.lt(s.satis_saf)) throw new HttpError(400, 'Bu alış silinirse satılan miktar stoğu aşar. Önce ilgili satışı silin.');
  }
  await tx(c.env.DB, [{ sql: `DELETE FROM metal_islemleri WHERE id = ?`, args: [id] }]);
  await log(c, 'delete', id, `${METAL_NAME[row.metal]} kaydı silindi`);
  return c.json(ok({ id }, 'Kayıt silindi.'));
});

export default metal;
