/**
 * Kasa API'si: hesaplar ve bakiyeler, elle hareket (gelir/gider/devir),
 * hesaplar arası transfer ve döviz bozdurma, gün sonu sayımı.
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all, first, run, tx, type Stmt } from '../lib/db';
import { d, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { audit } from '../lib/auth';
import {
  ACCOUNT_TYPES,
  CURRENCIES,
  MANUAL_CATEGORIES,
  balances,
  commission,
  date,
  guardNegativeTl,
  intId,
  loadAccounts,
  money,
  positive,
  text,
  type LinkedType,
} from '../lib/kasa';
import { dovizSummary } from './doviz';

const kasa = new Hono<Env>();

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, entityType: string, entityId: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType, entityId, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

function requireAdmin(c: Context<Env>) {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!values.includes(v as T)) throw new ValidationError(`Geçersiz ${label}.`);
  return v as T;
}

/** Kurulumla gelen hesaplar (Nakit TL, Nakit Dolar, Nakit Euro, POS, Banka): ödeme düğmeleri bunlara bağlı, silinmez. */
const DEFAULT_ACCOUNTS = new Set([1, 2, 3, 4, 5]);

function accountOut(r: Record<string, any>) {
  return {
    id: r.id, ad: r.ad, tur: r.tur, para_birimi: r.para_birimi, komisyon_orani: Number(r.komisyon_orani) || 0, aktif: !!r.aktif, sira: r.sira,
    bakiye: money(r.bakiye), devir: money(r.devir), giris: money(r.giris), cikis: money(r.cikis), komisyon: money(r.komisyon),
    beklenen: money(d(r.devir ?? 0).add(d(r.giris ?? 0)).sub(d(r.komisyon ?? 0)).sub(d(r.cikis ?? 0))),
    hareket_sayisi: Number(r.hareket_sayisi) || 0,
    varsayilan: DEFAULT_ACCOUNTS.has(Number(r.id)),
  };
}

/* ------------------------------------------------------------------ */
/* Hesaplar ve özet                                                    */
/* ------------------------------------------------------------------ */

/** GET /api/kasa?tarih= : hesap bakiyeleri ve günün giriş/çıkışları. */
kasa.get('/', async (c) => {
  const day = date(c.req.query('tarih'), today(tz(c)));
  const rows = (await balances(c.env.DB, day)).map(accountOut);
  const active = rows.filter((r) => r.aktif || r.bakiye !== 0);
  const sum = (key: 'bakiye' | 'giris' | 'cikis', cur: string) => money(active.filter((r) => r.para_birimi === cur).reduce((t, r) => t.add(d(r[key])), d(0)));
  const toplamlar = Object.fromEntries(CURRENCIES.map((cur) => [cur, { bakiye: sum('bakiye', cur), giris: sum('giris', cur), cikis: sum('cikis', cur) }]));
  const kapanis = await first(c.env.DB, `SELECT COUNT(*) AS n FROM gun_sonu WHERE tarih = ?`, day);
  return c.json(ok({ tarih: day, hesaplar: active, toplamlar, gun_sonu_kapali: Number(kapanis?.n) > 0 }));
});

kasa.get('/hesaplar', async (c) => c.json(ok((await balances(c.env.DB, today(tz(c)))).map(accountOut))));

function parseAccount(b: Record<string, unknown>) {
  const ad = text(b.ad, 60);
  if (!ad) throw new ValidationError('Hesap adı zorunlu.');
  const oran = b.komisyon_orani === undefined || b.komisyon_orani === '' ? d(0) : d(b.komisyon_orani as any);
  if (oran.lt(0) || oran.gt(100)) throw new ValidationError('Komisyon oranı 0 ile 100 arasında olmalıdır.');
  return { ad, komisyon_orani: oran.toNumber() };
}

kasa.post('/hesaplar', async (c) => {
  requireAdmin(c);
  const b = await body(c);
  const { ad, komisyon_orani } = parseAccount(b);
  const tur = oneOf(b.tur, ACCOUNT_TYPES, 'hesap türü');
  const para_birimi = oneOf(b.para_birimi ?? 'TRY', CURRENCIES, 'para birimi');
  if (await first(c.env.DB, `SELECT id FROM kasa_hesaplari WHERE lower(ad) = lower(?)`, ad)) throw new ValidationError('Bu adla bir hesap zaten var.');
  const [res] = await tx(c.env.DB, [{
    sql: `INSERT INTO kasa_hesaplari (ad, tur, para_birimi, komisyon_orani, sira) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sira), 0) + 1 FROM kasa_hesaplari)) RETURNING *`,
    args: [ad, tur, para_birimi, komisyon_orani],
  }]);
  const row = (res.results as any[])[0];
  await log(c, 'create', 'kasa_hesaplari', row.id, `${ad} (${tur}, ${para_birimi})`);
  return c.json(ok(accountOut(row), 'Hesap eklendi.'), 201);
});

