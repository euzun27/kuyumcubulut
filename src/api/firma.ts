/**
 * Firma bilgileri: fiş ve makbuzların üst ve alt yazısı (app_meta 'firma').
 * İşyeri logosu ayrı tutulur (app_meta 'firma_logo', data URL); fiyat panosunda görünür.
 */

import { Hono } from 'hono';
import type { Env } from '../lib/db';
import { first, run } from '../lib/db';
import { HttpError } from '../lib/validate';
import { text } from '../lib/kasa';

const firma = new Hono<Env>();

const FIELDS: [string, number][] = [['ad', 120], ['adres', 300], ['telefon', 60], ['vergi', 120], ['fis_notu', 300]];
const DEFAULTS = { ad: 'Dünyatek Kuyumcu', adres: '', telefon: '', vergi: '', fis_notu: 'Bizi tercih ettiğiniz için teşekkür ederiz.' };

async function load(db: Env['Bindings']['DB']) {
  const row = await first<{ value: string }>(db, `SELECT value FROM app_meta WHERE key = 'firma'`);
  try {
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX = 600 * 1024;

async function loadLogo(db: Env['Bindings']['DB']) {
  const row = await first<{ value: string }>(db, `SELECT value FROM app_meta WHERE key = 'firma_logo'`);
  const m = row && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row.value);
  return m ? { type: m[1], base64: m[2] } : null;
}

firma.get('/', async (c) => c.json({ status: 'ok', message: '', data: { ...(await load(c.env.DB)), logo: !!(await loadLogo(c.env.DB)) } }));

/** GET /api/firma/logo: işyeri logosu (resim); yoksa 404. */
firma.get('/logo', async (c) => {
  const logo = await loadLogo(c.env.DB);
  if (!logo) return c.json({ status: 'error', message: 'Logo yüklenmemiş.', data: null }, 404);
  const bin = atob(logo.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': logo.type, 'cache-control': 'no-cache' } });
});

/** PUT /api/firma/logo {data: "data:image/png;base64,..."}; boş data logoyu kaldırır. */
firma.put('/logo', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const data = typeof b.data === 'string' ? b.data.trim() : '';
  if (!data) {
    await run(c.env.DB, `DELETE FROM app_meta WHERE key = 'firma_logo'`);
    return c.json({ status: 'ok', message: 'Logo kaldırıldı.', data: { logo: false } });
  }
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m || !LOGO_TYPES.includes(m[1])) throw new HttpError(422, 'Logo PNG, JPG veya WEBP resmi olmalıdır.');
  if (Math.floor((m[2].length * 3) / 4) > LOGO_MAX) throw new HttpError(422, 'Logo en fazla 600 KB olabilir.');
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('firma_logo', ?)`, data);
  return c.json({ status: 'ok', message: 'Logo kaydedildi.', data: { logo: true } });
});

firma.put('/', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const value = Object.fromEntries(FIELDS.map(([key, max]) => [key, text(b[key], max)]));
  if (!value.ad) value.ad = DEFAULTS.ad;
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('firma', ?)`, JSON.stringify(value));
  return c.json({ status: 'ok', message: 'Firma bilgileri kaydedildi.', data: { ...(await load(c.env.DB)), logo: !!(await loadLogo(c.env.DB)) } });
});

export default firma;
