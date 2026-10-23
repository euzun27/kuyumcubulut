/**
 * Altın fiyatı: has altın TL/gr alış-satış fiyatı.
 * Canlı fiyat sırası: masaüstü sürümde Harem Altın canlı akışı (lib/harem.ts), sonra
 * yönetici bir AltınAPI anahtarı girdiyse AltınAPI, sonra Truncgil Finans (30 saniye
 * önbellek); hiçbiri okunamazsa kullanıcının girdiği günün fiyatı kullanılır.
 * Fiyat yalnızca formları doldurmak için öneridir; kayıtlar girilen fiyatla saklanır.
 * Döviz kurları (USD, EUR, GBP) aynı kaynaktan okunur; kasa ve döviz
 * ekranlarında öneri olarak kullanılır. Gram gümüş (saf, TL/gr) de aynı
 * kaynaktan okunur; bakırın canlı TL kaynağı olmadığından kilo fiyatı elle girilir.
 */

import { Hono } from 'hono';
import type { Env } from '../lib/db';
import { first, run } from '../lib/db';
import { d } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { haremSnapshot } from '../lib/harem';

const fiyat = new Hono<Env>();

const ALTINAPI_URL = 'https://altinapi.com/api/v1/prices';
const SOURCES = ['https://finans.truncgil.com/v4/today.json', 'https://finans.truncgil.com/today.json'];
const KEYS = ['HAS', 'gram-has-altin', 'GRA', 'gram-altin'];
const CACHE_MS = 30 * 1000;

type Price = { alis: number; satis: number; kaynak: 'canli' | 'manuel'; ad: string; guncelleme: string; saglayici?: string };
type Rate = { alis: number; satis: number; kaynak: 'canli' | 'manuel' };
const RATE_KEYS = ['USD', 'EUR', 'GBP'] as const;
/** Gram gümüş için kaynakta görülen anahtarlar (sürüme göre değişir). */
const SILVER_KEYS = ['GUMUS', 'gumus', 'gram-gumus', 'GÜMÜŞ'];
export const METALS = ['GUMUS', 'BAKIR'] as const;

/** "2.345,67" veya 2345.67 -> 2345.67 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').replace(/[^\d.,-]/g, '');
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function parseLivePrice(json: Record<string, any>): Omit<Price, 'kaynak'> | null {
  for (const key of KEYS) {
    const item = json?.[key];
    if (!item || typeof item !== 'object') continue;
    const alis = toNumber(item.Buying ?? item['Alış'] ?? item.alis);
    const satis = toNumber(item.Selling ?? item['Satış'] ?? item.satis);
    if (alis > 0 && satis > 0) {
      return { alis, satis, ad: String(item.Name ?? key), guncelleme: String(json.Update_Date ?? '') };
    }
  }
  return null;
}

/** Döviz kurları: {USD: {alis, satis}, ...}; bulunamayanlar atlanır. */
export function parseLiveRates(json: Record<string, any>): Record<string, { alis: number; satis: number }> {
  const out: Record<string, { alis: number; satis: number }> = {};
  for (const key of RATE_KEYS) {
    const item = json?.[key];
    if (!item || typeof item !== 'object') continue;
    const alis = toNumber(item.Buying ?? item['Alış'] ?? item.alis);
    const satis = toNumber(item.Selling ?? item['Satış'] ?? item.satis);
    if (alis > 0 && satis > 0) out[key] = { alis, satis };
  }
  return out;
}

/** Gram gümüş (TL/gr) alış-satış; bulunamazsa null. */
export function parseLiveSilver(json: Record<string, any>): { alis: number; satis: number } | null {
  for (const key of SILVER_KEYS) {
    const item = json?.[key];
    if (!item || typeof item !== 'object') continue;
    const alis = toNumber(item.Buying ?? item['Alış'] ?? item.alis);
    const satis = toNumber(item.Selling ?? item['Satış'] ?? item.satis);
    if (alis > 0 && satis > 0) return { alis, satis };
  }
  return null;
}

