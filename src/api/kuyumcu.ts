/**
 * Kuyumcu API'si: alış, satış, hurda, stok, cari, gider, özet ve yedek.
 * Uç adresleri ve cevap biçimi masaüstü sürümle aynıdır ({status, message, data}).
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { barcodeOf, etiketStmts } from './etiket';
import { d, ZERO, MONEY_Q } from '../lib/decimal';
import { normalizeText, cleanText } from '../lib/text';
import { Ledger, cariPaymentOut, purchaseTotal, rowDict, type Row } from '../lib/ledger';
import { loadSnapshot, insertStmt, updateStmt, allocationStmts, idsParam, KASA_TABLES, BUSINESS_TABLES } from '../lib/store';
import {
  HttpError,
  calcHas,
  calcTransactionPayment,
  parseAlis,
  parseSatis,
  parseHurda,
  parseCariOdeme,
  parseCariRename,
  parseCariDelete,
  parseGider,
  parseUiSettings,
  parseId,
  today,
  ValidationError,
  type CariOdemePayload,
  type GiderPayload,
  type TxPayload,
} from '../lib/validate';
import { currentPrices } from './fiyat';
import { dovizCari } from './doviz';
import { audit, verifyPassword } from '../lib/auth';
import { SURUM } from '../lib/surum';
import { createBackup, cleanupOldBackups, latestBackup, restoreLatest, listBackups, loadBackupData, restoreData, checkBackupData, snapshotTables } from '../lib/backup';
import { checkItems, guardNegativeTl, linkedByRecord, linkedStmts, loadAccounts, parseKasaItems, type LinkedType } from '../lib/kasa';

const api = new Hono<Env>();

export function ok(data: unknown = null, message = '') {
  return { status: 'ok', message, data };
}

const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

async function ledger(c: Context<Env>) {
  return new Ledger(await loadSnapshot(c.env.DB), tz(c));
}

function num(value: { toString(): string }): number {
  return Number(value.toString());
}

function log(c: Context<Env>, action: string, entityType: string, entityId: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType, entityId, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

/** İşlemin has değeri: elle girilmişse o, değilse gram × milyem / 1000. */
function txHas(p: TxPayload) {
  return p.has_override !== null ? p.has_override : calcHas(p.gram, p.milyem);
}

function paymentColumns(p: TxPayload, paidHas: ReturnType<typeof d>) {
  return {
    odeme_tipi: p.odeme_tipi,
    odenen_has: num(paidHas),
    odenen_adet: num(p.odenen_adet),
    odenen_gram: num(p.odenen_gram),
    odenen_milyem: num(p.odenen_milyem),
  };
}

 /**
 * Kayda bağlı kasa ödemeleri (bulut sürümü): gövdede `kasa` alanı varsa bağlı
 * hareketler yeniden yazılır; yoksa mevcut hareketlerin tarihi ve carisi
 * kayıtla birlikte güncellenir. Has bakiyesi her zaman kaydın kendi ödeme
 * alanlarıyla hesaplanır.
 */
async function kasaLink(
  c: Context<Env>,
  b: Record<string, unknown>,
  tur: LinkedType,
  id: number | null,
  meta: { tarih: string; cari: string; yon: 'GIRIS' | 'CIKIS'; kategori: string; aciklama?: string }
): Promise<Stmt[]> {
  const items = parseKasaItems(b.kasa);
  if (items === null) {
    return id === null ? [] : [{ sql: `UPDATE kasa_hareketleri SET tarih = ?, cari = ? WHERE bagli_tur = ? AND bagli_id = ?`, args: [meta.tarih, meta.cari, tur, id] }];
  }
  const accounts = await loadAccounts(c.env.DB);
  checkItems(items, accounts);
  if (meta.yon === 'CIKIS') await guardNegativeTl(c.env.DB, b, accounts, items, id === null ? null : { tur, id });
  return linkedStmts(tur, id, items, accounts, { aciklama: '', ...meta, kullanici: c.get('user')?.name ?? null });
}

/** Liste çıktısına bağlı kasa ödemelerini ekler. */
async function withKasa(c: Context<Env>, tur: LinkedType, rows: Row[]): Promise<Row[]> {
  const linked = await linkedByRecord(c.env.DB, tur);
  return rows.map((r) => ({ ...r, kasa_odemeleri: linked.get(Number(r.id)) ?? [] }));
}

const hurdaKasa = (islemTuru: string) =>
  islemTuru === 'SATIS' ? { yon: 'GIRIS' as const, kategori: 'HURDA_SATIS' } : { yon: 'CIKIS' as const, kategori: 'HURDA_ALIS' };

/* ------------------------------------------------------------------ */
/* Öneriler, stok seçenekleri                                          */
/* ------------------------------------------------------------------ */

api.get('/suggestions', async (c) => c.json(ok((await ledger(c)).suggestions())));

const excludeParam = (c: Context<Env>) => {
  const raw = c.req.query('exclude_sale_id');
  return raw === undefined || raw === '' ? null : parseId(raw);
};

api.get('/stok/normal/secenekler', async (c) => c.json(ok((await ledger(c)).stockOptions('normal', excludeParam(c)))));
api.get('/stok/hurda/secenekler', async (c) => c.json(ok((await ledger(c)).stockOptions('hurda', excludeParam(c)))));
api.get('/stok', async (c) => c.json(ok((await ledger(c)).stockItems())));
api.get('/stok/normal', async (c) => c.json(ok((await ledger(c)).stockItems())));
api.get('/stok/hurda', async (c) => c.json(ok((await ledger(c)).hurdaStockItems())));

/* ------------------------------------------------------------------ */
/* Alış                                                                */
/* ------------------------------------------------------------------ */