kasa.put('/hesaplar/:id', async (c) => {
  requireAdmin(c);
  const id = intId(c.req.param('id'), 'Hesap');
  const b = await body(c);
  const current = await first(c.env.DB, `SELECT * FROM kasa_hesaplari WHERE id = ?`, id);
  if (!current) throw new HttpError(404, 'Hesap bulunamadı.');
  const { ad, komisyon_orani } = parseAccount({ ad: b.ad ?? current.ad, komisyon_orani: b.komisyon_orani ?? current.komisyon_orani });
  const aktif = b.aktif === undefined ? current.aktif : b.aktif ? 1 : 0;
  if (await first(c.env.DB, `SELECT id FROM kasa_hesaplari WHERE lower(ad) = lower(?) AND id != ?`, ad, id)) throw new ValidationError('Bu adla bir hesap zaten var.');
  const [res] = await tx(c.env.DB, [{ sql: `UPDATE kasa_hesaplari SET ad = ?, komisyon_orani = ?, aktif = ? WHERE id = ? RETURNING *`, args: [ad, komisyon_orani, aktif, id] }]);
  await log(c, 'update', 'kasa_hesaplari', id, `${ad}, komisyon %${komisyon_orani}, ${aktif ? 'aktif' : 'pasif'}`);
  return c.json(ok(accountOut((res.results as any[])[0]), 'Hesap güncellendi.'));
});

/** Sonradan eklenen, hiç hareketi ve gün sonu sayımı olmayan hesap silinir; diğerleri yalnızca pasif yapılır. */
kasa.delete('/hesaplar/:id', async (c) => {
  requireAdmin(c);
  const id = intId(c.req.param('id'), 'Hesap');
  const current = await first(c.env.DB, `SELECT * FROM kasa_hesaplari WHERE id = ?`, id);
  if (!current) throw new HttpError(404, 'Hesap bulunamadı.');
  if (DEFAULT_ACCOUNTS.has(id)) throw new ValidationError(`${current.ad} programın varsayılan hesabıdır; silinemez, pasif yapabilirsiniz.`);
  const used = await first<{ n: number }>(c.env.DB,
    `SELECT (SELECT COUNT(*) FROM kasa_hareketleri WHERE hesap_id = ?1) + (SELECT COUNT(*) FROM gun_sonu WHERE hesap_id = ?1) AS n`, id);
  if (Number(used?.n) > 0) throw new ValidationError(`${current.ad} hesabında hareket var; silinemez, pasif yapabilirsiniz.`);
  await run(c.env.DB, `DELETE FROM kasa_hesaplari WHERE id = ?`, id);
  await log(c, 'delete', 'kasa_hesaplari', id, `${current.ad} (${current.tur}, ${current.para_birimi})`);
  return c.json(ok(null, 'Hesap silindi.'));
});

/* ------------------------------------------------------------------ */
/* Hareketler                                                          */
/* ------------------------------------------------------------------ */

const LINK_LABELS: Record<LinkedType, string> = { alis: 'Alış', satis: 'Satış', hurda: 'Hurda', cari_odeme: 'Cari ödeme', siparis: 'Sipariş', siparis_teslim: 'Sipariş', metal: 'Gümüş / Bakır', gider: 'Gider', doviz: 'Döviz' };