/**
 * Fiyat panosu için piyasadaki ürün fiyatları (TL / gr veya TL / adet).
 * Kaynağın sürümüne göre anahtarlar değişir; bulunamayan ürün panoda has
 * fiyatından hesaplanır.
 */
export const PRODUCT_KEYS: Record<string, string[]> = {
  GRAM: ['gram-altin', 'GRA', 'GRAMALTIN'],
  B22: ['22-ayar-bilezik', 'BILEZIK22', '22AYARBILEZIK'],
  A18: ['18-ayar-altin', 'A18', '18AYARALTIN'],
  A14: ['14-ayar-altin', 'A14', '14AYARALTIN'],
  CEYREK: ['ceyrek-altin', 'CEYREKALTIN', 'CEY', 'CEYREK'],
  YARIM: ['yarim-altin', 'YARIMALTIN', 'YAR', 'YARIM'],
  TAM: ['tam-altin', 'TAMALTIN', 'TAM'],
  ATA: ['ata-altin', 'ATAALTIN', 'ATA', 'cumhuriyet-altini', 'CUMHURIYETALTINI'],
  GREMSE: ['gremse-altin', 'GREMSEALTIN', 'GRE', 'GREMSE'],
};

/** Panodaki ürünlerin canlı alış-satışı: {CEYREK: {alis, satis}, ...}; bulunamayanlar atlanır. */
export function parseLiveProducts(json: Record<string, any>): Record<string, { alis: number; satis: number }> {
  const out: Record<string, { alis: number; satis: number }> = {};
  for (const [code, keys] of Object.entries(PRODUCT_KEYS)) {
    for (const key of keys) {
      const item = json?.[key];
      if (!item || typeof item !== 'object') continue;
      const alis = toNumber(item.Buying ?? item['Alış'] ?? item.alis);
      const satis = toNumber(item.Selling ?? item['Satış'] ?? item.satis);
      if (alis > 0 && satis > 0) { out[code] = { alis, satis }; break; }
    }
  }
  return out;
}

type Live = { price: Price | null; kurlar: Record<string, Rate>; metaller: Record<string, Rate>; urunler?: Record<string, { alis: number; satis: number }> };

/**
 * Harem Altın piyasa kodları (AltınAPI aynı kodları kullanır). ALTIN has altının
 * TL/gr fiyatıdır; bulunamayan ürün panoda has fiyatından hesaplanır.
 */
const HAREM: { has: string; kurlar: Record<string, string>; gumus: string[]; urunler: Record<string, string[]> } = {
  has: 'ALTIN',
  kurlar: { USD: 'USDTRY', EUR: 'EURTRY', GBP: 'GBPTRY' },
  gumus: ['GUMTRY', 'GUMUSTRY'],
  urunler: {
    GRAM: ['KULCEALTIN'], B22: ['AYAR22'], A14: ['AYAR14'],
    CEYREK: ['CEYREK_YENI', 'CEYREK_ESKI'], YARIM: ['YARIM_YENI', 'YARIM_ESKI'], TAM: ['TEK_YENI', 'TEK_ESKI'],
    ATA: ['ATA_YENI', 'ATA_ESKI'], GREMSE: ['GREMESE_YENI', 'GREMESE_ESKI'],
  },
};

/** {KOD: {alis, satis}} biçimindeki piyasa verisini fiyat, kur, gümüş ve ürünlere ayırır. */
function fromCodes(data: Record<string, any>, saglayici: string, guncelleme: string): Live | null {
  const pair = (key: string) => {
    const item = data[key];
    if (!item || typeof item !== 'object') return null;
    const alis = toNumber(item.alis), satis = toNumber(item.satis);
    return alis > 0 && satis > 0 ? { alis, satis } : null;
  };
  const has = pair(HAREM.has);
  if (!has) return null;
  const live: Live = { price: { ...has, kaynak: 'canli', ad: 'Has Altın', guncelleme, saglayici }, kurlar: {}, metaller: {}, urunler: {} };
  for (const [k, key] of Object.entries(HAREM.kurlar)) { const p = pair(key); if (p) live.kurlar[k] = { ...p, kaynak: 'canli' }; }
  for (const key of HAREM.gumus) { const p = pair(key); if (p) { live.metaller.GUMUS = { ...p, kaynak: 'canli' }; break; } }
  for (const [code, keys] of Object.entries(HAREM.urunler)) {
    for (const key of keys) { const p = pair(key); if (p) { live.urunler![code] = p; break; } }
  }
  return live;
}