api.get('/alis', async (c) => {
  const l = await ledger(c);
  return c.json(ok(await withKasa(c, 'alis', l.s.alis.map((r) => l.purchaseOut(r)))));
});

api.get('/satis/urun-secenekleri', async (c) => c.json(ok((await ledger(c)).saleOptions())));
api.get('/alis/selectable', async (c) => c.json(ok((await ledger(c)).saleOptions())));

function alisValues(p: ReturnType<typeof parseAlis>, has: ReturnType<typeof d>, paidHas: ReturnType<typeof d>) {
  return {
    tarih: p.tarih, tedarikci: p.tedarikci, cinsi: p.cinsi, ayar: p.ayar,
    adet: num(p.adet), gram: num(p.gram), milyem: num(p.milyem), has: num(has),
    has_fiyati: num(p.has_fiyati), iscilik: num(p.iscilik), ek_masraf: num(p.ek_masraf), odenen: num(p.odenen), notlar: p.notlar,
    ...paymentColumns(p, paidHas),
  };
}

api.post('/alis', async (c) => {
  const b = await body(c);
  const p = parseAlis(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const kasa = await kasaLink(c, b, 'alis', null, { tarih: p.tarih, cari: p.tedarikci, yon: 'CIKIS', kategori: 'ALIS' });
  const [res] = await tx(c.env.DB, [insertStmt('alis', alisValues(p, has, paidHas)), ...kasa]);
  const row = (res.results as Row[])[0];
  await log(c, 'create', 'alis', row.id, `${p.tedarikci} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  return c.json(ok(new Ledger({ alis: [], satis: [], hurda: [], cari_odeme: [], giderler: [], allocations: [] }).purchaseOut(row), 'Alış kaydedildi.'));
});

api.put('/alis/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const b = await body(c);
  const p = parseAlis(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const l = await ledger(c);
  const existing = l.alis(id);
  if (!existing) throw new HttpError(404, 'Kayıt bulunamadı.');
  const soldGram = d(existing.gram).sub(l.purchaseRemaining(existing).kalan_gram);
  if (soldGram.gt(ZERO) && (normalizeText(existing.cinsi) !== normalizeText(p.cinsi) || normalizeText(existing.ayar) !== normalizeText(p.ayar))) {
    throw new HttpError(400, 'Bu alış kaydına bağlı satış var; cinsi veya ayar değiştirilemez.');
  }
  if (soldGram.gt(p.gram)) throw new HttpError(400, 'Bu alış kaydına bağlı satış var; gram mevcut satışın altına düşürülemez.');
  if (p.has_fiyati.isZero() && p.iscilik.isZero() && p.ek_masraf.isZero() && p.odenen.isZero()) {
    p.has_fiyati = d(existing.has_fiyati);
    p.iscilik = d(existing.iscilik);
    p.ek_masraf = d(existing.ek_masraf);
    p.odenen = d(existing.odenen);
  }
  const kasa = await kasaLink(c, b, 'alis', id, { tarih: p.tarih, cari: p.tedarikci, yon: 'CIKIS', kategori: 'ALIS' });
  const [res] = await tx(c.env.DB, [updateStmt('alis', id, alisValues(p, has, paidHas)), ...kasa]);
  const row = (res.results as Row[])[0];
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı.');
  await log(c, 'update', 'alis', id, `${p.tedarikci} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  return c.json(ok(l.purchaseOut(row), 'Alış güncellendi.'));
});

/* ------------------------------------------------------------------ */
/* Satış                                                               */
/* ------------------------------------------------------------------ */

api.get('/satis', async (c) => {
  const l = await ledger(c);
  const rows = await withKasa(c, 'satis', l.s.satis.map((r) => l.saleOut(r)));
  const tags = new Map((await all(c.env.DB, `SELECT * FROM etiketler WHERE satis_id IS NOT NULL`)).map((t) => [Number(t.satis_id), t]));
  return c.json(ok(rows.map((r) => (tags.has(Number(r.id)) ? { ...r, etiket: { ...tags.get(Number(r.id)), barkod: barcodeOf(Number(tags.get(Number(r.id)).id)) } } : r))));
});

function satisValues(p: ReturnType<typeof parseSatis>, has: ReturnType<typeof d>, paidHas: ReturnType<typeof d>, stoktan: boolean) {
  return {
    tarih: p.tarih, musteri: p.musteri, cinsi: p.cinsi, ayar: p.ayar,
    adet: num(p.adet), gram: num(p.gram), milyem: num(p.milyem), has: num(has),
    has_fiyati: num(p.has_fiyati), iscilik: num(p.iscilik), ek_ucret: num(p.ek_ucret), indirim: num(p.indirim), alinan: num(p.alinan), notlar: p.notlar,
    alis_id: p.alis_id, purchase_id: p.alis_id, stoktan: stoktan ? 1 : 0,
    ...paymentColumns(p, paidHas),
  };
}

api.post('/satis', async (c) => {
  const b = await body(c);
  const p = parseSatis(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const l = await ledger(c);
  const plan = p.stoktan ? l.planStockSale('normal', p) : [];
  if (p.stoktan) p.alis_id = null;
  const alis = plan.length ? l.alis(plan[0].purchase_id)! : l.ensureSaleStock(p);
  if (p.has_fiyati.isZero()) p.has_fiyati = d(alis.has_fiyati);
  const kasa = await kasaLink(c, b, 'satis', null, { tarih: p.tarih, cari: p.musteri, yon: 'GIRIS', kategori: 'SATIS' });
  const tags = await etiketStmts(c, b.etiket_id, null);
  const [res] = await tx(c.env.DB, [insertStmt('satis', satisValues(p, has, paidHas, plan.length > 0)), ...allocationStmts('normal', null, plan), ...kasa, ...tags]);
  const id = Number((res.results as Row[])[0].id);
  await log(c, 'create', 'satis', id, `${p.musteri} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  const after = await ledger(c);
  return c.json(ok(after.saleOut(after.satis(id)!), 'Satış kaydedildi.'));
});

api.put('/satis/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const b = await body(c);
  const p = parseSatis(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const l = await ledger(c);
  const existing = l.satis(id);
  if (!existing) throw new HttpError(404, 'Kayıt bulunamadı.');
  const plan = p.stoktan ? l.planStockSale('normal', p, id) : [];
  if (p.stoktan) p.alis_id = null;
  const alis = plan.length ? l.alis(plan[0].purchase_id)! : l.ensureSaleStock(p, id);
  if (p.has_fiyati.isZero() && p.iscilik.isZero() && p.ek_ucret.isZero() && p.indirim.isZero() && p.alinan.isZero()) {
    p.has_fiyati = d(existing.has_fiyati);
    p.iscilik = d(existing.iscilik);
    p.ek_ucret = d(existing.ek_ucret);
    p.indirim = d(existing.indirim);
    p.alinan = d(existing.alinan);
  } else if (p.has_fiyati.isZero()) {
    p.has_fiyati = d(alis.has_fiyati);
  }
  const kasa = await kasaLink(c, b, 'satis', id, { tarih: p.tarih, cari: p.musteri, yon: 'GIRIS', kategori: 'SATIS' });
  const tags = await etiketStmts(c, b.etiket_id, id);
  await tx(c.env.DB, [updateStmt('satis', id, satisValues(p, has, paidHas, plan.length > 0)), ...allocationStmts('normal', id, plan), ...kasa, ...tags]);
  await log(c, 'update', 'satis', id, `${p.musteri} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  const after = await ledger(c);
  return c.json(ok(after.saleOut(after.satis(id)!), 'Satış güncellendi.'));
});

/* ------------------------------------------------------------------ */
/* Hurda                                                               */
/* ------------------------------------------------------------------ */

api.get('/hurda/urun-secenekleri', async (c) => c.json(ok((await ledger(c)).hurdaSaleOptions())));
api.get('/hurda', async (c) => {
  const list = (await ledger(c)).hurdaList();
  return c.json(ok({ ...list, kayitlar: await withKasa(c, 'hurda', list.kayitlar) }));
});

function hurdaValues(p: ReturnType<typeof parseHurda>, has: ReturnType<typeof d>, paidHas: ReturnType<typeof d>, total: ReturnType<typeof d>, stoktan: boolean) {
  return {
    hurda_alis_id: p.islem_turu === 'SATIS' ? p.hurda_alis_id : null,
    tarih: p.tarih, islem_turu: p.islem_turu, kisi: p.kisi, cinsi: p.cinsi, ayar: p.ayar,
    adet: num(p.adet), gram: num(p.gram), milyem: num(p.milyem), has: num(has),
    has_fiyati: num(p.has_fiyati), iscilik: num(p.iscilik), toplam_tutar: num(total), odenen_veya_alinan: num(p.odenen_veya_alinan), notlar: p.notlar,
    stoktan: stoktan ? 1 : 0,
    ...paymentColumns(p, paidHas),
  };
}

api.post('/hurda', async (c) => {
  const b = await body(c);
  const p = parseHurda(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const total = has.mul(p.has_fiyati).add(p.iscilik).q(MONEY_Q);
  const l = await ledger(c);
  const plan = p.stoktan && p.islem_turu === 'SATIS' ? l.planStockSale('hurda', p) : [];
  if (plan.length) p.hurda_alis_id = null;
  else l.ensureHurdaStock(p);
  const kasa = await kasaLink(c, b, 'hurda', null, { tarih: p.tarih, cari: p.kisi, ...hurdaKasa(p.islem_turu) });
  const [res] = await tx(c.env.DB, [insertStmt('hurda', hurdaValues(p, has, paidHas, total, plan.length > 0)), ...allocationStmts('hurda', null, plan), ...kasa]);
  const id = Number((res.results as Row[])[0].id);
  await log(c, 'create', 'hurda', id, `${p.islem_turu} ${p.kisi} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  const after = await ledger(c);
  return c.json(ok(after.hurdaOut(after.hurda(id)!), 'Hurda kaydedildi.'));
});

api.put('/hurda/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const b = await body(c);
  const p = parseHurda(b, tz(c));
  const has = txHas(p);
  const paidHas = calcTransactionPayment(p, has);
  const l = await ledger(c);
  const existing = l.hurda(id);
  if (!existing) throw new HttpError(404, 'Kayıt bulunamadı.');
  if (p.islem_turu !== existing.islem_turu) throw new HttpError(400, 'Kayıt düzenlenirken alış/satış türü değiştirilemez.');
  if (existing.islem_turu === 'ALIS') {
    const used = d(existing.gram).sub(l.hurdaPurchaseRemaining(existing).kalan_gram);
    if (used.gt(ZERO) && (normalizeText(existing.cinsi) !== normalizeText(p.cinsi) || normalizeText(existing.ayar) !== normalizeText(p.ayar) || p.gram.lt(used))) {
      throw new HttpError(400, 'Bu hurda alışına bağlı satış var; ürün veya satılan gram korunmalı.');
    }
  }
  if (p.has_fiyati.isZero() && p.iscilik.isZero() && p.odenen_veya_alinan.isZero()) {
    p.has_fiyati = d(existing.has_fiyati);
    p.iscilik = d(existing.iscilik);
    p.odenen_veya_alinan = d(existing.odenen_veya_alinan);
  }
  const total = has.mul(p.has_fiyati).add(p.iscilik).q(MONEY_Q);
  const plan = p.stoktan && p.islem_turu === 'SATIS' ? l.planStockSale('hurda', p, id) : [];
  if (plan.length) p.hurda_alis_id = null;
  else l.ensureHurdaStock(p, id);
  const kasa = await kasaLink(c, b, 'hurda', id, { tarih: p.tarih, cari: p.kisi, ...hurdaKasa(p.islem_turu) });
  await tx(c.env.DB, [updateStmt('hurda', id, hurdaValues(p, has, paidHas, total, plan.length > 0)), ...allocationStmts('hurda', id, plan), ...kasa]);
  await log(c, 'update', 'hurda', id, `${p.islem_turu} ${p.kisi} - ${p.cinsi} ${p.ayar} ${p.gram} gr`);
  const after = await ledger(c);
  return c.json(ok(after.hurdaOut(after.hurda(id)!), 'Hurda güncellendi.'));
});

/* ------------------------------------------------------------------ */
/* Cari                                                                */
/* ------------------------------------------------------------------ */

api.get('/cari', async (c) => {
  const data = (await ledger(c)).cariData();
  return c.json(ok({ ...withDoviz(data, await dovizCari(c.env.DB)), odemeler: await withKasa(c, 'cari_odeme', data.odemeler) }));
});

/**
 * Döviz carisi has carisinin yanına eklenir: her kişide `doviz_bakiye`
 * ({USD: 100} = bize 100 dolar borçlu). Yalnızca döviz işlemi olan kişi
 * sıfır has bakiyesiyle listeye girer.
 */
function withDoviz(data: Row, doviz: Awaited<ReturnType<typeof dovizCari>>): Row {
  const byKey = new Map(doviz.map((p) => [p.anahtar, p]));
  const mark = (rows: Row[]): Row[] => rows.map((r) => ({ ...r, doviz_bakiye: byKey.get(normalizeText(r.isim))?.bakiye ?? {} }));
  const kisiler = mark(data.kisiler);
  const known = new Set(kisiler.map((r) => normalizeText(r.isim)));
  const template = data.kisiler[0] as Row | undefined;
  for (const p of doviz) {
    if (known.has(p.anahtar)) continue;
    const zero: Row = Object.fromEntries(Object.entries(template ?? { net_bakiye_has: 0, kalan_has: 0 }).map(([k, v]) => [k, typeof v === 'number' ? 0 : v]));
    kisiler.push({ ...zero, isim: p.isim, son_islem_tarihi: p.son_islem_tarihi, doviz_bakiye: p.bakiye });
  }
  kisiler.sort((a, b) => (normalizeText(a.isim) < normalizeText(b.isim) ? -1 : normalizeText(a.isim) > normalizeText(b.isim) ? 1 : 0));
  return { ...data, kisiler, musteriler: mark(data.musteriler), tedarikciler: mark(data.tedarikciler), doviz };
}

/** Henüz işlemi olmayan ama cari kartı açılmış kişi (örn. yeni atölye): bakiyesi sıfırdır. */
async function hasCard(c: Context<Env>, isim: string) {
  return !!(await first(c.env.DB, `SELECT id FROM cari_kartlari WHERE anahtar = ?`, normalizeText(isim)));
}

function resolvedCariPayment(l: Ledger, p: CariOdemePayload, existing?: Row, carded = false) {
  const current = (l.cariData().kisiler as Row[]).find((r) => normalizeText(r.isim) === normalizeText(p.isim));
  if (!current && !carded) throw new HttpError(404, 'Cari bulunamadı.');
  let balance = d(current?.kalan_has ?? 0);
  if (existing && normalizeText(existing.isim) === normalizeText(p.isim)) {
    const old = d(existing.odenen_has);
    balance = (existing.yon ?? 'TAHSILAT') === 'TAHSILAT' ? balance.add(old) : balance.sub(old);
  }
  let direction = p.yon;
  if (direction === 'OTOMATIK') {
    if (balance.isZero()) throw new HttpError(400, 'Cari bakiye kapalı; ödeme yönü belirlenemedi.');
    direction = balance.gt(ZERO) ? 'TAHSILAT' : 'ODEME';
  }
  const paymentHas = p.odeme_tipi === 'TAM_KAPAT' ? balance.abs() : p.odenen_has;
  return { paymentHas, direction };
}

function cariValues(p: CariOdemePayload, paymentHas: ReturnType<typeof d>, direction: string) {
  return {
    tarih: p.tarih, isim: p.isim, odeme_tipi: p.odeme_tipi, adet: num(p.adet), gram: num(p.gram), milyem: num(p.milyem),
    odenen_has: num(paymentHas), yon: direction, notlar: p.notlar,
  };
}

const cariKasa = (direction: string) =>
  direction === 'ODEME' ? { yon: 'CIKIS' as const, kategori: 'CARI_ODEME' } : { yon: 'GIRIS' as const, kategori: 'CARI_TAHSILAT' };

api.post('/cari/odeme', async (c) => {
  const b = await body(c);
  const p = parseCariOdeme(b, tz(c));
  const l = await ledger(c);
  const known = (l.cariData().kisiler as Row[]).some((r) => normalizeText(r.isim) === normalizeText(p.isim));
  const { paymentHas, direction } = resolvedCariPayment(l, p, undefined, !known && (await hasCard(c, p.isim)));
  const kasa = await kasaLink(c, b, 'cari_odeme', null, { tarih: p.tarih, cari: p.isim, ...cariKasa(direction) });
  const [res] = await tx(c.env.DB, [insertStmt('cari_odeme', cariValues(p, paymentHas, direction)), ...kasa]);
  const row = (res.results as Row[])[0];
  await log(c, 'create', 'cari_odeme', row.id, `${p.isim} ${direction} ${paymentHas.toString()} has`);
  return c.json(ok(cariPaymentOut(row), 'Cari ödeme kaydedildi.'));
});

api.put('/cari/odeme/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const b = await body(c);
  const p = parseCariOdeme(b, tz(c));
  const l = await ledger(c);
  const existing = l.s.cari_odeme.find((r) => Number(r.id) === id);
  if (!existing) throw new HttpError(404, 'Cari ödeme kaydı bulunamadı.');
  const known = (l.cariData().kisiler as Row[]).some((r) => normalizeText(r.isim) === normalizeText(p.isim));
  const { paymentHas, direction } = resolvedCariPayment(l, p, existing, !known && (await hasCard(c, p.isim)));
  const kasa = await kasaLink(c, b, 'cari_odeme', id, { tarih: p.tarih, cari: p.isim, ...cariKasa(direction) });
  const [res] = await tx(c.env.DB, [updateStmt('cari_odeme', id, cariValues(p, paymentHas, direction)), ...kasa]);
  await log(c, 'update', 'cari_odeme', id, `${p.isim} ${direction} ${paymentHas.toString()} has`);
  return c.json(ok(cariPaymentOut((res.results as Row[])[0]), 'Cari ödeme güncellendi.'));
});

api.delete('/cari/odeme/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM cari_odeme WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Cari ödeme kaydı bulunamadı.');
  await log(c, 'delete', 'cari_odeme', id, 'Cari ödeme silindi');
  return c.json(ok({ id }, 'Cari ödeme silindi.'));
});

const PERSON_COLUMNS: [keyof Ledger['s'], string][] = [['alis', 'tedarikci'], ['satis', 'musteri'], ['hurda', 'kisi'], ['cari_odeme', 'isim']];

api.put('/cari/kisi', async (c) => {
  const p = parseCariRename(await body(c));
  const key = normalizeText(p.eski_isim);
  const l = await ledger(c);
  const stmts: Stmt[] = [];
  let updated = 0;
  for (const [table, col] of PERSON_COLUMNS) {
    const ids = (l.s[table] as Row[]).filter((r) => normalizeText(r[col]) === key).map((r) => Number(r.id));
    if (!ids.length) continue;
    updated += ids.length;
    stmts.push({ sql: `UPDATE ${table} SET ${col} = ? WHERE id IN (SELECT value FROM json_each(?))`, args: [p.yeni_isim, idsParam(ids)] });
    stmts.push({ sql: `UPDATE kasa_hareketleri SET cari = ? WHERE bagli_tur = ? AND bagli_id IN (SELECT value FROM json_each(?))`, args: [p.yeni_isim, table, idsParam(ids)] });
  }
  const doviz = (await all(c.env.DB, `SELECT id, kisi FROM doviz_islemleri WHERE kisi != ''`)).filter((r) => normalizeText(r.kisi) === key).map((r) => Number(r.id));
  if (doviz.length) {
    updated += doviz.length;
    stmts.push({ sql: `UPDATE doviz_islemleri SET kisi = ? WHERE id IN (SELECT value FROM json_each(?))`, args: [p.yeni_isim, idsParam(doviz)] });
    stmts.push({ sql: `UPDATE kasa_hareketleri SET cari = ? WHERE bagli_tur = 'doviz' AND bagli_id IN (SELECT value FROM json_each(?))`, args: [p.yeni_isim, idsParam(doviz)] });
  }
  if (!updated && !(await hasCard(c, p.eski_isim))) throw new HttpError(404, 'Cari bulunamadı.');
  // Cari kartı yeni isme taşınır; yeni isimde zaten kart varsa o korunur.
  stmts.push({ sql: `UPDATE OR IGNORE cari_kartlari SET anahtar = ?, isim = ?, updated_at = datetime('now') WHERE anahtar = ?`, args: [normalizeText(p.yeni_isim), p.yeni_isim, key] });
  stmts.push({ sql: `DELETE FROM cari_kartlari WHERE anahtar = ? AND anahtar != ?`, args: [key, normalizeText(p.yeni_isim)] });
  await tx(c.env.DB, stmts);
  await log(c, 'update', 'cari', null, `Cari adı değişti: ${p.eski_isim} → ${p.yeni_isim}`);
  return c.json(ok({ eski_isim: p.eski_isim, yeni_isim: p.yeni_isim, guncellenen: updated }, 'Cari adı güncellendi.'));
});

api.post('/cari/kisi/sil', async (c) => {
  const p = parseCariDelete(await body(c));
  const key = normalizeText(p.isim);
  const l = await ledger(c);
  for (const a of l.s.allocations) {
    const normal = a.kind === 'normal';
    const purchase = normal ? l.alis(a.purchase_id) : l.hurda(a.purchase_id);
    const sale = normal ? l.satis(a.sale_id) : l.hurda(a.sale_id);
    if (purchase && sale && normalizeText(purchase[normal ? 'tedarikci' : 'kisi']) === key && normalizeText(sale[normal ? 'musteri' : 'kisi']) !== key) {
      throw new HttpError(400, 'Bu carinin stoktan satışlarda kullanılan alışları var; önce ilgili satışları kontrol edin.');
    }
  }
  const stmts: Stmt[] = [];
  let deleted = 0;
  for (const [table, col] of PERSON_COLUMNS) {
    const ids = (l.s[table] as Row[]).filter((r) => normalizeText(r[col]) === key).map((r) => Number(r.id));
    if (!ids.length) continue;
    deleted += ids.length;
    stmts.push({ sql: `DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, args: [idsParam(ids)] });
  }
  // Döviz işlemleri silinmez (iptal edilir); açık döviz işlemi olan cari silinemez.
  const doviz = (await all(c.env.DB, `SELECT kisi FROM doviz_islemleri WHERE kisi != '' AND durum = 'AKTIF'`)).filter((r) => normalizeText(r.kisi) === key);
  if (doviz.length) throw new HttpError(400, `Bu carinin ${doviz.length} döviz işlemi var. Döviz işlemleri silinmez; önce Döviz Al / Sat ekranından gerekçesiyle iptal edin.`);
  if (!deleted && !(await hasCard(c, p.isim))) throw new HttpError(404, 'Cari bulunamadı.');
  stmts.push({ sql: `DELETE FROM cari_kartlari WHERE anahtar = ?`, args: [key] });
  await tx(c.env.DB, stmts);
  await log(c, 'delete', 'cari', null, `Cari ve bağlı ${deleted} kayıt silindi: ${p.isim}`);
  return c.json(ok({ isim: p.isim, silinen: deleted }, 'Cari ve bağlı kayıtlar silindi.'));
});

/* ------------------------------------------------------------------ */
/* Gider                                                               */
/* ------------------------------------------------------------------ */

api.get('/giderler', async (c) => c.json(ok(await withKasa(c, 'gider', (await ledger(c)).s.giderler))));

/**
 * Gider değerleri: TL girildiyse has = TL / has fiyatı (verilmediyse günün has
 * alış fiyatı). Kâr hesabı has esaslı olduğu için `tutar` her zaman has'tır.
 */
async function giderValues(c: Context<Env>, p: GiderPayload) {
  if (!p.tl_tutar) return { tarih: p.tarih, tutar: num(p.tutar!), tl_tutar: null, has_fiyati: null, kategori: p.kategori, notlar: p.notlar };
  let fiyat = p.has_fiyati;
  if (!fiyat) {
    const current = (await currentPrices(c)).fiyat;
    if (!current?.alis) throw new ValidationError('Has fiyatı bulunamadı. Üst çubuktaki HAS düğmesinden günün fiyatını girin veya gider formuna has fiyatını yazın.');
    fiyat = d(current.alis);
  }
  const has = p.tl_tutar.div(fiyat).q(3);
  if (!has.gt(ZERO)) throw new ValidationError('Gider tutarı has karşılığı için çok küçük.');
  return { tarih: p.tarih, tutar: num(has), tl_tutar: num(p.tl_tutar.q(MONEY_Q)), has_fiyati: num(fiyat.q(MONEY_Q)), kategori: p.kategori, notlar: p.notlar };
}

const giderText = (v: { kategori: string; tutar: number; tl_tutar: number | null }) => `${v.kategori} ${v.tl_tutar ? `${v.tl_tutar} TL = ` : ''}${v.tutar} has`;

api.post('/giderler', async (c) => {
  const b = await body(c);
  const p = parseGider(b, tz(c));
  const v = await giderValues(c, p);
  const kasa = await kasaLink(c, b, 'gider', null, { tarih: v.tarih, cari: '', yon: 'CIKIS', kategori: 'GIDER', aciklama: [v.kategori, v.notlar].filter(Boolean).join(' · ') });
  const [res] = await tx(c.env.DB, [insertStmt('giderler', v), ...kasa]);
  const row = (res.results as Row[])[0];
  await log(c, 'create', 'giderler', row.id, giderText(v));
  return c.json(ok(row));
});

api.put('/giderler/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const b = await body(c);
  const p = parseGider(b, tz(c));
  const v = await giderValues(c, p);
  if (!(await first(c.env.DB, `SELECT id FROM giderler WHERE id = ?`, id))) throw new HttpError(404, 'Gider bulunamadı.');
  const kasa = await kasaLink(c, b, 'gider', id, { tarih: v.tarih, cari: '', yon: 'CIKIS', kategori: 'GIDER', aciklama: [v.kategori, v.notlar].filter(Boolean).join(' · ') });
  const [res] = await tx(c.env.DB, [updateStmt('giderler', id, v), ...kasa]);
  const row = (res.results as Row[])[0];
  await log(c, 'update', 'giderler', id, giderText(v));
  return c.json(ok(row));
});

api.delete('/giderler/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM giderler WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Gider bulunamadı.');
  await log(c, 'delete', 'giderler', id, 'Gider silindi');
  return c.json(ok(null, 'Gider silindi.'));
});

