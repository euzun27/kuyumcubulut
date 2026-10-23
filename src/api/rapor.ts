/**
 * Raporlar: seçilen tarih aralığında satış, alış, kâr, ürün/müşteri/tedarikçi
 * dağılımı, günlük seyir, gider, kasa, personel ve cari yaşlandırma.
 * Tutarlar Ledger'ın hesapladığı değerlerden toplanır (ekranlarla aynı sonuç).
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../lib/db';
import { all } from '../lib/db';
import { Dec, d, ZERO, HAS_Q, MONEY_Q, NUM_Q } from '../lib/decimal';
import { ValidationError, today } from '../lib/validate';
import { normalizeText, cleanText } from '../lib/text';
import { Ledger, purchaseTotal, saleTotal, scrapTotal, type Row } from '../lib/ledger';
import { loadSnapshot } from '../lib/store';
import { date } from '../lib/kasa';
import { dovizSummary } from './doviz';

const rapor = new Hono<Env>();
const ok = (data: unknown = null, message = '') => ({ status: 'ok', message, data });
const tz = (c: Context<Env>) => c.env.APP_TZ || 'Europe/Istanbul';
const MAX_DAYS = 400;

const money = (v: Dec) => v.q(MONEY_Q).toNumber();
const has = (v: Dec) => v.q(HAS_Q).toNumber();
const gram = (v: Dec) => v.q(NUM_Q).toNumber();

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

type Group = { ad: string; ayar?: string; islem: number; adet: Dec; gram: Dec; has: Dec; tutar: Dec; kar: Dec; milyem_kari: Dec };

function grouper() {
  const map = new Map<string, Group>();
  return {
    add(key: string, ad: string, values: Partial<Record<'adet' | 'gram' | 'has' | 'tutar' | 'kar' | 'milyem_kari', Dec>>, ayar?: string) {
      let g = map.get(key);
      if (!g) {
        g = { ad, ayar, islem: 0, adet: ZERO, gram: ZERO, has: ZERO, tutar: ZERO, kar: ZERO, milyem_kari: ZERO };
        map.set(key, g);
      }
      g.islem += 1;
      for (const [k, v] of Object.entries(values)) (g as any)[k] = (g as any)[k].add(v);
    },
    rows(limit = 1000) {
      return [...map.values()]
        .sort((a, b) => b.tutar.cmp(a.tutar) || b.gram.cmp(a.gram))
        .slice(0, limit)
        .map((g) => ({ ad: g.ad, ...(g.ayar !== undefined ? { ayar: g.ayar } : {}), islem: g.islem, adet: gram(g.adet), gram: gram(g.gram), has: has(g.has), tutar: money(g.tutar), kar: money(g.kar), milyem_kari: has(g.milyem_kari) }));
    },
  };
}

rapor.get('/', async (c) => {
  const end = date(c.req.query('bitis'), today(tz(c)));
  const start = date(c.req.query('baslangic'), end);
  if (start > end) throw new ValidationError('Başlangıç tarihi bitişten sonra olamaz.');
  if (daysBetween(start, end) > MAX_DAYS) throw new ValidationError(`En fazla ${MAX_DAYS} günlük rapor alınabilir.`);
  const inRange = (r: Row) => String(r.tarih) >= start && String(r.tarih) <= end;
  const l = new Ledger(await loadSnapshot(c.env.DB), tz(c));

  const sales = l.s.satis.filter(inRange).map((r) => l.saleOut(r));
  const purchases = l.s.alis.filter(inRange);
  const scrap = l.s.hurda.filter(inRange);
  const scrapSales = scrap.filter((r) => r.islem_turu === 'SATIS');
  const scrapBuys = scrap.filter((r) => r.islem_turu === 'ALIS');
  const expenses = l.s.giderler.filter(inRange);

  const products = grouper();
  const customers = grouper();
  const suppliers = grouper();
  const days = new Map<string, { satis: Dec; alis: Dec; kar: Dec; has: Dec; gram: Dec; alis_has: Dec; milyem: Dec; islem: number }>();
  const day = (t: string) => {
    let v = days.get(t);
    if (!v) days.set(t, (v = { satis: ZERO, alis: ZERO, kar: ZERO, has: ZERO, gram: ZERO, alis_has: ZERO, milyem: ZERO, islem: 0 }));
    return v;
  };
  for (const r of sales) {
    const total = d(r.toplam_tutar);
    const values = { adet: d(r.adet ?? 0), gram: d(r.gram), has: d(r.has), tutar: total, kar: d(r.brut_kar), milyem_kari: d(r.milyem_kari ?? 0) };
    products.add(`${normalizeText(r.cinsi)}\u0000${normalizeText(r.ayar)}`, cleanText(r.cinsi), values, cleanText(r.ayar));
    customers.add(normalizeText(r.musteri), cleanText(r.musteri), values);
    const v = day(r.tarih);
    v.satis = v.satis.add(total);
    v.kar = v.kar.add(d(r.brut_kar));
    v.has = v.has.add(d(r.has));
    v.gram = v.gram.add(d(r.gram));
    v.milyem = v.milyem.add(d(r.milyem_kari ?? 0));
    v.islem += 1;
  }
  for (const r of scrapSales) {
    const v = day(r.tarih);
    v.satis = v.satis.add(scrapTotal(r));
    v.kar = v.kar.add(l.hurdaProfit(r));
  }
  for (const r of purchases) {
    const total = purchaseTotal(r);
    suppliers.add(normalizeText(r.tedarikci), cleanText(r.tedarikci), { adet: d(r.adet ?? 0), gram: d(r.gram), has: d(r.has), tutar: total });
    const v = day(r.tarih);
    v.alis = v.alis.add(total);
    v.alis_has = v.alis_has.add(d(r.has));
  }
  for (const r of scrapBuys) day(r.tarih).alis = day(r.tarih).alis.add(scrapTotal(r));

  const sum = (rows: Row[], f: (r: Row) => Dec) => Dec.sum(rows.map(f));
  const giderByCat = new Map<string, Dec>();
  for (const r of expenses) giderByCat.set(cleanText(r.kategori) || 'Diğer', (giderByCat.get(cleanText(r.kategori) || 'Diğer') ?? ZERO).add(d(r.tutar)));

  // Cari yaşlandırma: açık bakiyeler, son işlemden bu yana geçen güne göre.
  const todayText = today(tz(c));
  const buckets = [
    { ad: '0-30 gün', min: 0, max: 30 },
    { ad: '31-60 gün', min: 31, max: 60 },
    { ad: '61-90 gün', min: 61, max: 90 },
    { ad: '90+ gün', min: 91, max: Infinity },
  ].map((b) => ({ ...b, alacak_sayi: 0, alacak_has: ZERO, borc_sayi: 0, borc_has: ZERO }));
  for (const p of l.cariData().kisiler as Row[]) {
    const kalan = d(p.kalan_has);
    if (kalan.abs().lt(d('0.001'))) continue;
    const age = p.son_islem_tarihi ? daysBetween(p.son_islem_tarihi, todayText) : 0;
    const b = buckets.find((x) => age >= x.min && age <= x.max) ?? buckets[buckets.length - 1];
    if (kalan.gt(ZERO)) {
      b.alacak_sayi += 1;
      b.alacak_has = b.alacak_has.add(kalan);
    } else {
      b.borc_sayi += 1;
      b.borc_has = b.borc_has.add(kalan.neg());
    }
  }

  const [kasa, personel, komisyon] = await Promise.all([
    all(
      c.env.DB,
      `SELECT k.kategori, h.para_birimi,
              SUM(CASE WHEN k.yon = 'GIRIS' THEN k.tutar ELSE 0 END) AS giris,
              SUM(CASE WHEN k.yon = 'CIKIS' THEN k.tutar ELSE 0 END) AS cikis,
              SUM(k.komisyon) AS komisyon, COUNT(*) AS islem
         FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
        WHERE k.tarih BETWEEN ? AND ?
        GROUP BY k.kategori, h.para_birimi ORDER BY h.para_birimi, giris + cikis DESC`,
      start,
      end
    ),
    all(c.env.DB, `SELECT entity_id, COALESCE(user_name, '') AS user_name FROM audit_logs WHERE entity_type = 'satis' AND action = 'create'`),
    // POS komisyonu kâr değil, giderdir: gün, hesap ve kaynak bazında ayrıca raporlanır.
    all(
      c.env.DB,
      `SELECT k.tarih, h.ad AS hesap, h.para_birimi, k.kategori, COUNT(*) AS islem, SUM(k.tutar) AS tutar, SUM(k.komisyon) AS komisyon
         FROM kasa_hareketleri k JOIN kasa_hesaplari h ON h.id = k.hesap_id
        WHERE k.komisyon > 0 AND k.tarih BETWEEN ? AND ?
        GROUP BY k.tarih, h.id, k.kategori ORDER BY k.tarih, h.sira, k.kategori`,
      start,
      end
    ),
  ]);
  const sellerOf = new Map(personel.map((r) => [Number(r.entity_id), String(r.user_name || '-')]));
  const staff = grouper();
  for (const r of sales) {
    const name = sellerOf.get(Number(r.id)) ?? '-';
    staff.add(normalizeText(name), name, { gram: d(r.gram), has: d(r.has), tutar: d(r.toplam_tutar), kar: d(r.brut_kar) });
  }

  const salesTotal = sum(sales, (r) => d(r.toplam_tutar));
  const scrapSalesTotal = sum(scrapSales, scrapTotal);
  return c.json(ok({
    baslangic: start,
    bitis: end,
    ozet: {
      satis_islem: sales.length,
      satis_tl: money(salesTotal),
      satis_gram: gram(sum(sales, (r) => d(r.gram))),
      satis_has: has(sum(sales, (r) => d(r.has))),
      satis_adet: gram(sum(sales, (r) => d(r.adet ?? 0))),
      brut_kar_tl: money(sum(sales, (r) => d(r.brut_kar))),
      milyem_kari_has: has(sum(sales, (r) => d(r.milyem_kari ?? 0))),
      hurda_satis_tl: money(scrapSalesTotal),
      hurda_satis_islem: scrapSales.length,
      hurda_satis_gram: gram(sum(scrapSales, (r) => d(r.gram))),
      hurda_kar_tl: money(sum(scrapSales, (r) => l.hurdaProfit(r))),
      hurda_alis_tl: money(sum(scrapBuys, scrapTotal)),
      hurda_alis_gram: gram(sum(scrapBuys, (r) => d(r.gram))),
      alis_islem: purchases.length,
      alis_tl: money(sum(purchases, purchaseTotal)),
      alis_gram: gram(sum(purchases, (r) => d(r.gram))),
      alis_has: has(sum(purchases, (r) => d(r.has))),
      gider_has: has(sum(expenses, (r) => d(r.tutar))),
      komisyon_tl: money(sum(komisyon.filter((r) => r.para_birimi === 'TRY'), (r) => d(r.komisyon ?? 0))),
      ortalama_sepet_tl: sales.length ? money(salesTotal.div(d(sales.length))) : 0,
    },
    gunler: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tarih, v]) => ({ tarih, satis_tl: money(v.satis), alis_tl: money(v.alis), kar_tl: money(v.kar), satis_has: has(v.has), alis_has: has(v.alis_has), milyem_kari_has: has(v.milyem), satis_gram: gram(v.gram), satis_islem: v.islem })),
    urunler: products.rows(),
    musteriler: customers.rows(50),
    tedarikciler: suppliers.rows(50),
    personel: staff.rows(),
    giderler: [...giderByCat.entries()].map(([kategori, v]) => ({ kategori, has: has(v) })).sort((a, b) => b.has - a.has),
    kasa: kasa.map((r) => ({ kategori: r.kategori, para_birimi: r.para_birimi, islem: Number(r.islem), giris: money(d(r.giris ?? 0)), cikis: money(d(r.cikis ?? 0)), komisyon: money(d(r.komisyon ?? 0)) })),
    yaslandirma: buckets.map(({ ad, alacak_sayi, alacak_has, borc_sayi, borc_has }) => ({ ad, alacak_sayi, alacak_has: has(alacak_has), borc_sayi, borc_has: has(borc_has) })),
    doviz: await dovizSummary(c.env.DB, start, end),
    komisyon: komisyon.map((r) => ({ tarih: r.tarih, hesap: r.hesap, para_birimi: r.para_birimi, kategori: r.kategori, islem: Number(r.islem), tutar: money(d(r.tutar ?? 0)), komisyon: money(d(r.komisyon ?? 0)), net: money(d(r.tutar ?? 0).sub(d(r.komisyon ?? 0))) })),
    stok: [
      ...(l.stockItems() as Row[]).filter((r) => d(r.kalan_gram).gt(ZERO)).map((r) => ({ tur: 'Normal', cinsi: r.cinsi, ayar: r.ayar, kalan_gram: r.kalan_gram, kalan_has: r.kalan_has, maliyet: r.stok_degeri })),
      ...(l.hurdaStockItems() as Row[]).filter((r) => d(r.kalan_gram).gt(ZERO)).map((r) => ({ tur: 'Hurda', cinsi: r.cinsi, ayar: r.ayar, kalan_gram: r.kalan_gram, kalan_has: r.kalan_has, maliyet: r.stok_degeri })),
    ],
  }));
});

export default rapor;
