/**
 * Döviz alış / satış. Kasa tek kaynaktır:
 *
 *   AL  : müşteriden döviz alınır -> döviz Nakit Dolar/Euro hesabına GİRİŞ,
 *         karşılığı TL (nakit, POS, havale) kasadan ÇIKIŞ.
 *   SAT : müşteriye döviz verilir -> döviz hesabından ÇIKIŞ, TL GİRİŞ.
 *   TAHSILAT / ODEME : cariye kalan döviz borcunun kapatılması
 *         (döviz veya o günün kuruyla TL olarak).
 *
 * Hareketler kayda bağlıdır (bagli_tur = 'doviz'). Döviz stoku nakit döviz
 * hesaplarının bakiyesidir. Ödenmeyen kısım cariye döviz olarak geçer: kur
 * değişse de aynı miktar; kasaya giren kısım cariye ayrıca yazılmaz.
 *
 * Kayıt silinmez: iptalde bağlı her hareketin tersi yazılır (DOVIZ_IPTAL) ve
 * kayıt cari, kâr ve maliyet hesabından çıkar. Tutar, kur veya kişi
 * değiştirilemez; yanlış işlem iptal edilip yeniden girilir.
 *
 * Kâr: hareketli ağırlıklı ortalama maliyet. Kasaya kurla giren her döviz
 * (döviz alışı, dövizle ödenen altın satışı, bozdurma) ortalamayı günceller;
 * çıkış ortalamayı değiştirmez, eldeki miktarı azaltır. Satış kârı =
 * satış TL'si - miktar x satış anındaki ortalama.
 */

import { Hono, type Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../lib/db';
import { all, first, tx, type Stmt } from '../lib/db';
import { d, Dec, MONEY_Q } from '../lib/decimal';
import { HttpError, ValidationError, today } from '../lib/validate';
import { audit } from '../lib/auth';
import { checkItems, commission, date, guardNegativeTl, intId, loadAccounts, money, parseKasaItems, positive, text, type Account, type KasaItem } from '../lib/kasa';
import { normalizeText, personName } from '../lib/text';

const doviz = new Hono<Env>();

export const DOVIZ_TYPES = ['USD', 'EUR', 'GBP'] as const;
export const DOVIZ_NAME: Record<string, string> = { USD: 'Dolar', EUR: 'Euro', GBP: 'Sterlin' };
const ISLEM = ['AL', 'SAT', 'TAHSILAT', 'ODEME'] as const;
type Islem = (typeof ISLEM)[number];
const ISLEM_TEXT: Record<Islem, string> = { AL: 'alış', SAT: 'satış', TAHSILAT: 'tahsilat', ODEME: 'ödeme' };
const KATEGORI: Record<Islem, string> = { AL: 'DOVIZ_ALIS', SAT: 'DOVIZ_SATIS', TAHSILAT: 'DOVIZ_TAHSILAT', ODEME: 'DOVIZ_ODEME' };
/** Kasaya bize gelen paranın yönü (döviz bacağı tersidir). */
const PAY_YON: Record<Islem, 'GIRIS' | 'CIKIS'> = { AL: 'CIKIS', SAT: 'GIRIS', TAHSILAT: 'GIRIS', ODEME: 'CIKIS' };
const KUR_Q = 4;
const EPS = d('0.005');

const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';
const isTrade = (islem: string) => islem === 'AL' || islem === 'SAT';

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Geçersiz istek gövdesi.');
  return value as Record<string, unknown>;
}

function log(c: Context<Env>, action: string, id: number | null, description: string) {
  const u = c.get('user');
  return audit(c.env.DB, { userId: u?.id, userName: u?.name, action, entityType: 'doviz_islemleri', entityId: id, description, ip: c.req.header('cf-connecting-ip') ?? null });
}

type Row = Record<string, any>;