/* ------------------------------------------------------------------ */
/* Özet, dışa aktarma, ayarlar, yedek                                  */
/* ------------------------------------------------------------------ */

api.get('/dashboard', async (c) => c.json(ok((await ledger(c)).dashboard(today(tz(c))))));

api.get('/export', async (c) => {
  const l = await ledger(c);
  return c.json(ok({
    exported_at: new Date().toISOString().slice(0, 19),
    version: '1.0',
    alis: l.s.alis.map((r) => rowDict(r, 'toplam_tutar', purchaseTotal(r))),
    satis: l.s.satis.map((r) => l.saleOut(r)),
    hurda: l.s.hurda.map((r) => l.hurdaOut(r)),
    stok_normal: l.stockItems(),
    stok_hurda: l.hurdaStockItems(),
    cari: l.cariData(),
    dashboard: l.dashboard(today(tz(c))),
    giderler: l.s.giderler,
    ...(await kasaExport(c)),
    // Ham tablolar: bu dosya başka bir bilgisayarda yedek olarak geri yüklenebilir.
    app: 'dunyatek-kuyumcu',
    created_at: new Date().toISOString(),
    tables: await snapshotTables(c.env.DB),
  }));
});

async function kasaExport(c: Context<Env>) {
  const out: Record<string, unknown[]> = {};
  const results = await c.env.DB.batch(KASA_TABLES.map((t) => c.env.DB.prepare(`SELECT * FROM ${t} ORDER BY id`)));
  KASA_TABLES.forEach((t, i) => (out[t] = results[i].results ?? []));
  return out;
}