/** GET /api/kasa/hareketler?baslangic=&bitis=&hesap_id= */
kasa.get('/hareketler', async (c) => {
  const end = date(c.req.query('bitis'), today(tz(c)));
  const start = date(c.req.query('baslangic'), end);
  if (start > end) throw new ValidationError('Başlangıç tarihi bitişten sonra olamaz.');
  const hesap = c.req.query('hesap_id');
  const args: unknown[] = [start, end];
  let filter = '';
  if (hesap) {
    filter = 'AND k.hesap_id = ?';
    args.push(intId(hesap, 'Hesap'));
  }
  const rows = await all(
    c.env.DB,
    `SELECT k.*, h.ad AS hesap, h.para_birimi, h.tur AS hesap_turu
       FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
      WHERE k.tarih BETWEEN ? AND ? ${filter}
      ORDER BY k.tarih DESC, k.id DESC LIMIT 2000`,
    ...args
  );
  return c.json(ok(rows.map((r) => ({
    ...r,
    tutar: money(r.tutar),
    komisyon: money(r.komisyon),
    net: money(r.yon === 'GIRIS' ? d(r.tutar).sub(d(r.komisyon)) : d(r.tutar).neg()),
    kaynak: r.bagli_tur ? LINK_LABELS[r.bagli_tur as LinkedType] ?? r.bagli_tur : r.grup ? (r.kategori === 'DOVIZ' ? 'Döviz' : 'Transfer') : 'Elle',
    duzenlenebilir: !r.bagli_tur && !r.grup,
  }))));
});

/** Bir kayda bağlı hareketler (fiş yazdırma ve form düzenleme için). */
kasa.get('/bagli', async (c) => {
  const tur = oneOf(c.req.query('tur'), ['ALIS', 'SATIS', 'HURDA', 'CARI_ODEME', 'SIPARIS', 'SIPARIS_TESLIM'] as const, 'kayıt türü').toLowerCase();
  const id = intId(c.req.query('id'), 'Kayıt');
  const rows = await all(
    c.env.DB,
    `SELECT k.hesap_id, k.tutar, k.komisyon, k.kur, h.ad AS hesap, h.para_birimi FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
      WHERE k.bagli_tur = ? AND k.bagli_id = ? ORDER BY k.id`,
    tur,
    id
  );
  return c.json(ok(rows.map((r) => ({ ...r, tutar: money(r.tutar), komisyon: money(r.komisyon) }))));
});

async function parseManual(c: Context<Env>, b: Record<string, unknown>) {
  const accounts = await loadAccounts(c.env.DB);
  const hesap_id = intId(b.hesap_id, 'Kasa hesabı');
  const account = accounts.get(hesap_id);
  if (!account) throw new ValidationError('Kasa hesabı bulunamadı.');
  if (!account.aktif) throw new ValidationError(`${account.ad} hesabı kullanımda değil.`);
  const kategori = oneOf(b.kategori ?? 'DIGER', MANUAL_CATEGORIES, 'hareket türü');
  const yon = kategori === 'GELIR' ? 'GIRIS' : kategori === 'GIDER' ? 'CIKIS' : oneOf(b.yon, ['GIRIS', 'CIKIS'] as const, 'yön');
  const tutar = positive(b.tutar, 'Tutar');
  return {
    account,
    values: {
      tarih: date(b.tarih, today(tz(c))), hesap_id, yon, tutar: tutar.q(MONEY_Q).toNumber(), komisyon: 0, kategori,
      cari: text(b.cari, 120), aciklama: text(b.aciklama, 300), kullanici: c.get('user')?.name ?? null,
    },
  };
}

kasa.post('/hareket', async (c) => {
  const b = await body(c);
  const { account, values } = await parseManual(c, b);
  if (values.yon === 'CIKIS') await guardNegativeTl(c.env.DB, b, new Map([[account.id, account]]), [{ hesap_id: account.id, tutar: d(values.tutar) }]);
  const cols = Object.keys(values);
  const [res] = await tx(c.env.DB, [{ sql: `INSERT INTO kasa_hareketleri (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`, args: Object.values(values) }]);
  const row = (res.results as any[])[0];
  await log(c, 'create', 'kasa_hareketleri', row.id, `${account.ad} ${values.yon} ${values.tutar} ${account.para_birimi} (${values.kategori})`);
  return c.json(ok(row, 'Kasa hareketi kaydedildi.'), 201);
});

async function editableMovement(c: Context<Env>, id: number) {
  const row = await first(c.env.DB, `SELECT * FROM kasa_hareketleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kasa hareketi bulunamadı.');
  if (row.bagli_tur) throw new HttpError(400, `Bu hareket bir ${LINK_LABELS[row.bagli_tur as LinkedType] ?? 'kayıt'} kaydına bağlı; o kaydı düzenleyin.`);
  return row;
}

kasa.put('/hareket/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Hareket');
  const row = await editableMovement(c, id);
  if (row.grup) throw new HttpError(400, 'Transfer hareketi düzenlenemez; silip yeniden girin.');
  const { account, values } = await parseManual(c, await body(c));
  const cols = Object.keys(values).filter((k) => k !== 'kullanici');
  await tx(c.env.DB, [{ sql: `UPDATE kasa_hareketleri SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, args: [...cols.map((k) => (values as any)[k]), id] }]);
  await log(c, 'update', 'kasa_hareketleri', id, `${account.ad} ${values.yon} ${values.tutar} ${account.para_birimi} (${values.kategori})`);
  return c.json(ok({ id }, 'Kasa hareketi güncellendi.'));
});