function parse(c: Context<Env>, b: Record<string, unknown>) {
  const islem = String(b.islem ?? '').trim().toUpperCase() as Islem;
  if (!ISLEM.includes(islem)) throw new ValidationError('İşlem türü alış, satış, tahsilat veya ödeme olmalı.');
  const cur = String(b.doviz ?? '').trim().toUpperCase();
  if (!(DOVIZ_TYPES as readonly string[]).includes(cur)) throw new ValidationError('Döviz dolar, euro veya sterlin olmalı.');
  const miktar = positive(b.miktar, 'Döviz miktarı').q(MONEY_Q);
  const kur = positive(b.kur, 'Kur').q(KUR_Q);
  const kisi = personName(text(b.kisi, 120));
  if (!isTrade(islem) && !kisi) throw new ValidationError('Cari (kişi / firma) seçin.');
  const key = text(b.islem_anahtari, 64);
  return {
    tarih: date(b.tarih, today(tz(c))),
    islem,
    doviz: cur,
    miktar: miktar.toNumber(),
    kur: kur.toNumber(),
    tutar_tl: miktar.mul(kur).q(MONEY_Q).toNumber(),
    kisi,
    telefon: text(b.telefon, 40),
    kimlik_no: text(b.kimlik_no, 40),
    notlar: text(b.notlar, 500),
    islem_anahtari: key || crypto.randomUUID(),
  };
}
type Values = ReturnType<typeof parse>;

/** Dövizin tutulduğu nakit hesap: seçilen ya da o para biriminin ilk aktif nakit hesabı. */
function cashAccount(accounts: Map<number, Account>, cur: string, wanted: unknown): Account {
  if (wanted !== undefined && wanted !== null && wanted !== '') {
    const a = accounts.get(intId(wanted, 'Döviz kasası'));
    if (!a || a.para_birimi !== cur) throw new ValidationError(`Döviz kasası ${DOVIZ_NAME[cur].toLocaleLowerCase('tr-TR')} hesabı olmalı.`);
    if (!a.aktif) throw new ValidationError(`${a.ad} hesabı kullanımda değil.`);
    return a;
  }
  const list = [...accounts.values()].filter((a) => a.aktif && a.para_birimi === cur);
  const a = list.find((x) => x.tur === 'NAKIT') ?? list[0];
  if (!a) throw new ValidationError(`Aktif ${DOVIZ_NAME[cur].toLocaleLowerCase('tr-TR')} kasası yok. Kasa > Hesaplar bölümünden ekleyin.`);
  return a;
}

/** Ödeme satırının TL karşılığı. */
function itemTL(item: KasaItem, account: Account): Dec {
  if (account.para_birimi === 'TRY') return item.tutar;
  if (!item.kur) throw new ValidationError(`${account.ad} için TL kurunu girin.`);
  return item.tutar.mul(item.kur);
}

/** Ödemelerin döviz karşılığı (aynı dövizle ödenen kısım kursuz sayılır). */
function paidInDoviz(v: Values, items: KasaItem[], accounts: Map<number, Account>): Dec {
  return items.reduce((t, item) => {
    const account = accounts.get(item.hesap_id)!;
    return t.add(account.para_birimi === v.doviz ? item.tutar : itemTL(item, account).div(d(v.kur)));
  }, d(0));
}

const BALANCE_SQL = `SELECT COALESCE(SUM(CASE WHEN yon = 'GIRIS' THEN tutar - komisyon ELSE -tutar END), 0) FROM kasa_hareketleri WHERE hesap_id = ?`;

async function accountBalance(db: D1Database, hesapId: number) {
  const r = await first<{ b: number }>(db, `SELECT (${BALANCE_SQL}) AS b`, hesapId);
  return d(r?.b ?? 0);
}

function insufficient(hesap: Account, bakiye: Dec, cur: string) {
  return new ValidationError(`${hesap.ad} kasasında yeterli döviz yok (bakiye ${money(bakiye).toLocaleString('tr-TR')} ${cur}). Elinizdeki dövizi önce Kasa > Gelir / Gider ile "Devir / açılış" olarak girin.`);
}

/**
 * Kayıt ve bağlı kasa hareketleri tek toplu işlemde yazılır. Hareketler kayda
 * işlem anahtarıyla bağlanır; satışta kayıt yalnızca kasada yeterli döviz
 * varsa eklenir (aynı anda iki satış kasayı eksiye düşüremez), kayıt
 * eklenmezse hareketler de eklenmez.
 */