api.get('/ayarlar', (c) =>
  c.json(ok([
    { baslik: 'Giriş', deger: 'E-posta ve parola ile' },
    { baslik: 'Stok', deger: 'Otomatik hesaplanır' },
    { baslik: 'Hurda', deger: 'Normal stoktan ayrıdır' },
  ]))
);

async function settingsStatus(c: Context<Env>) {
  const db = c.env.DB;
  const freq = await db.prepare(`SELECT value FROM app_meta WHERE key = 'backup_frequency'`).first<{ value: string }>();
  const latest = await latestBackup(db);
  return {
    backup_frequency: freq?.value === 'startup' ? 'startup' : 'daily',
    last_backup: latest?.created_at ?? null,
    ...(c.env.LOCAL
      ? { version: `Masaüstü sürümü ${c.env.LOCAL.version}`, update_info: `Veriler: ${c.env.LOCAL.dataDir}\nYedekler: ${c.env.LOCAL.backupDir}\nYeni sürümü kurmak kayıtlarınızı silmez.` }
      : { version: `Bulut sürümü ${SURUM}`, update_info: 'Güncellemeler sunucuya yüklenir; kayıtlarınız korunur.' }),
  };
}

api.get('/uygulama-ayarlari', async (c) => c.json(ok(await settingsStatus(c))));

