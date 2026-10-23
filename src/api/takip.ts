/**
 * Cari kartları (müşteri, toptancı, atölye; telefon, vade, has limiti) ve
 * uyarılar: vadesi geçen cari bakiyeler, limit aşımı, teslim günü gelen
 * siparişler. Bakiyeler her zaman Ledger'ın has esaslı cari hesabından gelir.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, run } from '../lib/db';
import { d, HAS_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { normalizeText, personName } from '../lib/text';
import { Ledger } from '../lib/ledger';
import { loadSnapshot } from '../lib/store';
import { audit } from '../lib/auth';
import { text } from '../lib/kasa';
import { loadOrders, OPEN_STATES } from './siparis';
import { loadJobs } from './atolye';

export const CARD_TYPES = ['MUSTERI', 'TOPTANCI', 'ATOLYE', 'DIGER'] as const;
const DEFAULT_VADE = 30;

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

type Card = { id: number; anahtar: string; isim: string; tur: string; kisi_tipi: string; telefon: string; adres: string; vade_gun: number | null; limit_has: number; notlar: string };

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'cari_kartlari', entityId: null, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function wholeDays(value: unknown, label: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) throw new ValidationError(`${label} 0 ile ${max} arasında tam sayı olmalıdır.`);
  return n;
}

function hasLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  let n;
  try {
    n = d(value);
  } catch {
    throw new ValidationError('Has limiti geçerli bir sayı olmalıdır.');
  }
  if (n.lt(0)) throw new ValidationError('Has limiti negatif olamaz.');
  return n.q(HAS_Q).toNumber();
}

async function defaultVade(c: Context<Env>): Promise<number> {
  const row = await first<{ value: string }>(c.env.DB, `SELECT value FROM app_meta WHERE key = 'vade_varsayilan'`);
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_VADE;
}

const loadCards = (c: Context<Env>) => all<Card>(c.env.DB, `SELECT * FROM cari_kartlari ORDER BY isim`);

export const cariKart = new Hono<Env>();

cariKart.get('/', async (c) => c.json(ok({ kartlar: await loadCards(c), vade_gun_varsayilan: await defaultVade(c) })));

const CARD_TEXT: [string, number][] = [['telefon', 30], ['telefon2', 30], ['eposta', 120], ['adres', 300], ['il', 60], ['vergi_dairesi', 80], ['yetkili', 120], ['notlar', 500]];

/**
 * PUT /api/cari-kart {isim, tur, kisi_tipi, telefon, telefon2, eposta, adres, il,
 * vergi_dairesi, vergi_no, yetkili, vade_gun, limit_has, notlar}: isimle eşleşen kartı yazar.
 */
cariKart.put('/', async (c) => {
  const b = await body(c);
  const isim = personName(text(b.isim, 120));
  if (!isim) throw new ValidationError('Cari adı zorunlu.');
  const tur = String(b.tur ?? 'MUSTERI').toUpperCase();
  if (!(CARD_TYPES as readonly string[]).includes(tur)) throw new ValidationError('Geçersiz cari türü.');
  const kisiTipi = String(b.kisi_tipi ?? 'SAHIS').toUpperCase();
  if (kisiTipi !== 'SAHIS' && kisiTipi !== 'TUZEL') throw new ValidationError('Şahıs veya şirket seçin.');
  const vergiNo = text(b.vergi_no, 20).replace(/\s/g, '');
  if (vergiNo && !/^\d{10,11}$/.test(vergiNo)) throw new ValidationError('Vergi no 10, TC kimlik no 11 haneli olmalıdır.');
  const fields: Record<string, unknown> = Object.fromEntries(CARD_TEXT.map(([key, max]) => [key, text(b[key], max)]));
  if (fields.eposta && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.eposta))) throw new ValidationError('E-posta adresi geçersiz.');
  const values: Record<string, unknown> = {
    anahtar: normalizeText(isim), isim, tur, kisi_tipi: kisiTipi, ...fields, vergi_no: vergiNo,
    vade_gun: wholeDays(b.vade_gun, 'Vade', 3650), limit_has: hasLimit(b.limit_has),
  };
  const cols = Object.keys(values);
  await run(
    c.env.DB,
    `INSERT INTO cari_kartlari (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(anahtar) DO UPDATE SET ${cols.filter((k) => k !== 'anahtar').map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`,
    ...Object.values(values)
  );
  await log(c, 'update', `Cari kartı: ${isim} (${tur})`);
  return c.json(ok(await first(c.env.DB, `SELECT * FROM cari_kartlari WHERE anahtar = ?`, values.anahtar), 'Cari kartı kaydedildi.'));
});