function writeStmts(c: Context<Env>, v: Values, items: KasaItem[], accounts: Map<number, Account>, hesap: Account): { stmts: Stmt[]; kalan: number } {
  checkItems(items, accounts);
  const trade = isTrade(v.islem);
  if (trade && items.some((i) => accounts.get(i.hesap_id)!.para_birimi === v.doviz)) {
    throw new ValidationError(`${DOVIZ_NAME[v.doviz]} karşılığı aynı dövizle ödenemez; TL kasası, POS veya banka seçin.`);
  }
  if (!trade && !items.length) throw new ValidationError('Tahsilat / ödemenin hangi kasaya girdiğini seçin.');
  const paid = paidInDoviz(v, items, accounts);
  let kalan = d(0);
  if (trade) {
    kalan = d(v.miktar).sub(paid);
    if (kalan.lt(EPS.neg())) throw new ValidationError(`Ödeme işlem tutarını (${money(v.tutar_tl).toLocaleString('tr-TR')} TL) aşıyor.`);
    if (kalan.abs().lt(EPS)) kalan = d(0);
    if (kalan.gt(0) && !v.kisi) throw new ValidationError('Tamamı ödenmeyen işlem cariye yazılır; kişi / firma adını girin.');
  }
  const kullanici = c.get('user')?.name ?? null;
  const values = { ...v, kalan: kalan.q(MONEY_Q).toNumber(), kullanici };
  const cols = Object.keys(values);
  const guard = v.islem === 'SAT' ? `WHERE (${BALANCE_SQL}) >= ? - 0.005` : '';
  const stmts: Stmt[] = [{
    sql: `INSERT INTO doviz_islemleri (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')} ${guard} RETURNING *`,
    args: [...Object.values(values), ...(v.islem === 'SAT' ? [hesap.id, v.miktar] : [])],
  }];
  const ref = `(SELECT id FROM doviz_islemleri WHERE islem_anahtari = ?)`;
  const aciklama = `${DOVIZ_NAME[v.doviz]} ${ISLEM_TEXT[v.islem]} ${v.miktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${v.doviz}`;
  const insert = (account: Account, yon: 'GIRIS' | 'CIKIS', tutar: Dec, kur: number | null): Stmt => ({
    sql: `INSERT INTO kasa_hareketleri (tarih, hesap_id, yon, tutar, komisyon, kur, kategori, cari, aciklama, bagli_tur, bagli_id, kullanici)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'doviz', ${ref}, ? WHERE ${ref} IS NOT NULL`,
    args: [v.tarih, account.id, yon, tutar.q(MONEY_Q).toNumber(), commission(account, yon, tutar).toNumber(), kur, KATEGORI[v.islem], v.kisi, aciklama,
      v.islem_anahtari, kullanici, v.islem_anahtari],
  });
  // Döviz bacağı: dövizin tamamı kasaya girer / çıkar; kuru maliyet hesabında kullanılır.
  if (trade) stmts.push(insert(hesap, v.islem === 'AL' ? 'GIRIS' : 'CIKIS', d(v.miktar), v.kur));
  for (const item of items) {
    const account = accounts.get(item.hesap_id)!;
    const kur = account.para_birimi === 'TRY' ? null : account.para_birimi === v.doviz ? (item.kur ? item.kur.toNumber() : v.kur) : item.kur!.toNumber();
    stmts.push(insert(account, PAY_YON[v.islem], item.tutar, kur));
  }
  return { stmts, kalan: values.kalan };
}

/* ------------------------------------------------------------------ */
/* Hesaplar: maliyet, kâr, stok, cari                                  */
/* ------------------------------------------------------------------ */

type Pool = { qty: Dec; cost: Dec };
const avgOf = (p: Pool | undefined) => (p && p.qty.gt(0) ? p.cost.div(p.qty) : d(0));

/**
 * Hareketli ağırlıklı ortalama maliyet: döviz hesaplarının hareketleri tarih
 * sırasıyla işlenir. Kurlu giriş havuza eklenir; çıkış havuzu ortalamadan
 * azaltır. Kursuz giriş (elle devir) maliyeti bilinmediği için havuza
 * girmez. Hesaplar arası transfer ve iptal edilmiş döviz işlemleri sayılmaz.
 * Dönen: satış kaydı -> satış anındaki ortalama, para birimi -> son havuz.
 */
