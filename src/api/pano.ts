/**
 * Fiyat panosu (TV ekranı): dükkândaki ekranda müşteriye gösterilen alış-satış fiyatları.
 * Her satırın fiyatı üç yoldan gelir:
 *   piyasa: canlı kaynaktaki ürün fiyatı (bulunamazsa has fiyatından hesaplanır)
 *   hesap : has alış / satış fiyatı x satırın alış / satış çarpanı (ör. çeyrek 1,600 / 1,640 has)
 *   elle  : kuyumcunun yazdığı alış / satış fiyatı
 * Ayarlar app_meta 'pano' altında tutulur.
 */

import { Hono } from 'hono';
import type { Env } from '../lib/db';
import { first, run } from '../lib/db';
import { d } from '../lib/decimal';
import { HttpError, ValidationError } from '../lib/validate';
import { text } from '../lib/kasa';
import { currentPrices } from './fiyat';

const pano = new Hono<Env>();

type Source = 'piyasa' | 'hesap' | 'elle';
type Row = { kod: string; ad: string; birim: 'gr' | 'adet' | 'kur'; alis_carpan: number | null; satis_carpan: number | null };
type RowSetting = { kod: string; ad?: string; gorunur?: boolean; kaynak?: Source; alis_carpan?: number; satis_carpan?: number; elle_alis?: number | null; elle_satis?: number | null };

/** Varsayılan satırlar; çarpan, bir gram veya bir adetin kaç gram has ettiğidir (alış / satış). */
export const ROWS: Row[] = [
  { kod: 'HAS', ad: 'Has Altın', birim: 'gr', alis_carpan: 1, satis_carpan: 1 },
  { kod: 'GRAM', ad: 'Gram Altın', birim: 'gr', alis_carpan: 0.995, satis_carpan: 1.01 },
  { kod: 'B22', ad: '22 Ayar Bilezik', birim: 'gr', alis_carpan: 0.912, satis_carpan: 0.945 },
  { kod: 'A18', ad: '18 Ayar', birim: 'gr', alis_carpan: 0.7, satis_carpan: 0.76 },
  { kod: 'A14', ad: '14 Ayar', birim: 'gr', alis_carpan: 0.56, satis_carpan: 0.64 },
  { kod: 'CEYREK', ad: 'Çeyrek Altın', birim: 'adet', alis_carpan: 1.6, satis_carpan: 1.64 },
  { kod: 'YARIM', ad: 'Yarım Altın', birim: 'adet', alis_carpan: 3.2, satis_carpan: 3.28 },
  { kod: 'TAM', ad: 'Tam Altın', birim: 'adet', alis_carpan: 6.4, satis_carpan: 6.54 },
  { kod: 'ATA', ad: 'Ata Lira', birim: 'adet', alis_carpan: 6.6, satis_carpan: 6.72 },
  { kod: 'GREMSE', ad: 'Gremse', birim: 'adet', alis_carpan: 16, satis_carpan: 16.35 },
  { kod: 'GUMUS', ad: 'Gümüş', birim: 'gr', alis_carpan: null, satis_carpan: null },
  { kod: 'USD', ad: 'Dolar', birim: 'kur', alis_carpan: null, satis_carpan: null },
  { kod: 'EUR', ad: 'Euro', birim: 'kur', alis_carpan: null, satis_carpan: null },
];

async function loadSettings(db: Env['Bindings']['DB']): Promise<{ satirlar: RowSetting[]; alt_yazi: string }> {
  const row = await first<{ value: string }>(db, `SELECT value FROM app_meta WHERE key = 'pano'`);
  try {
    const v = row ? JSON.parse(row.value) : {};
    return { satirlar: Array.isArray(v.satirlar) ? v.satirlar : [], alt_yazi: typeof v.alt_yazi === 'string' ? v.alt_yazi : '' };
  } catch {
    return { satirlar: [], alt_yazi: '' };
  }
}

/** Varsayılan satırlarla kayıtlı ayarları birleştirir (kayıtlı sıra korunur, yeni satırlar sona eklenir). */
function mergeRows(saved: RowSetting[]) {
  const byCode = new Map(saved.filter((s) => ROWS.some((r) => r.kod === s.kod)).map((s) => [s.kod, s]));
  const order = [...byCode.keys(), ...ROWS.map((r) => r.kod).filter((k) => !byCode.has(k))];
  return order.map((kod) => {
    const base = ROWS.find((r) => r.kod === kod)!;
    const s = byCode.get(kod) ?? { kod };
    return {
      ...base,
      ad: s.ad || base.ad,
      gorunur: s.gorunur ?? true,
      kaynak: (['piyasa', 'hesap', 'elle'] as Source[]).includes(s.kaynak as Source) ? (s.kaynak as Source) : 'piyasa',
      alis_carpan: base.alis_carpan === null ? null : s.alis_carpan ?? base.alis_carpan,
      satis_carpan: base.satis_carpan === null ? null : s.satis_carpan ?? base.satis_carpan,
      varsayilan_alis_carpan: base.alis_carpan,
      varsayilan_satis_carpan: base.satis_carpan,
      elle_alis: s.elle_alis ?? null,
      elle_satis: s.elle_satis ?? null,
    };
  });
}

type Prices = Awaited<ReturnType<typeof currentPrices>>;
type Pair = { alis: number; satis: number } | null | undefined;