/** AltınAPI cevabı: {data: [{symbol, bid, ask, timestamp}], updatedAt}. bid alış, ask satıştır. */
export function parseAltinApi(json: Record<string, any>): Live | null {
  if (!Array.isArray(json?.data)) return null;
  const data = Object.fromEntries(json.data.filter((x: any) => x && typeof x.symbol === 'string').map((x: any) => [x.symbol.toUpperCase(), { alis: x.bid, satis: x.ask }]));
  const when = json.updatedAt ? new Date(json.updatedAt) : null;
  const guncelleme = when && !Number.isNaN(when.getTime()) ? when.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '';
  return fromCodes(data, 'AltınAPI', guncelleme);
}

async function altinApiData(key: string): Promise<Live | null> {
  try {
    const res = await fetch(ALTINAPI_URL, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json', 'x-api-key': key } });
    if (!res.ok) { console.error('AltınAPI fiyatı okunamadı', res.status); return null; }
    return parseAltinApi((await res.json()) as Record<string, any>);
  } catch (e) {
    console.error('AltınAPI fiyatı okunamadı', e);
    return null;
  }
}

async function truncgilData(): Promise<Live | null> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, any>;
      const parsed = parseLivePrice(json);
      if (!parsed) continue;
      const data: Live = { price: { ...parsed, kaynak: 'canli', saglayici: 'Truncgil Finans' }, kurlar: {}, metaller: {}, urunler: parseLiveProducts(json) };
      for (const [k, v] of Object.entries(parseLiveRates(json))) data.kurlar[k] = { ...v, kaynak: 'canli' };
      const silver = parseLiveSilver(json);
      if (silver) data.metaller.GUMUS = { ...silver, kaynak: 'canli' };
      return data;
    } catch (e) {
      console.error('canlı fiyat okunamadı', url, e);
    }
  }
  return null;
}

/** Harem akışından gelen son veriler (masaüstü); akış yoksa veya 2 dakikadır veri gelmediyse null. */
export function haremLive(): Live | null {
  const snap = haremSnapshot();
  return snap ? fromCodes(snap.data, 'Harem Altın', snap.tarih) : null;
}

async function liveData(key: string | null): Promise<Live> {
  const g = globalThis as { __kuyumcu_fiyat__?: { at: number; data: Live; key?: string | null } };
  const harem = haremLive();
  if (harem) {
    // Harem'de olmayan kalemler (ör. GBP) önbellekteki son Truncgil verisinden tamamlanır.
    const old = g.__kuyumcu_fiyat__?.data;
    return { ...harem, kurlar: { ...old?.kurlar, ...harem.kurlar }, metaller: { ...old?.metaller, ...harem.metaller }, urunler: { ...old?.urunler, ...harem.urunler } };
  }
  const cached = g.__kuyumcu_fiyat__;
  if (cached && Date.now() - cached.at < CACHE_MS && (cached.key === undefined || cached.key === key)) return cached.data;
  const paid = key ? await altinApiData(key) : null;
  const truncgil = paid && Object.keys(paid.kurlar).length ? null : await truncgilData();
  // Ücretli kaynakta bulunmayan kur, gümüş veya ürün varsa Truncgil'den tamamlanır.
  const data: Live = paid
    ? { ...paid, kurlar: { ...truncgil?.kurlar, ...paid.kurlar }, metaller: { ...truncgil?.metaller, ...paid.metaller }, urunler: { ...truncgil?.urunler, ...paid.urunler } }
    : truncgil ?? { price: null, kurlar: {}, metaller: {}, urunler: {} };
  g.__kuyumcu_fiyat__ = { at: Date.now(), data, key };
  return data;
}