async function costTimeline(db: D1Database) {
  const rows = await all(db,
    `SELECT k.yon, k.tutar, k.kur, k.bagli_tur, k.bagli_id, h.para_birimi, d.islem, d.doviz
       FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
       LEFT JOIN doviz_islemleri d ON k.bagli_tur = 'doviz' AND d.id = k.bagli_id
      WHERE h.para_birimi != 'TRY' AND k.kategori != 'TRANSFER' AND (d.id IS NULL OR d.durum = 'AKTIF')
      ORDER BY k.tarih, k.id`);
  const pools = new Map<string, Pool>();
  const atSale = new Map<number, Dec>();
  for (const r of rows) {
    const cur = String(r.para_birimi);
    const p = pools.get(cur) ?? { qty: d(0), cost: d(0) };
    pools.set(cur, p);
    const tutar = d(r.tutar);
    if (r.yon === 'GIRIS') {
      if (Number(r.kur) > 0) { p.qty = p.qty.add(tutar); p.cost = p.cost.add(tutar.mul(d(r.kur))); }
      continue;
    }
    const avg = avgOf(p);
    if (r.bagli_tur === 'doviz' && r.islem === 'SAT' && r.doviz === cur && !atSale.has(Number(r.bagli_id))) atSale.set(Number(r.bagli_id), avg);
    const out = Dec.min(tutar, p.qty);
    p.cost = p.cost.sub(out.mul(avg));
    p.qty = p.qty.sub(out);
  }
  return { atSale, pools };
}
type Timeline = Awaited<ReturnType<typeof costTimeline>>;

function saleProfit(r: Row, t: Timeline): Dec | null {
  if (r.islem !== 'SAT' || r.durum !== 'AKTIF') return null;
  const avg = t.atSale.get(Number(r.id));
  if (!avg || !avg.gt(0)) return null; // maliyeti bilinmeyen döviz: kâr hesaplanmaz
  return d(r.tutar_tl).sub(d(r.miktar).mul(avg));
}

/** Kişi başına döviz bakiyesi: + bize borçlu, - bizim borcumuz (döviz cinsinden). */
export function cariEffect(r: Row): Dec {
  switch (r.islem) {
    case 'SAT': return d(r.kalan);
    case 'AL': return d(r.kalan).neg();
    case 'TAHSILAT': return d(r.miktar).neg();
    default: return d(r.miktar);
  }
}

export async function dovizCari(db: D1Database) {
  const rows = await all(db, `SELECT tarih, islem, doviz, miktar, kalan, kisi FROM doviz_islemleri WHERE kisi != '' AND durum = 'AKTIF' ORDER BY tarih, id`);
  const people = new Map<string, { isim: string; bakiye: Record<string, Dec>; son_islem_tarihi: string }>();
  for (const r of rows) {
    const key = normalizeText(r.kisi);
    const p = people.get(key) ?? { isim: String(r.kisi), bakiye: {} as Record<string, Dec>, son_islem_tarihi: '' };
    const cur = String(r.doviz);
    p.bakiye[cur] = (p.bakiye[cur] ?? d(0)).add(cariEffect(r));
    if (String(r.tarih) > p.son_islem_tarihi) p.son_islem_tarihi = String(r.tarih);
    people.set(key, p);
  }
  return [...people.entries()].map(([key, p]) => ({
    anahtar: key,
    isim: p.isim,
    son_islem_tarihi: p.son_islem_tarihi,
    bakiye: Object.fromEntries(Object.entries(p.bakiye).map(([cur, v]) => [cur, money(v)]).filter(([, v]) => Math.abs(v as number) >= 0.01)),
  }));
}