/** Bir satırın panoda görünen alış-satışı ve fiyatın nereden geldiği. */
export function priceRow(row: ReturnType<typeof mergeRows>[number], p: Prices) {
  const has = p.fiyat;
  const calc = (): Pair =>
    has && row.alis_carpan !== null && row.satis_carpan !== null
      ? { alis: d(has.alis).mul(row.alis_carpan).q(2).toNumber(), satis: d(has.satis).mul(row.satis_carpan).q(2).toNumber() }
      : null;
  const market = (): Pair => {
    if (row.kod === 'HAS') return has ? { alis: has.alis, satis: has.satis } : null;
    if (row.kod === 'GUMUS') return p.metaller.GUMUS;
    if (row.kod === 'USD' || row.kod === 'EUR') return p.kurlar[row.kod];
    return p.urunler[row.kod];
  };
  let value: Pair = null;
  let kaynak: Source | 'yok' = 'yok';
  if (row.kaynak === 'elle' && row.elle_alis && row.elle_satis) [value, kaynak] = [{ alis: row.elle_alis, satis: row.elle_satis }, 'elle'];
  if (!value && row.kaynak !== 'hesap') { const m = market(); if (m) [value, kaynak] = [m, 'piyasa']; }
  if (!value) { const c = calc(); if (c) [value, kaynak] = [c, 'hesap']; }
  if (!value && row.kaynak === 'hesap') { const m = market(); if (m) [value, kaynak] = [m, 'piyasa']; }
  return { kod: row.kod, ad: row.ad, birim: row.birim, alis: value?.alis ?? null, satis: value?.satis ?? null, fiyat_kaynagi: kaynak };
}

/**
 * GET /api/pano/urunler: satış/alış formları için ürün fiyatları ({CEYREK: {alis, satis}, ...}).
 * Panodaki ile aynı kaynak ve ayarlar kullanılır; böylece formdaki tutar TV'deki fiyatla aynı olur.
 */
pano.get('/urunler', async (c) => {
  const settings = await loadSettings(c.env.DB);
  const prices = await currentPrices(c);
  const out: Record<string, { alis: number; satis: number }> = {};
  for (const row of mergeRows(settings.satirlar)) {
    if (row.kod === 'HAS' || row.birim === 'kur' || row.kod === 'GUMUS') continue;
    const p = priceRow(row, prices);
    if (p.alis && p.satis) out[row.kod] = { alis: p.alis, satis: p.satis };
  }
  return c.json({ status: 'ok', message: '', data: out });
});

/** GET /api/pano: panoda görünen satırlar, firma adı ve alt yazı. ?hepsi=1 ayar ekranı için tüm satırları verir. */
pano.get('/', async (c) => {
  const settings = await loadSettings(c.env.DB);
  const rows = mergeRows(settings.satirlar);
  const prices = await currentPrices(c);
  const firmaRow = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'firma'`);
  const logo = await first<{ key: string }>(c.env.DB, `SELECT key FROM app_meta WHERE key = 'firma_logo'`);
  let firma: Record<string, string> = {};
  try { firma = firmaRow ? JSON.parse(firmaRow.value) : {}; } catch { /* varsayılan */ }
  const all = c.req.query('hepsi') === '1';
  const satirlar = rows.filter((r) => all || r.gorunur).map((r) => ({ ...(all ? r : {}), ...priceRow(r, prices) }));
  return c.json({
    status: 'ok', message: '',
    data: {
      firma: { ad: firma.ad || 'Dünyatek Kuyumcu', telefon: firma.telefon || '', adres: firma.adres || '', logo: !!logo },
      alt_yazi: settings.alt_yazi,
      satirlar,
      has: prices.fiyat,
      canli: !!prices.canli,
      saat: new Date().toISOString(),
    },
  });
});

/** PUT /api/pano {satirlar: [{kod, ad, gorunur, kaynak, alis_carpan, satis_carpan, elle_alis, elle_satis}], alt_yazi} */
pano.put('/', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, any>;
  if (!Array.isArray(b.satirlar)) throw new ValidationError('Pano satırları gönderilmedi.');
  const num = (v: unknown, label: string, max: number) => {
    if (v === undefined || v === null || v === '') return null;
    let n;
    try { n = d(v as string); } catch { throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`); }
    if (!n.gt(0) || n.gt(max)) throw new ValidationError(`${label} 0 ile ${max} arasında olmalıdır.`);
    return n.q(4).toNumber();
  };
  const satirlar: RowSetting[] = [];
  for (const s of b.satirlar as Record<string, any>[]) {
    const base = ROWS.find((r) => r.kod === s?.kod);
    if (!base || satirlar.some((x) => x.kod === base.kod)) continue;
    const kaynak = (['piyasa', 'hesap', 'elle'] as Source[]).includes(s.kaynak) ? (s.kaynak as Source) : 'piyasa';
    const row: RowSetting = { kod: base.kod, ad: text(s.ad, 40) || base.ad, gorunur: s.gorunur !== false, kaynak };
    if (base.alis_carpan !== null) {
      row.alis_carpan = num(s.alis_carpan, `${base.ad} alış çarpanı`, 100) ?? base.alis_carpan;
      row.satis_carpan = num(s.satis_carpan, `${base.ad} satış çarpanı`, 100) ?? base.satis_carpan!;
    }
    row.elle_alis = num(s.elle_alis, `${base.ad} alış fiyatı`, 100_000_000);
    row.elle_satis = num(s.elle_satis, `${base.ad} satış fiyatı`, 100_000_000);
    if (kaynak === 'elle' && (!row.elle_alis || !row.elle_satis)) throw new ValidationError(`${base.ad} için elle alış ve satış fiyatını yazın.`);
    satirlar.push(row);
  }
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('pano', ?)`, JSON.stringify({ satirlar, alt_yazi: text(b.alt_yazi, 200) }));
  return c.json({ status: 'ok', message: 'Pano ayarları kaydedildi.', data: null });
});

export default pano;