api.put('/uygulama-ayarlari', async (c) => {
  const p = parseUiSettings(await body(c));
  await tx(c.env.DB, [{ sql: `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('backup_frequency', ?)`, args: [p.backup_frequency] }]);
  return c.json(ok(await settingsStatus(c)));
});

api.post('/backup', async (c) => {
  const backup = await createBackup(c.env.DB, 'manual');
  await cleanupOldBackups(c.env.DB);
  await log(c, 'backup', 'yedekler', backup.id, backup.name);
  return c.json(ok({ file: backup.name, id: backup.id }, 'Veritabanı yedeği oluşturuldu.'));
});

function requireAdmin(c: Context<Env>, what: string) {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, `${what} yalnızca yönetici yapabilir.`);
}

const backupFile = (row: { name: string; created_at: string; reason: string }, data: unknown) => ({ app: 'dunyatek-kuyumcu', name: row.name, reason: row.reason, ...(data as object), created_at: row.created_at });

/** GET /api/yedekler: sunucudaki yedekler (son 14 gün). */
api.get('/yedekler', async (c) => c.json(ok(await listBackups(c.env.DB))));

/** GET /api/yedekler/son: en son yedeğin tam içeriği (bilgisayardaki klasöre yazmak için). */
api.get('/yedekler/son', async (c) => {
  const row = await latestBackup(c.env.DB, true);
  if (!row) throw new HttpError(404, 'Henüz yedek yok.');
  return c.json(ok(backupFile(row, await loadBackupData(c.env.DB, row))));
});