/** Döviz hesaplarının bakiyesi (stok), ortalama maliyet ve maliyet değeri. */
async function stockOf(db: D1Database, t: Timeline) {
  const rows = await all(db,
    `SELECT h.id, h.ad, h.tur, h.para_birimi, h.aktif,
            COALESCE(SUM(CASE WHEN k.yon = 'GIRIS' THEN k.tutar - k.komisyon ELSE -k.tutar END), 0) AS bakiye
       FROM kasa_hesaplari h LEFT JOIN kasa_hareketleri k ON k.hesap_id = h.id
      WHERE h.para_birimi != 'TRY' GROUP BY h.id ORDER BY h.sira, h.id`);
  return DOVIZ_TYPES.map((cur) => {
    const accounts = rows.filter((r) => r.para_birimi === cur && (r.aktif || Number(r.bakiye) !== 0));
    const nakit = accounts.filter((r) => r.tur === 'NAKIT').reduce((s, r) => s.add(d(r.bakiye)), d(0));
    const toplam = accounts.reduce((s, r) => s.add(d(r.bakiye)), d(0));
    const avg = avgOf(t.pools.get(cur));
    return {
      doviz: cur, ad: DOVIZ_NAME[cur],
      nakit: money(nakit), toplam: money(toplam),
      hesaplar: accounts.map((r) => ({ id: r.id, ad: r.ad, tur: r.tur, bakiye: money(r.bakiye) })),
      ortalama_maliyet: avg.q(KUR_Q).toNumber(),
      maliyet_tl: money(toplam.gt(0) ? toplam.mul(avg) : d(0)),
    };
  }).filter((s) => s.hesaplar.length);
}

function rowOut(r: Row, kasa: Map<number, Record<string, unknown>[]>, t: Timeline): Row {
  const legs = (kasa.get(Number(r.id)) ?? []).filter((k) => k.kategori !== 'DOVIZ_IPTAL');
  // Döviz bacağı ayrıca gösterilir; ödemeler TL (veya başka döviz) satırlarıdır.
  const dovizBacak = isTrade(r.islem) ? legs.find((k) => k.para_birimi === r.doviz) ?? null : null;
  const odemeler = legs.filter((k) => k !== dovizBacak);
  const kar = saleProfit(r, t);
  return {
    ...r,
    miktar: money(r.miktar), tutar_tl: money(r.tutar_tl), kalan: money(r.kalan),
    doviz_hesap_id: dovizBacak?.hesap_id ?? null, doviz_hesap: dovizBacak?.hesap ?? null,
    kasa_odemeleri: odemeler,
    odenen_tl: money(odemeler.reduce((s: Dec, k) => s.add(d(k.tutar as number).mul(d((k.kur as number) || 1))), d(0))),
    kalan_tl: money(d(r.kalan).mul(d(r.kur))),
    kar_tl: kar === null ? null : money(kar),
  };
}

export type DovizOzet = {
  doviz: string; islem: number; alis_miktar: number; alis_tl: number; satis_miktar: number; satis_tl: number; kar_tl: number; iptal: number;
  transfer_giris: number; transfer_giris_tl: number; transfer_cikis: number; transfer_cikis_tl: number;
};

/**
 * Tarih aralığında para birimine göre döviz alış / satış, kâr ve iptal sayısı.
 * Kasa > Transfer ile bankadan çekilen veya bozdurulan döviz müşteri işlemi
 * değildir; `transfer_giris` / `transfer_cikis` olarak ayrıca verilir.
 */