kasa.delete('/hareket/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Hareket');
  const row = await editableMovement(c, id);
  const stmts: Stmt[] = row.grup
    ? [{ sql: `DELETE FROM kasa_hareketleri WHERE grup = ?`, args: [row.grup] }]
    : [{ sql: `DELETE FROM kasa_hareketleri WHERE id = ?`, args: [id] }];
  await tx(c.env.DB, stmts);
  await log(c, 'delete', 'kasa_hareketleri', id, row.grup ? 'Transfer silindi' : 'Kasa hareketi silindi');
  return c.json(ok({ id }, row.grup ? 'Transfer silindi.' : 'Kasa hareketi silindi.'));
});

/**
 * POST /api/kasa/transfer: bir hesaptan diğerine para aktarımı.
 * Para birimleri farklıysa döviz bozdurmadır; `hedef_tutar` zorunludur ve
 * kur (1 döviz = ? TL) hareketlere yazılır.
 */
kasa.post('/transfer', async (c) => {
  const b = await body(c);
  const accounts = await loadAccounts(c.env.DB);
  const from = accounts.get(intId(b.kaynak_id, 'Çıkış hesabı'));
  const to = accounts.get(intId(b.hedef_id, 'Giriş hesabı'));
  if (!from || !to) throw new ValidationError('Kasa hesabı bulunamadı.');
  if (from.id === to.id) throw new ValidationError('Çıkış ve giriş hesabı aynı olamaz.');
  if (!from.aktif || !to.aktif) throw new ValidationError('Pasif hesapla transfer yapılamaz.');
  const tutar = positive(b.tutar, 'Tutar').q(MONEY_Q);
  const fx = from.para_birimi !== to.para_birimi;
  const hedef = fx ? positive(b.hedef_tutar, 'Karşılık tutarı').q(MONEY_Q) : tutar;
  // Kur her zaman dövizin TL karşılığıdır (çapraz kurda çıkış birimi esas alınır).
  const kur = !fx ? null : from.para_birimi === 'TRY' ? tutar.div(hedef) : hedef.div(tutar);
  await guardNegativeTl(c.env.DB, b, accounts, [{ hesap_id: from.id, tutar }]);
  const kategori = fx ? 'DOVIZ' : 'TRANSFER';
  const tarih = date(b.tarih, today(tz(c)));
  const aciklama = text(b.aciklama, 300) || (fx ? `${from.para_birimi} → ${to.para_birimi}` : `${from.ad} → ${to.ad}`);
  const cari = text(b.cari, 120);
  const grup = crypto.randomUUID();
  const kullanici = c.get('user')?.name ?? null;
  const insert = `INSERT INTO kasa_hareketleri (tarih, hesap_id, yon, tutar, komisyon, kur, kategori, cari, aciklama, grup, kullanici) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const kurValue = kur ? kur.q(4).toNumber() : null;
  await tx(c.env.DB, [
    { sql: insert, args: [tarih, from.id, 'CIKIS', tutar.toNumber(), 0, from.para_birimi === 'TRY' ? null : kurValue, kategori, cari, aciklama, grup, kullanici] },
    { sql: insert, args: [tarih, to.id, 'GIRIS', hedef.toNumber(), commission(to, 'GIRIS', hedef).toNumber(), to.para_birimi === 'TRY' ? null : kurValue, kategori, cari, aciklama, grup, kullanici] },
  ]);
  await log(c, 'create', 'kasa_hareketleri', null, `${kategori}: ${tutar} ${from.para_birimi} (${from.ad}) → ${hedef} ${to.para_birimi} (${to.ad})`);
  return c.json(ok({ grup, kur: kurValue }, fx ? 'Döviz işlemi kaydedildi.' : 'Transfer kaydedildi.'), 201);
});

/* ------------------------------------------------------------------ */
/* Gün sonu                                                            */
/* ------------------------------------------------------------------ */

async function dayEnd(c: Context<Env>, day: string) {
  const rows = (await balances(c.env.DB, day)).map(accountOut);
  const closed = await all(c.env.DB, `SELECT * FROM gun_sonu WHERE tarih = ?`, day);
  const byAccount = new Map(closed.map((r) => [Number(r.hesap_id), r]));
  const hesaplar = rows
    .filter((r) => r.aktif || r.devir !== 0 || r.giris !== 0 || r.cikis !== 0 || byAccount.has(r.id))
    .map((r) => {
      const k = byAccount.get(r.id);
      return {
        hesap_id: r.id, ad: r.ad, tur: r.tur, para_birimi: r.para_birimi,
        devir: r.devir, giris: r.giris, cikis: r.cikis, komisyon: r.komisyon, beklenen: r.beklenen,
        sayilan: k ? money(k.sayilan) : null,
        fark: k ? money(k.fark) : null,
        kapanis_beklenen: k ? money(k.beklenen) : null,
        // Kapanıştan sonra o güne hareket girildiyse uyarı gösterilir.
        degisti: k ? money(k.beklenen) !== r.beklenen : false,
      };
    });
  const head = closed[0];
  return {
    tarih: day,
    kapali: closed.length > 0,
    kapanis: head ? { kullanici: head.kullanici, zaman: head.created_at, notlar: head.notlar } : null,
    hesaplar,
    doviz: await dovizSummary(c.env.DB, day, day),
  };
}

/** GET /api/kasa/komisyon?baslangic&bitis: TL hesaplarında bankanın kestiği POS komisyonu toplamı. */
kasa.get('/komisyon', async (c) => {
  const end = date(c.req.query('bitis'), today(tz(c)));
  const start = date(c.req.query('baslangic'), end);
  const r = await first<{ t: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(k.komisyon), 0) AS t FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
      WHERE h.para_birimi = 'TRY' AND k.tarih BETWEEN ? AND ?`,
    start,
    end
  );
  return c.json(ok({ baslangic: start, bitis: end, komisyon_tl: money(r?.t ?? 0) }));
});