/** GET /api/yedekler/:id: bir yedeğin tam içeriği (indirme). */
api.get('/yedekler/:id', async (c) => {
  const row = await first<any>(c.env.DB, `SELECT * FROM yedekler WHERE id = ?`, Number(c.req.param('id')));
  if (!row) throw new HttpError(404, 'Yedek bulunamadı.');
  return c.json(ok(backupFile(row, await loadBackupData(c.env.DB, row))));
});

/** POST /api/yedekler/:id/geri-yukle: seçilen sunucu yedeğini geri yükler. */
api.post('/yedekler/:id/geri-yukle', async (c) => {
  requireAdmin(c, 'Geri yüklemeyi');
  const row = await first<any>(c.env.DB, `SELECT * FROM yedekler WHERE id = ?`, Number(c.req.param('id')));
  if (!row) throw new HttpError(404, 'Yedek bulunamadı.');
  const result = await restoreData(c.env.DB, await loadBackupData(c.env.DB, row));
  await log(c, 'restore', 'yedekler', row.id, `${row.name} geri yüklendi`);
  return c.json(ok({ restored_from: row.name, ...result }, `${row.name} geri yüklendi.`));
});

/** POST /api/yedek-dosyadan {name?, tables}: bilgisayardaki yedek dosyasından geri yükler. */
api.post('/yedek-dosyadan', async (c) => {
  requireAdmin(c, 'Geri yüklemeyi');
  const b = await body(c);
  const data = checkBackupData(b);
  const name = typeof b.name === 'string' ? b.name.slice(0, 120) : 'dosya';
  const result = await restoreData(c.env.DB, data);
  await log(c, 'restore', 'yedekler', null, `Bilgisayardaki ${name} dosyasından geri yüklendi`);
  return c.json(ok({ restored_from: name, ...result }, `${name} dosyasından geri yüklendi.`));
});