export async function dovizSummary(db: D1Database, start: string, end: string, t?: Timeline): Promise<DovizOzet[]> {
  const [rows, timeline, transfers] = await Promise.all([
    all(db, `SELECT * FROM doviz_islemleri WHERE tarih BETWEEN ? AND ? AND islem IN ('AL', 'SAT') ORDER BY tarih, id`, start, end),
    t ? Promise.resolve(t) : costTimeline(db),
    all(
      db,
      `SELECT h.para_birimi AS doviz, k.yon, SUM(k.tutar) AS miktar, SUM(k.tutar * COALESCE(k.kur, 0)) AS tl
         FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
        WHERE h.para_birimi != 'TRY' AND k.kategori = 'DOVIZ' AND k.grup IS NOT NULL AND k.tarih BETWEEN ? AND ?
        GROUP BY h.para_birimi, k.yon`,
      start,
      end
    ),
  ]);
  type Acc = { am: Dec; at: Dec; sm: Dec; st: Dec; kar: Dec; n: number; iptal: number; tg: Dec; tgl: Dec; tc: Dec; tcl: Dec };
  const out = new Map<string, Acc>();
  const acc = (cur: string) => {
    const s = out.get(cur) ?? { am: d(0), at: d(0), sm: d(0), st: d(0), kar: d(0), n: 0, iptal: 0, tg: d(0), tgl: d(0), tc: d(0), tcl: d(0) };
    out.set(cur, s);
    return s;
  };
  for (const r of rows) {
    const s = acc(r.doviz);
    if (r.durum !== 'AKTIF') { s.iptal += 1; continue; }
    s.n += 1;
    if (r.islem === 'AL') { s.am = s.am.add(d(r.miktar)); s.at = s.at.add(d(r.tutar_tl)); }
    else { s.sm = s.sm.add(d(r.miktar)); s.st = s.st.add(d(r.tutar_tl)); s.kar = s.kar.add(saleProfit(r, timeline) ?? d(0)); }
  }
  for (const r of transfers) {
    const s = acc(String(r.doviz));
    if (r.yon === 'GIRIS') { s.tg = s.tg.add(d(r.miktar ?? 0)); s.tgl = s.tgl.add(d(r.tl ?? 0)); }
    else { s.tc = s.tc.add(d(r.miktar ?? 0)); s.tcl = s.tcl.add(d(r.tl ?? 0)); }
  }
  return [...out.entries()].map(([cur, s]) => ({
    doviz: cur, islem: s.n, iptal: s.iptal, alis_miktar: money(s.am), alis_tl: money(s.at), satis_miktar: money(s.sm), satis_tl: money(s.st), kar_tl: money(s.kar),
    transfer_giris: money(s.tg), transfer_giris_tl: money(s.tgl), transfer_cikis: money(s.tc), transfer_cikis_tl: money(s.tcl),
  }));
}

async function listData(c: Context<Env>) {
  const [rows, kasa, t] = await Promise.all([
    all(c.env.DB, `SELECT * FROM doviz_islemleri ORDER BY tarih DESC, id DESC`),
    linkedRows(c.env.DB),
    costTimeline(c.env.DB),
  ]);
  const kayitlar = rows.map((r) => rowOut(r, kasa, t));
  const day = today(tz(c));
  const active = kayitlar.filter((r) => r.durum === 'AKTIF');
  const sum = (pred: (r: Row) => boolean, key: string) => money(active.filter(pred).reduce((s, r) => s.add(d(r[key] ?? 0)), d(0)));
  const ozet = {
    toplam_kar_tl: sum((r) => r.islem === 'SAT', 'kar_tl'),
    bugun_kar_tl: sum((r) => r.islem === 'SAT' && r.tarih === day, 'kar_tl'),
    bugun_islem: active.filter((r) => r.tarih === day && isTrade(r.islem)).length,
  };
  return { kayitlar, stok: await stockOf(c.env.DB, t), cari: await dovizCari(c.env.DB), ozet, bugun: await dovizSummary(c.env.DB, day, day, t) };
}