kasa.get('/gun-sonu', async (c) => c.json(ok(await dayEnd(c, date(c.req.query('tarih'), today(tz(c)))))));

/** POST /api/kasa/gun-sonu {tarih, sayimlar: [{hesap_id, sayilan}], notlar}: sayımı kaydeder (tekrar kapatılırsa günceller). */
kasa.post('/gun-sonu', async (c) => {
  const b = await body(c);
  const day = date(b.tarih, today(tz(c)));
  if (!Array.isArray(b.sayimlar) || !b.sayimlar.length) throw new ValidationError('En az bir hesabın sayımını girin.');
  const current = await dayEnd(c, day);
  const byId = new Map(current.hesaplar.map((h) => [h.hesap_id, h]));
  const notlar = text(b.notlar, 500);
  const kullanici = c.get('user')?.name ?? null;
  const stmts: Stmt[] = [];
  const seen = new Set<number>();
  for (const raw of b.sayimlar as Record<string, unknown>[]) {
    const id = intId(raw?.hesap_id, 'Kasa hesabı');
    const h = byId.get(id);
    if (!h) throw new ValidationError('Kasa hesabı bulunamadı.');
    if (seen.has(id)) continue;
    seen.add(id);
    let sayilan;
    try {
      sayilan = d(raw.sayilan as any);
    } catch {
      throw new ValidationError(`${h.ad} sayımı geçerli bir sayı olmalıdır.`);
    }
    if (sayilan.lt(0)) throw new ValidationError(`${h.ad} sayımı negatif olamaz.`);
    const fark = sayilan.sub(d(h.beklenen)).q(MONEY_Q);
    stmts.push({
      sql: `INSERT INTO gun_sonu (tarih, hesap_id, beklenen, sayilan, fark, notlar, kullanici) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tarih, hesap_id) DO UPDATE SET beklenen = excluded.beklenen, sayilan = excluded.sayilan, fark = excluded.fark,
              notlar = excluded.notlar, kullanici = excluded.kullanici, created_at = datetime('now')`,
      args: [day, id, h.beklenen, sayilan.q(MONEY_Q).toNumber(), fark.toNumber(), notlar, kullanici],
    });
  }
  await tx(c.env.DB, stmts);
  await log(c, 'create', 'gun_sonu', null, `${day} gün sonu kapatıldı`);
  return c.json(ok(await dayEnd(c, day), 'Gün sonu kaydedildi.'));
});

export default kasa;