cariKart.put('/ayar', async (c) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  const n = wholeDays((await body(c)).vade_gun_varsayilan, 'Vade', 3650) ?? DEFAULT_VADE;
  await run(c.env.DB, `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('vade_varsayilan', ?)`, String(n));
  return c.json(ok({ vade_gun_varsayilan: n }, 'Vade ayarı kaydedildi.'));
});

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * GET /api/uyarilar
 * vade: bakiyesi açık ve son işleminden bu yana vade günü geçmiş cariler
 * limit: has bakiyesi kart limitini aşan müşteriler
 * siparis: teslim günü bugün/yarın olan veya geciken açık siparişler
 * atolye: atölyenin söz verdiği dönüş günü geçmiş işler
 */
export const uyarilar = new Hono<Env>();

uyarilar.get('/', async (c) => {
  const day = today(tz(c));
  const [snapshot, cards, vadeDefault, orders, jobs] = await Promise.all([loadSnapshot(c.env.DB), loadCards(c), defaultVade(c), loadOrders(c), loadJobs(c)]);
  const byKey = new Map(cards.map((k) => [k.anahtar, k]));
  const vade: Record<string, unknown>[] = [];
  const limit: Record<string, unknown>[] = [];
  for (const p of new Ledger(snapshot, tz(c)).cariData().kisiler as Record<string, any>[]) {
    const kalan = d(p.kalan_has);
    if (kalan.abs().lt(d('0.001'))) continue;
    const card = byKey.get(normalizeText(p.isim));
    const vadeGun = card?.vade_gun ?? vadeDefault;
    const gun = p.son_islem_tarihi ? daysBetween(p.son_islem_tarihi, day) : 0;
    const base = { isim: p.isim, tur: card?.tur ?? '', telefon: card?.telefon ?? '', kalan_has: p.kalan_has, son_islem_tarihi: p.son_islem_tarihi };
    if (vadeGun > 0 && gun >= vadeGun) vade.push({ ...base, gun, vade_gun: vadeGun, gecikme_gun: gun - vadeGun, yon: kalan.gt(0) ? 'ALACAK' : 'BORC' });
    if (card && card.limit_has > 0 && kalan.gt(d(card.limit_has))) limit.push({ ...base, limit_has: card.limit_has });
  }
  vade.sort((a, b) => (b.gecikme_gun as number) - (a.gecikme_gun as number));
  const siparis = orders
    .filter((o) => OPEN_STATES.includes(o.durum) && o.kalan_gun !== null && o.kalan_gun <= 1)
    .map((o) => ({ id: o.id, tur: o.tur, musteri: o.musteri, telefon: o.telefon, urun: o.urun, durum: o.durum, teslim_tarihi: o.teslim_tarihi, kalan_gun: o.kalan_gun, kalan_tl: o.kalan_tl }));
  const atolye = jobs
    .filter((j) => j.durum === 'ATOLYEDE' && j.gecikme_gun > 0)
    .map((j) => ({ id: j.id, atolye: j.atolye, is_tanimi: j.is_tanimi, asama_adi: j.asama_adi, soz_tarihi: j.soz_tarihi, gecikme_gun: j.gecikme_gun }));
  return c.json(ok({ tarih: day, vade_gun_varsayilan: vadeDefault, vade, limit, siparis, atolye, toplam: vade.length + limit.length + siparis.length + atolye.length }));
});