async function apiKey(c: { env: Env['Bindings'] }): Promise<string | null> {
  const row = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'fiyat_api_anahtari'`);
  return row?.value || null;
}

async function manualRates(c: { env: Env['Bindings'] }): Promise<Record<string, Rate>> {
  const row = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'doviz_kurlari_manuel'`);
  if (!row) return {};
  try {
    const v = JSON.parse(row.value) as Record<string, { alis: number; satis: number }>;
    return Object.fromEntries(Object.entries(v).filter(([k]) => (RATE_KEYS as readonly string[]).includes(k)).map(([k, r]) => [k, { alis: r.alis, satis: r.satis, kaynak: 'manuel' as const }]));
  } catch {
    return {};
  }
}

/** Elle girilen gümüş (TL/gr) ve bakır (TL/kg) fiyatları. */
async function manualMetals(c: { env: Env['Bindings'] }): Promise<Record<string, Rate>> {
  const row = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'metal_fiyat_manuel'`);
  if (!row) return {};
  try {
    const v = JSON.parse(row.value) as Record<string, { alis: number; satis: number }>;
    return Object.fromEntries(Object.entries(v).filter(([k]) => (METALS as readonly string[]).includes(k)).map(([k, r]) => [k, { alis: r.alis, satis: r.satis, kaynak: 'manuel' as const }]));
  } catch {
    return {};
  }
}

async function manualPrice(c: { env: Env['Bindings'] }): Promise<Price | null> {
  const row = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'has_fiyati_manuel'`);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return { alis: v.alis, satis: v.satis, kaynak: 'manuel', ad: 'Elle girilen has fiyatı', guncelleme: v.tarih };
  } catch {
    return null;
  }
}

/** Günün fiyatları: canlı varsa canlı, yoksa elle girilen (metallerde elle girilen önce gelir). */
export async function currentPrices(c: { env: Env['Bindings'] }, liveToo = true) {
  const live: Live = liveToo ? await liveData(await apiKey(c)) : { price: null, kurlar: {}, metaller: {} };
  const manual = await manualPrice(c);
  const manualKur = await manualRates(c);
  const manualMetal = await manualMetals(c);
  const kurlar = Object.fromEntries(RATE_KEYS.filter((k) => live.kurlar[k] || manualKur[k]).map((k) => [k, live.kurlar[k] ?? manualKur[k]]));
  // Elle girilen metal fiyatı canlıdan önce gelir: kuyumcu gümüşü kendi fiyatıyla alıp satar.
  const metaller = Object.fromEntries(METALS.filter((k) => manualMetal[k] || live.metaller[k]).map((k) => [k, manualMetal[k] ?? live.metaller[k]]));
  return { fiyat: live.price ?? manual, canli: live.price, manuel: manual, kurlar, manuel_kurlar: manualKur, metaller, canli_metaller: live.metaller, manuel_metaller: manualMetal, urunler: live.urunler ?? {} };
}

/** GET /api/altin-fiyati: canlı fiyat, yoksa elle girilen fiyat. */
fiyat.get('/', async (c) => {
  const { urunler: _u, ...data } = await currentPrices(c, c.req.query('kaynak') !== 'manuel');
  return c.json({ status: 'ok', message: '', data });
});

/** GET /api/altin-fiyati/kaynak: canlı fiyatın kaynağı (yönetici); anahtarın kendisi gösterilmez. */
fiyat.get('/kaynak', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const key = await apiKey(c);
  const live = await liveData(key);
  return c.json({ status: 'ok', message: '', data: { anahtar_var: !!key, anahtar_son: key ? key.slice(-4) : null, saglayici: live.price?.saglayici ?? null } });
});