/** Bağlı hareketler, kategorisiyle (iptal ters kayıtları ayrılabilsin). */
async function linkedRows(db: D1Database) {
  const rows = await all(db,
    `SELECT k.id, k.bagli_id, k.hesap_id, k.tutar, k.komisyon, k.kur, k.kategori, h.ad AS hesap, h.para_birimi
       FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id WHERE k.bagli_tur = 'doviz' ORDER BY k.id`);
  const map = new Map<number, Record<string, unknown>[]>();
  for (const r of rows) {
    const item = { hesap_id: r.hesap_id, hesap: r.hesap, para_birimi: r.para_birimi, tutar: money(r.tutar), komisyon: money(r.komisyon), kur: r.kur, kategori: r.kategori };
    const list = map.get(Number(r.bagli_id));
    if (list) list.push(item);
    else map.set(Number(r.bagli_id), [item]);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Uç noktalar                                                         */
/* ------------------------------------------------------------------ */

const describe = (v: Values) => `Döviz ${ISLEM_TEXT[v.islem]}: ${v.kisi || '-'} ${v.miktar} ${v.doviz} @ ${v.kur}`;

doviz.get('/', async (c) => c.json(ok(await listData(c))));

/** GET /api/doviz/ozet?baslangic=&bitis= : rapor, stok ve gün sonu için. */
doviz.get('/ozet', async (c) => {
  const end = date(c.req.query('bitis'), today(tz(c)));
  const start = date(c.req.query('baslangic'), end);
  const t = await costTimeline(c.env.DB);
  return c.json(ok({ baslangic: start, bitis: end, dovizler: await dovizSummary(c.env.DB, start, end, t), stok: await stockOf(c.env.DB, t) }));
});

/** Yeni kayıtta `kasa` hiç gönderilmezse tutarın tamamı nakit TL (tahsilat/ödemede döviz kasası) sayılır. */
function defaultItems(v: Values, accounts: Map<number, Account>, hesap: Account): KasaItem[] {
  if (isTrade(v.islem)) {
    const tl = [...accounts.values()].find((a) => a.aktif && a.tur === 'NAKIT' && a.para_birimi === 'TRY');
    return tl ? [{ hesap_id: tl.id, tutar: d(v.tutar_tl), kur: null }] : [];
  }
  return [{ hesap_id: hesap.id, tutar: d(v.miktar), kur: d(v.kur) }];
}

const byKey = (db: D1Database, key: string) => first(db, `SELECT * FROM doviz_islemleri WHERE islem_anahtari = ?`, key);

doviz.post('/', async (c) => {
  const b = await body(c);
  const v = parse(c, b);
  // Aynı istek ikinci kez geldiyse (çift tıklama, bağlantı tekrarı) ilk kayıt döner.
  const again = await byKey(c.env.DB, v.islem_anahtari);
  if (again) return c.json(ok(again, 'Bu işlem zaten kaydedildi.'));
  const accounts = await loadAccounts(c.env.DB);
  const hesap = cashAccount(accounts, v.doviz, b.doviz_hesap_id);
  if (v.islem === 'SAT') {
    const bakiye = await accountBalance(c.env.DB, hesap.id);
    if (d(v.miktar).gt(bakiye.add(EPS))) throw insufficient(hesap, bakiye, v.doviz);
  }
  const items = parseKasaItems(b.kasa) ?? defaultItems(v, accounts, hesap);
  const { stmts } = writeStmts(c, v, items, accounts, hesap);
  if (v.islem === 'AL' || v.islem === 'ODEME') await guardNegativeTl(c.env.DB, b, accounts, items);
  let res;
  try {
    [res] = await tx(c.env.DB, stmts);
  } catch (error) {
    const existing = await byKey(c.env.DB, v.islem_anahtari);
    if (existing) return c.json(ok(existing, 'Bu işlem zaten kaydedildi.'));
    throw error;
  }
  const row = (res.results as any[])[0];
  if (!row) throw insufficient(hesap, await accountBalance(c.env.DB, hesap.id), v.doviz);
  await log(c, 'create', row.id, describe(v));
  return c.json(ok(row, `Döviz ${ISLEM_TEXT[v.islem]} kaydedildi.`), 201);
});

/** Yalnızca açıklama bilgileri düzeltilir; tutar, kur, döviz ve kişi için iptal edip yeniden girilir. */
doviz.put('/:id', async (c) => {
  const id = intId(c.req.param('id'), 'Kayıt');
  const b = await body(c);
  const row = await first(c.env.DB, `SELECT * FROM doviz_islemleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı.');
  const same = (k: string) => {
    if (b[k] === undefined) return true;
    if (k === 'miktar' || k === 'kur') { try { return d(b[k] as any).eq(d(row[k])); } catch { return false; } }
    if (k === 'kisi') return personName(text(b.kisi, 120)) === row.kisi;
    return String(b[k]).trim().toUpperCase() === String(row[k]).toUpperCase();
  };
  if (b.kasa !== undefined || !['islem', 'doviz', 'miktar', 'kur', 'kisi', 'tarih'].every(same)) {
    throw new ValidationError('Tamamlanan döviz işleminin tutarı, kuru, kişisi veya ödemesi değiştirilemez. İşlemi gerekçesiyle iptal edip yeniden girin.');
  }
  const values = { telefon: text(b.telefon ?? row.telefon, 40), kimlik_no: text(b.kimlik_no ?? row.kimlik_no, 40), notlar: text(b.notlar ?? row.notlar, 500) };
  const [res] = await tx(c.env.DB, [{ sql: `UPDATE doviz_islemleri SET telefon = ?, kimlik_no = ?, notlar = ? WHERE id = ? RETURNING *`, args: [values.telefon, values.kimlik_no, values.notlar, id] }]);
  await log(c, 'update', id, `Döviz kaydı bilgisi düzeltildi (telefon / kimlik / not)`);
  return c.json(ok((res.results as any[])[0], 'Kayıt güncellendi.'));
});

/**
 * POST /api/doviz/:id/iptal {gerekce}: bağlı her kasa hareketinin tersini
 * yazar, kaydı iptal olarak işaretler. Cari, kâr ve maliyet kaydı yok sayar.
 */
doviz.post('/:id/iptal', async (c) => {
  const id = intId(c.req.param('id'), 'Kayıt');
  const b = await body(c);
  const gerekce = text(b.gerekce, 300);
  if (!gerekce) throw new ValidationError('İptal gerekçesini yazın.');
  const row = await first(c.env.DB, `SELECT * FROM doviz_islemleri WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı.');
  if (row.durum === 'IPTAL') throw new ValidationError('Bu işlem zaten iptal edilmiş.');
  const legs = await all(c.env.DB,
    `SELECT k.*, h.ad AS hesap, h.para_birimi FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
      WHERE k.bagli_tur = 'doviz' AND k.bagli_id = ? AND k.kategori != 'DOVIZ_IPTAL' ORDER BY k.id`, id);
  // Kasadan çıkacak döviz kasayı eksiye düşürmesin (ör. satılmış dövizin alışı).
  for (const leg of legs.filter((k) => k.yon === 'GIRIS' && k.para_birimi !== 'TRY')) {
    const bakiye = await accountBalance(c.env.DB, Number(leg.hesap_id));
    const net = d(leg.tutar).sub(d(leg.komisyon));
    if (bakiye.sub(net).lt(EPS.neg())) throw new ValidationError(`${leg.hesap} kasasında yeterli döviz yok (bakiye ${money(bakiye).toLocaleString('tr-TR')} ${leg.para_birimi}); bu dövizden satış yapılmış. Önce o satışı iptal edin.`);
  }
  const tarih = today(tz(c));
  const kullanici = c.get('user')?.name ?? null;
  const stmts: Stmt[] = legs.map((k) => ({
    // Ters kayıt hesabı tam sıfırlar: POS komisyonu düşülmüş girişin tersi net tutar kadar çıkıştır.
    sql: `INSERT INTO kasa_hareketleri (tarih, hesap_id, yon, tutar, komisyon, kur, kategori, cari, aciklama, bagli_tur, bagli_id, kullanici)
          SELECT ?, ?, ?, ?, 0, ?, 'DOVIZ_IPTAL', ?, ?, 'doviz', ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM kasa_hareketleri WHERE bagli_tur = 'doviz' AND bagli_id = ? AND kategori = 'DOVIZ_IPTAL' AND aciklama LIKE ?)`,
    // Aynı iptal iki kez gelirse ters kayıt bir kez yazılır.
    args: [tarih, k.hesap_id, k.yon === 'GIRIS' ? 'CIKIS' : 'GIRIS', money(k.yon === 'GIRIS' ? d(k.tutar).sub(d(k.komisyon)) : d(k.tutar)), k.kur, k.cari,
      `İptal #${id}.${k.id}: ${gerekce}`, id, kullanici, id, `İptal #${id}.${k.id}:%`],
  }));
  stmts.unshift({ sql: `UPDATE doviz_islemleri SET durum = 'IPTAL', iptal_gerekce = ?, iptal_zamani = datetime('now'), iptal_eden = ? WHERE id = ? AND durum = 'AKTIF'`, args: [gerekce, kullanici, id] });
  await tx(c.env.DB, stmts);
  await log(c, 'cancel', id, `Döviz ${ISLEM_TEXT[row.islem as Islem] ?? ''} iptal: ${gerekce}`);
  return c.json(ok({ id }, 'İşlem iptal edildi; kasa hareketleri ters kayıtla geri alındı.'));
});

doviz.delete('/:id', () => {
  throw new HttpError(405, 'Döviz işlemi silinmez; gerekçesiyle iptal edin.');
});

export default doviz;
