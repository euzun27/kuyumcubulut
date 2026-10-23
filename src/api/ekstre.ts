/**
 * Ekstreler: seçilen tarih aralığında cari, stok ve kasa hesap dökümü.
 * Her ekstre devir (başlangıçtan önceki bakiye), tarih sırasıyla hareketler ve
 * her satırda yürüyen bakiye döner. Bakiyeler cari, stok ve kasa ekranlarıyla
 * aynı kurallarla hesaplanır.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first } from '../lib/db';
import { Dec, d, ZERO, HAS_Q, MONEY_Q, NUM_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { cleanText, normalizeText } from '../lib/text';
import { Ledger, type Row } from '../lib/ledger';
import { loadSnapshot } from '../lib/store';
import { date } from '../lib/kasa';

const ekstre = new Hono<Env>();
const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

function range(c: Context<Env>): [string, string] {
  const end = date(c.req.query('bitis'), today(tz(c)));
  const start = date(c.req.query('baslangic'), `${end.slice(0, 8)}01`);
  if (start > end) throw new ValidationError('Başlangıç tarihi bitişten sonra olamaz.');
  return [start, end];
}

async function ledger(c: Context<Env>) {
  return new Ledger(await loadSnapshot(c.env.DB), tz(c));
}

/**
 * Hareketleri devir + aralık içi satırlar olarak böler; `keys` alanları için
 * devir, toplam giriş/çıkış ve yürüyen bakiye hesaplanır.
 */
function statement(rows: Row[], start: string, end: string, keys: Record<string, number>) {
  const devir: Record<string, Dec> = Object.fromEntries(Object.keys(keys).map((k) => [k, ZERO]));
  const giris: Record<string, Dec> = { ...devir };
  const cikis: Record<string, Dec> = { ...devir };
  const bakiye: Record<string, Dec> = { ...devir };
  const out: Row[] = [];
  for (const r of rows) {
    if (r.tarih > end) continue;
    for (const k of Object.keys(keys)) bakiye[k] = bakiye[k].add(d(r[k] ?? 0));
    if (r.tarih < start) { for (const k of Object.keys(keys)) devir[k] = bakiye[k]; continue; }
    for (const k of Object.keys(keys)) {
      const v = d(r[k] ?? 0);
      if (v.gt(ZERO)) giris[k] = giris[k].add(v); else cikis[k] = cikis[k].add(v.neg());
    }
    out.push({ ...r, ...Object.fromEntries(Object.entries(keys).map(([k, q]) => [`bakiye_${k}`, bakiye[k].q(q).toNumber()])) });
  }
  const pack = (m: Record<string, Dec>) => Object.fromEntries(Object.entries(keys).map(([k, q]) => [k, m[k].q(q).toNumber()]));
  return { baslangic: start, bitis: end, devir: pack(devir), giris: pack(giris), cikis: pack(cikis), kapanis: pack(bakiye), satirlar: out };
}

/** GET /api/ekstre/cariler: ekstre alınabilecek kişi/firmalar. */
ekstre.get('/cariler', async (c) => {
  const cari = (await ledger(c)).cariData();
  return c.json(ok(cari.kisiler.map((r: Row) => ({ isim: r.isim, kalan_has: r.kalan_has, net_bakiye: r.net_bakiye }))));
});

/** GET /api/ekstre/cari?isim=&baslangic=&bitis= */
ekstre.get('/cari', async (c) => {
  const isim = cleanText(c.req.query('isim'));
  if (!isim) throw new ValidationError('Cari seçin.');
  const [start, end] = range(c);
  const l = await ledger(c);
  const kisi = l.cariData().kisiler.find((r: Row) => normalizeText(r.isim) === normalizeText(isim));
  if (!kisi) throw new HttpError(404, 'Cari bulunamadı.');
  return c.json(ok({ isim: kisi.isim, ...statement(l.cariMovements(isim), start, end, { has: HAS_Q }) }));
});

/** GET /api/ekstre/urunler?tur=normal|hurda: ekstre alınabilecek ürünler. */
ekstre.get('/urunler', async (c) => {
  const l = await ledger(c);
  const hurda = c.req.query('tur') === 'hurda';
  const items = hurda ? l.hurdaStockItems() : l.stockItems();
  return c.json(ok(items.map((r) => ({ cinsi: r.cinsi, ayar: r.ayar, kalan_gram: r.kalan_gram, kalan_has: r.kalan_has }))));
});

/** GET /api/ekstre/stok?tur=normal|hurda&cinsi=&ayar=&baslangic=&bitis= */
ekstre.get('/stok', async (c) => {
  const cinsi = cleanText(c.req.query('cinsi'));
  if (!cinsi) throw new ValidationError('Ürün seçin.');
  const ayar = cleanText(c.req.query('ayar'));
  const tur = c.req.query('tur') === 'hurda' ? 'hurda' : 'normal';
  const [start, end] = range(c);
  const l = await ledger(c);
  const data = statement(l.stockMovements(tur, cinsi, ayar), start, end, { gram: NUM_Q, has: HAS_Q });
  return c.json(ok({ tur, cinsi, ayar, ...data }));
});

const kategoriText = (v: unknown) => cleanText(v).toLocaleLowerCase('tr-TR').replace(/_/g, ' ').replace(/^\p{L}/u, (ch) => ch.toLocaleUpperCase('tr-TR'));

/** GET /api/ekstre/kasa?hesap_id=&baslangic=&bitis= */
ekstre.get('/kasa', async (c) => {
  const id = Number(c.req.query('hesap_id'));
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Hesap seçin.');
  const [start, end] = range(c);
  const hesap = await first(c.env.DB, `SELECT id, ad, para_birimi FROM kasa_hesaplari WHERE id = ?`, id);
  if (!hesap) throw new HttpError(404, 'Hesap bulunamadı.');
  const rows = await all(c.env.DB,
    `SELECT id, tarih, yon, tutar, komisyon, aciklama, kategori, bagli_tur FROM kasa_hareketleri WHERE hesap_id = ? AND tarih <= ? ORDER BY tarih, id`, id, end);
  const LABELS: Record<string, string> = { alis: 'Alış', satis: 'Satış', hurda: 'Hurda', cari_odeme: 'Cari ödeme', siparis: 'Sipariş', siparis_teslim: 'Sipariş', metal: 'Gümüş / Bakır', gider: 'Gider', doviz: 'Döviz' };
  const moves = rows.map((r) => ({
    tarih: String(r.tarih),
    islem: r.bagli_tur ? LABELS[String(r.bagli_tur)] ?? String(r.bagli_tur) : r.yon === 'GIRIS' ? 'Giriş' : 'Çıkış',
    // Bağlı kayıtta kategori işlemle aynıdır (SATIS → Satış); yalnızca elle girilenlerde gösterilir.
    aciklama: cleanText(r.aciklama) || (r.bagli_tur ? '' : kategoriText(r.kategori)),
    komisyon: d(r.komisyon ?? 0).q(MONEY_Q).toNumber(),
    tutar: (r.yon === 'GIRIS' ? d(r.tutar).sub(d(r.komisyon ?? 0)) : d(r.tutar).neg()).q(MONEY_Q).toNumber(),
  }));
  return c.json(ok({ hesap: { id: hesap.id, ad: hesap.ad, para_birimi: hesap.para_birimi }, ...statement(moves, start, end, { tutar: MONEY_Q }) }));
});

export default ekstre;