/** PUT /api/altin-fiyati/kaynak {anahtar}: AltınAPI anahtarını kaydeder; boş anahtar Truncgil'e döner. */
fiyat.put('/kaynak', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const key = typeof b.anahtar === 'string' ? b.anahtar.trim() : '';
  if (!key) {
    await run(c.env.DB, `DELETE FROM app_meta WHERE key = 'fiyat_api_anahtari'`);
    return c.json({ status: 'ok', message: 'Anahtar kaldırıldı; fiyat Truncgil Finans\'tan okunacak.', data: { anahtar_var: false } });
  }
  if (!/^[\w-]{8,200}$/.test(key)) throw new ValidationError('API anahtarı geçerli görünmüyor.');
  const live = await altinApiData(key);
  if (!live) throw new ValidationError('Bu anahtarla fiyat okunamadı. Anahtarı ve internet bağlantısını kontrol edin.');
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('fiyat_api_anahtari', ?)`, key);
  (globalThis as { __kuyumcu_fiyat__?: unknown }).__kuyumcu_fiyat__ = undefined;
  return c.json({ status: 'ok', message: `Anahtar kaydedildi. Has: ${live.price!.alis} / ${live.price!.satis}`, data: { anahtar_var: true } });
});

/** PUT /api/altin-fiyati: günün has fiyatını elle kaydeder (canlı kaynak yoksa kullanılır). */
fiyat.put('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parse = (v: unknown, label: string) => {
    let n;
    try {
      n = d(v);
    } catch {
      throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`);
    }
    if (!n.gt(0)) throw new ValidationError(`${label} 0'dan büyük olmalıdır.`);
    return n.q(2).toNumber();
  };
  const alis = parse(body.alis, 'Alış fiyatı');
  const satis = body.satis === undefined || body.satis === '' ? alis : parse(body.satis, 'Satış fiyatı');
  const tarih = today(c.env.APP_TZ || 'Europe/Istanbul');
  // Döviz kurları isteğe bağlıdır: {kurlar: {USD: {alis, satis}}}; boş bırakılan kur silinir.
  const kurlar: Record<string, { alis: number; satis: number }> = {};
  if (body.kurlar && typeof body.kurlar === 'object') {
    for (const key of RATE_KEYS) {
      const r = (body.kurlar as Record<string, any>)[key];
      if (!r || (r.alis === '' || r.alis === undefined || r.alis === null)) continue;
      const a = parse(r.alis, `${key} alış kuru`);
      kurlar[key] = { alis: a, satis: r.satis === undefined || r.satis === '' || r.satis === null ? a : parse(r.satis, `${key} satış kuru`) };
    }
    await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('doviz_kurlari_manuel', ?)`, JSON.stringify(kurlar));
  }
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('has_fiyati_manuel', ?)`, JSON.stringify({ alis, satis, tarih }));
  return c.json({ status: 'ok', message: 'Has fiyatı kaydedildi.', data: await manualPrice(c) });
});

/** DELETE /api/altin-fiyati: elle girilen has fiyatını ve kurları siler; canlı fiyata dönülür. */
fiyat.delete('/', async (c) => {
  await run(c.env.DB, `DELETE FROM app_meta WHERE key IN ('has_fiyati_manuel', 'doviz_kurlari_manuel')`);
  return c.json({ status: 'ok', message: 'Elle girilen fiyat silindi; canlı fiyat kullanılıyor.', data: null });
});

/**
 * PUT /api/altin-fiyati/metal {GUMUS: {alis, satis}, BAKIR: {alis, satis}}
 * Gümüş TL / saf gr, bakır TL / kg. Alış boş bırakılan metalin elle fiyatı silinir.
 */
fiyat.put('/metal', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const out: Record<string, { alis: number; satis: number }> = {};
  const parse = (v: unknown, label: string) => {
    let n;
    try {
      n = d(v);
    } catch {
      throw new ValidationError(`${label} geçerli bir sayı olmalıdır.`);
    }
    if (!n.gt(0)) throw new ValidationError(`${label} 0'dan büyük olmalıdır.`);
    return n.q(2).toNumber();
  };
  for (const key of METALS) {
    const r = body?.[key];
    if (!r || r.alis === '' || r.alis === undefined || r.alis === null) continue;
    const name = key === 'GUMUS' ? 'Gümüş' : 'Bakır';
    const alis = parse(r.alis, `${name} alış fiyatı`);
    out[key] = { alis, satis: r.satis === undefined || r.satis === '' || r.satis === null ? alis : parse(r.satis, `${name} satış fiyatı`) };
  }
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('metal_fiyat_manuel', ?)`, JSON.stringify(out));
  return c.json({ status: 'ok', message: 'Metal fiyatları kaydedildi.', data: await manualMetals(c) });
});

export default fiyat;