/** GET /api/ortam: masaüstü sürümde bilgisayardaki yedek klasörünün yeri. */
api.get('/ortam', (c) => c.json(ok({ masaustu: !!c.env.LOCAL, yedek_klasoru: c.env.LOCAL?.backupDir ?? null })));

function localHost(c: Context<Env>) {
  if (!c.env.LOCAL) throw new HttpError(404, 'Bu işlem yalnızca bilgisayara kurulan sürümde var.');
  return c.env.LOCAL;
}

/** GET /api/yerel-yedekler: C:\DUNYATEK_BACKUP içindeki yedek dosyaları. */
api.get('/yerel-yedekler', async (c) => c.json(ok(await localHost(c).listBackupFiles())));

/** POST /api/yerel-yedekler/geri-yukle {name}: klasördeki bir yedek dosyasını geri yükler. */
api.post('/yerel-yedekler/geri-yukle', async (c) => {
  requireAdmin(c, 'Geri yüklemeyi');
  const local = localHost(c);
  const name = String((await body(c)).name ?? '');
  let data;
  try {
    data = JSON.parse(await local.readBackupFile(name));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, `${name} okunamadı; dosya bozuk olabilir.`);
  }
  const result = await restoreData(c.env.DB, checkBackupData(data));
  await log(c, 'restore', 'yedekler', null, `Yedek klasöründeki ${name} dosyasından geri yüklendi`);
  return c.json(ok({ restored_from: name, ...result }, `${name} dosyasından geri yüklendi.`));
});

/** POST /api/yerel-yedekler/klasoru-ac: yedek klasörünü Windows Gezgini'nde açar. */
api.post('/yerel-yedekler/klasoru-ac', (c) => {
  localHost(c).openBackupDir();
  return c.json(ok(null));
});

/** GET /api/yazicilar: bilgisayara kurulu yazıcılar (etiket yazıcısını seçmek için). */
api.get('/yazicilar', async (c) => c.json(ok(await localHost(c).listPrinters())));

/**
 * POST /api/yazici/ham {yazici, veri}: etiket yazıcısına komutları (ZPL) doğrudan
 * gönderir. Tarayıcının yazdırma penceresi ve sayfa boyutu devreye girmez.
 */
api.post('/yazici/ham', async (c) => {
  const local = localHost(c);
  const b = await body(c);
  const yazici = String(b.yazici ?? '').trim();
  const veri = typeof b.veri === 'string' ? b.veri : '';
  if (!yazici) throw new ValidationError('Etiket yazıcısını seçin.');
  if (!veri || veri.length > 2_000_000) throw new ValidationError('Yazdırılacak veri yok.');
  await local.printRaw(yazici, veri);
  return c.json(ok(null, 'Etiketler yazıcıya gönderildi.'));
});

api.post('/restore-latest', async (c) => {
  requireAdmin(c, 'Geri yüklemeyi');
  const result = await restoreLatest(c.env.DB);
  await log(c, 'restore', 'yedekler', null, `${result.restored_from} geri yüklendi`);
  return c.json(ok(result, 'Son yedek başarıyla geri yüklendi.'));
});

/**
 * POST /api/verileri-sifirla {parola}: yönetici parolasıyla tüm işlem verilerini
 * siler. Kullanıcılar, ayarlar, firma bilgileri, kasa hesap tanımları, yedekler ve
 * işlem günlüğü korunur. Silmeden önce otomatik yedek alınır; "Son yedeği geri
 * yükle" ile geri alınabilir.
 */
api.post('/verileri-sifirla', async (c) => {
  const u = c.get('user');
  if (u?.role !== 'admin') throw new HttpError(403, 'Verileri yalnızca yönetici sıfırlayabilir.');
  const b = await body(c);
  const parola = typeof b.parola === 'string' ? b.parola : '';
  const row = await first<{ password_hash: string }>(c.env.DB, `SELECT password_hash FROM users WHERE id = ?`, u.id);
  if (!parola || !row || !(await verifyPassword(parola, row.password_hash))) throw new HttpError(403, 'Yönetici parolası hatalı.');
  const backup = await createBackup(c.env.DB, 'pre_reset');
  const tables = [...[...KASA_TABLES].reverse().filter((t) => t !== 'kasa_hesaplari'), ...[...BUSINESS_TABLES].reverse()];
  // Kayıt numaraları sıfırlanmaz: eski fiş ve etiket barkodları yeni kayıtlarla karışmasın.
  await tx(c.env.DB, tables.map((t) => ({ sql: `DELETE FROM ${t}` })));
  await log(c, 'reset', 'veriler', null, `Tüm işlem verileri sıfırlandı (önce ${backup.name} yedeği alındı)`);
  return c.json(ok({ yedek: backup.name, tablolar: tables }, 'Tüm veriler sıfırlandı. Gerekirse "Son yedeği geri yükle" ile geri alabilirsiniz.'));
});

/* ------------------------------------------------------------------ */
/* Silme                                                               */
/* ------------------------------------------------------------------ */

api.delete('/:table/:id', async (c) => {
  const table = c.req.param('table');
  if (!['alis', 'satis', 'hurda'].includes(table)) throw new HttpError(404, 'Tablo bulunamadı.');
  const id = parseId(c.req.param('id'));
  const l = await ledger(c);
  if (table === 'alis') {
    const linked = l.s.satis.filter((r) => Number(r.purchase_id ?? r.alis_id) === id).length
      + l.s.allocations.filter((a) => a.kind === 'normal' && Number(a.purchase_id) === id).length;
    if (linked) throw new HttpError(400, 'Bu alış kaydına bağlı satış var. Önce ilgili satışı silin.');
  }
  if (table === 'hurda') {
    const row = l.hurda(id);
    if (row && row.islem_turu === 'ALIS') {
      const linked = l.s.hurda.filter((r) => r.islem_turu === 'SATIS' && Number(r.hurda_alis_id) === id).length
        + l.s.allocations.filter((a) => a.kind === 'hurda' && Number(a.purchase_id) === id).length;
      if (linked) throw new HttpError(400, 'Bu hurda alış kaydına bağlı hurda satış var. Önce ilgili hurda satışı silin.');
    }
  }
  const [res] = await tx(c.env.DB, [{ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] }]);
  if (!res.meta.changes) throw new HttpError(404, 'Kayıt bulunamadı.');
  await log(c, 'delete', table, id, 'Kayıt silindi');
  return c.json(ok({ deleted: true }, 'Kayıt silindi.'));
});

export default api;
