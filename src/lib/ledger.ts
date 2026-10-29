/**
 * Kuyumcu iş kuralları: stok (FIFO), milyem kârı, hurda, cari ve özetler.
 *
 * Masaüstü sürümdeki (legacy-python/main.py) hesapların birebir karşılığıdır.
 * Tüm tablolar istek başında tek seferde belleğe alınır (Snapshot) ve
 * hesaplar burada yapılır; D1'e satır satır sorgu atılmaz.
 */

import { Dec, d, ZERO, MONEY_Q, HAS_Q, NUM_Q, asFloat } from './decimal';
import { cleanText, normalizeText, normalizeProduct, isHurdaProduct, displayIslemTuru, cmpStr, cmpTuple, PRODUCTS } from './text';
import { HttpError, calcHas, type TxPayload } from './validate';

export type Row = Record<string, any>;
export type Kind = 'normal' | 'hurda';

export type AllocationRow = {
  kind: Kind;
  sale_id: number;
  purchase_id: number;
  gram: string;
  has: string;
  cost: string;
  milyem: string;
};

/** Tabloların `ORDER BY tarih DESC, id DESC` sıralı hali. */
export type Snapshot = {
  alis: Row[];
  satis: Row[];
  hurda: Row[];
  cari_odeme: Row[];
  giderler: Row[];
  allocations: AllocationRow[];
};

export type PlanPart = { purchase_id: number; gram: Dec; has: Dec; cost: Dec; milyem: Dec };

export function purchaseTotal(row: Row): Dec {
  return d(row.has).mul(d(row.has_fiyati)).add(d(row.iscilik)).add(d(row.ek_masraf)).q(MONEY_Q);
}

/**
 * Alışın işçilik ve masraf dahil maliyet milyemi: tutar ÷ (gram × has fiyatı) × 1000.
 * Ör. 11,61 gr, has fiyatı 6.435,15, tutar 57.155,72 → 765. Önerilen satış fiyatı bunun
 * üstüne kâr milyemi eklenerek güncel satış has fiyatıyla hesaplanır. Hesaplanamazsa null.
 */
export function costMilyem(row: Row): number | null {
  const gram = d(row.gram);
  const fiyat = d(row.has_fiyati);
  if (gram.le(ZERO) || fiyat.le(ZERO)) return null;
  return purchaseTotal(row).div(gram.mul(fiyat)).mul(1000).q(NUM_Q).toNumber();
}

/** Alış maliyetinde işçilik ya da masraf var mı (yoksa etiketteki işçilik satışa eklenir). */
export const costHasLabor = (row: Row): boolean => d(row.iscilik).add(d(row.ek_masraf)).gt(ZERO);

export function saleTotal(row: Row): Dec {
  return d(row.has).mul(d(row.has_fiyati)).add(d(row.iscilik)).add(d(row.ek_ucret)).sub(d(row.indirim)).q(MONEY_Q);
}

export function scrapTotal(row: Row): Dec {
  return d(row.has).mul(d(row.has_fiyati)).add(d(row.iscilik)).q(MONEY_Q);
}

/** Python `int(x) if x else None` */
function truthyId(value: unknown): number | null {
  return value ? Number(value) : null;
}

export function salePurchaseId(row: Row): number | null {
  return truthyId(row.purchase_id) ?? truthyId(row.alis_id);
}

const NUMBER_KEYS = ['adet', 'gram', 'milyem', 'has', 'odenen_has', 'odenen_adet', 'odenen_gram', 'odenen_milyem'];
const MONEY_KEYS = ['has_fiyati', 'iscilik', 'ek_masraf', 'odenen', 'ek_ucret', 'indirim', 'alinan', 'toplam_tutar', 'odenen_veya_alinan'];

/** Veritabanı satırını API çıktısına çevirir (masaüstü `row_dict`). */
export function rowDict(row: Row, totalName?: string, total?: Dec): Row {
  const data: Row = { ...row };
  if ('has' in data && 'gram' in data && 'milyem' in data && !d(data.has).eq(calcHas(data.gram, data.milyem))) {
    data.has_override = String(data.has);
  }
  if ('notlar' in data) {
    const notlar = data.notlar;
    delete data.notlar;
    data.not = notlar;
  }
  if (data.islem_turu === 'ALIS' || data.islem_turu === 'SATIS') data.islem_turu = displayIslemTuru(data.islem_turu);
  for (const key of NUMBER_KEYS) if (key in data) data[key] = asFloat(data[key], key === 'has' ? HAS_Q : NUM_Q);
  for (const key of MONEY_KEYS) if (key in data) data[key] = asFloat(data[key], MONEY_Q);
  if (totalName && total) data[totalName] = asFloat(total, MONEY_Q);
  return data;
}

function sameProduct(row: Row, cinsi: unknown, ayar: unknown): boolean {
  return normalizeText(row.cinsi) === normalizeText(cinsi) && normalizeText(row.ayar) === normalizeText(ayar);
}

function byDateId(a: Row, b: Row): number {
  return cmpStr(String(a.tarih), String(b.tarih)) || Number(a.id) - Number(b.id);
}

type SoldIndex = Map<number, { id: number; gram: Dec }[]>;

export class Ledger {
  readonly s: Snapshot;
  readonly tz: string;
  private alisById = new Map<number, Row>();
  private satisById = new Map<number, Row>();
  private hurdaById = new Map<number, Row>();
  private allocBySale = new Map<string, AllocationRow[]>();
  private allocByPurchase = new Map<string, AllocationRow[]>();
  private soldNormal: SoldIndex = new Map();
  private soldHurda: SoldIndex = new Map();
  private stockCache: Row[] | null = null;
  private hurdaStockCache: Row[] | null = null;
  private cariCache: Row | null = null;

  constructor(snapshot: Snapshot, tz = 'Europe/Istanbul') {
    this.s = snapshot;
    this.tz = tz;
    for (const r of snapshot.alis) this.alisById.set(Number(r.id), r);
    for (const r of snapshot.satis) this.satisById.set(Number(r.id), r);
    for (const r of snapshot.hurda) this.hurdaById.set(Number(r.id), r);
    const sorted = [...snapshot.allocations].sort((a, b) => Number(a.purchase_id) - Number(b.purchase_id));
    for (const a of sorted) {
      push(this.allocBySale, `${a.kind}:${a.sale_id}`, a);
      push(this.allocByPurchase, `${a.kind}:${a.purchase_id}`, a);
    }
    for (const r of snapshot.satis) {
      if (Number(r.stoktan)) continue;
      const pid = r.purchase_id ?? r.alis_id;
      if (pid === null || pid === undefined) continue;
      push(this.soldNormal, Number(pid), { id: Number(r.id), gram: d(r.gram) });
    }
    for (const r of snapshot.hurda) {
      if (r.islem_turu !== 'SATIS' || Number(r.stoktan) || r.hurda_alis_id === null || r.hurda_alis_id === undefined) continue;
      push(this.soldHurda, Number(r.hurda_alis_id), { id: Number(r.id), gram: d(r.gram) });
    }
  }

  alis(id: number | null | undefined): Row | undefined {
    return id === null || id === undefined ? undefined : this.alisById.get(Number(id));
  }
  satis(id: number): Row | undefined {
    return this.satisById.get(Number(id));
  }
  hurda(id: number | null | undefined): Row | undefined {
    return id === null || id === undefined ? undefined : this.hurdaById.get(Number(id));
  }
  private hurdaAlis(id: unknown): Row | undefined {
    const row = id ? this.hurdaById.get(Number(id)) : undefined;
    return row && row.islem_turu === 'ALIS' ? row : undefined;
  }

  /* ---------------------------- stok dağılımı ---------------------------- */

  allocationRows(kind: Kind, saleId: number): AllocationRow[] {
    return this.allocBySale.get(`${kind}:${saleId}`) ?? [];
  }

  allocationUsedGram(kind: Kind, purchaseId: number, excludeId: number | null = null): Dec {
    const exclude = excludeId || -1;
    return Dec.sum((this.allocByPurchase.get(`${kind}:${purchaseId}`) ?? []).filter((a) => Number(a.sale_id) !== exclude).map((a) => d(a.gram)));
  }

  allocatedValue(kind: Kind, row: Row, key: 'gram' | 'has' | 'cost' | 'milyem'): Dec {
    return Dec.sum(this.allocationRows(kind, Number(row.id)).map((p) => d(p[key])));
  }

  allocatedStockHas(kind: Kind, row: Row): Dec {
    let total = ZERO;
    for (const part of this.allocationRows(kind, Number(row.id))) {
      const purchase = kind === 'normal' ? this.alis(part.purchase_id) : this.hurda(part.purchase_id);
      total = purchase && !d(purchase.gram).isZero()
        ? total.add(d(part.gram).mul(d(purchase.has)).div(d(purchase.gram)))
        : total.add(d(part.has));
    }
    return total;
  }

  allocatedMilyem(kind: Kind, row: Row): Dec {
    const gram = d(row.gram);
    if (gram.isZero()) return ZERO;
    return Dec.sum(this.allocationRows(kind, Number(row.id)).map((p) => d(p.gram).mul(d(p.milyem)))).div(gram);
  }

  private remaining(kind: Kind, purchase: Row, excludeId: number | null): { kalan_gram: Dec; kalan_has: Dec } {
    const index = kind === 'normal' ? this.soldNormal : this.soldHurda;
    const sold = Dec.sum((index.get(Number(purchase.id)) ?? []).filter((s) => !excludeId || s.id !== excludeId).map((s) => s.gram));
    const allocated = this.allocationUsedGram(kind, Number(purchase.id), excludeId);
    const total = d(purchase.gram);
    const kalan_gram = total.sub(sold).sub(allocated).q(NUM_Q);
    return {
      kalan_gram,
      kalan_has: total.gt(ZERO) ? kalan_gram.mul(d(purchase.has)).div(total).q(HAS_Q) : ZERO,
    };
  }

  purchaseRemaining(alis: Row, excludeSaleId: number | null = null) {
    return this.remaining('normal', alis, excludeSaleId);
  }

  hurdaPurchaseRemaining(hurdaAlis: Row, excludeId: number | null = null) {
    return this.remaining('hurda', hurdaAlis, excludeId);
  }

  stockLots(kind: Kind, cinsi: string, ayar: string, excludeId: number | null = null): [Row, Dec][] {
    const purchases = (kind === 'normal'
      ? this.s.alis.filter((r) => sameProduct(r, cinsi, ayar) && !isHurdaProduct(r.cinsi))
      : this.s.hurda.filter((r) => sameProduct(r, cinsi, ayar) && r.islem_turu === 'ALIS')
    ).sort(byDateId);
    const sales = (kind === 'normal' ? this.s.satis : this.s.hurda).filter(
      (r) => sameProduct(r, cinsi, ayar) && Number(r.id) !== excludeId && (kind === 'normal' || r.islem_turu === 'SATIS')
    );
    const ids = new Set(purchases.map((r) => Number(r.id)));
    let unlinked = Dec.sum(
      sales
        .filter((r) => {
          if (Number(r.stoktan)) return false;
          const link = kind === 'normal' ? salePurchaseId(r) : r.hurda_alis_id;
          return link === null || link === undefined || !ids.has(Number(link));
        })
        .map((r) => d(r.gram))
    );
    let available = Dec.max(Dec.sum(purchases.map((r) => d(r.gram))).sub(Dec.sum(sales.map((r) => d(r.gram)))), ZERO);
    const result: [Row, Dec][] = [];
    for (const purchase of purchases) {
      const rem = this.remaining(kind, purchase, excludeId);
      let free = Dec.max(rem.kalan_gram, ZERO);
      const consume = Dec.min(free, unlinked);
      unlinked = unlinked.sub(consume);
      free = Dec.min(free.sub(consume), available);
      if (free.gt(ZERO)) {
        result.push([purchase, free]);
        available = available.sub(free);
      }
    }
    return result;
  }

  /** Stoktan satışın hangi alışlardan (en eskiden başlayarak) düşeceğini hesaplar. */
  planStockSale(kind: Kind, payload: TxPayload, excludeId: number | null = null): PlanPart[] {
    if (excludeId) {
      const old = kind === 'normal' ? this.satis(excludeId) : this.hurda(excludeId);
      if (old && Number(old.stoktan) && d(old.gram).eq(payload.gram) && sameProduct(old, payload.cinsi, payload.ayar)) {
        const saved = this.allocationRows(kind, excludeId);
        if (saved.length && Dec.sum(saved.map((p) => d(p.gram))).eq(payload.gram)) {
          return saved.map((p) => ({ purchase_id: Number(p.purchase_id), gram: d(p.gram), has: d(p.has), cost: d(p.cost), milyem: d(p.milyem) }));
        }
      }
    }
    let needed = payload.gram;
    if (needed.le(ZERO)) throw new HttpError(400, 'Satış gramı sıfırdan büyük olmalı.');
    const plan: PlanPart[] = [];
    for (const [purchase, free] of this.stockLots(kind, payload.cinsi, payload.ayar, excludeId)) {
      const take = Dec.min(needed, free);
      const total = kind === 'normal' ? purchaseTotal(purchase) : scrapTotal(purchase);
      const gram = d(purchase.gram);
      plan.push({
        purchase_id: Number(purchase.id),
        gram: take,
        has: take.mul(d(purchase.has)).div(gram),
        cost: take.mul(total).div(gram),
        milyem: d(purchase.milyem),
      });
      needed = needed.sub(take);
      if (needed.isZero()) return plan;
    }
    throw new HttpError(400, 'STOK YETERSIZ');
  }

  stockOptions(kind: Kind, excludeId: number | null = null): Row[] {
    const rows = kind === 'normal' ? this.s.alis : this.s.hurda;
    const groups = new Map<string, [string, string]>();
    for (const r of rows) {
      if (kind === 'normal' ? isHurdaProduct(r.cinsi) : r.islem_turu !== 'ALIS') continue;
      groups.set(`${normalizeText(r.cinsi)}\u0000${normalizeText(r.ayar)}`, [normalizeProduct(r.cinsi), cleanText(r.ayar)]);
    }
    const result: Row[] = [];
    for (const [cinsi, ayar] of [...groups.values()].sort(cmpTuple)) {
      const lots = this.stockLots(kind, cinsi, ayar, excludeId);
      const grams = Dec.sum(lots.map(([, free]) => free));
      if (grams.le(ZERO)) continue;
      const has = Dec.sum(lots.map(([r, free]) => free.mul(d(r.has)).div(d(r.gram))));
      const milyem = Dec.sum(lots.map(([r, free]) => free.mul(d(r.milyem)))).div(grams);
      result.push({
        cinsi,
        ayar,
        stoktan: true,
        kalan_gram: asFloat(grams, NUM_Q),
        kalan_has: asFloat(has, HAS_Q),
        alis_milyem: asFloat(milyem, NUM_Q),
        // FIFO'da sıradaki partinin maliyet milyemi (önerilen satış fiyatı için).
        maliyet_milyem: costMilyem(lots[0][0]),
        maliyet_iscilik: costHasLabor(lots[0][0]),
        kaynaklar: lots.map(([r, free]) => ({ gram: asFloat(free, NUM_Q), milyem: asFloat(r.milyem, NUM_Q) })),
      });
    }
    return result;
  }

  /* ------------------------------- stok ---------------------------------- */

  stockItems(): Row[] {
    if (this.stockCache) return this.stockCache;
    type Item = { cinsi: string; ayar: string; alis_gram: Dec; alis_has: Dec; alis_maliyet: Dec; satilan_maliyet: Dec; satis_stok_has: Dec; satis_gram: Dec; satis_has: Dec };
    const items = new Map<string, Item>();
    const get = (cinsi: unknown, ayar: unknown): Item => {
      const key = `${normalizeText(cinsi)}\u0000${normalizeText(ayar)}`;
      let item = items.get(key);
      if (!item) {
        item = { cinsi: normalizeProduct(cinsi), ayar: cleanText(ayar), alis_gram: ZERO, alis_has: ZERO, alis_maliyet: ZERO, satilan_maliyet: ZERO, satis_stok_has: ZERO, satis_gram: ZERO, satis_has: ZERO };
        items.set(key, item);
      }
      return item;
    };
    for (const r of this.s.alis) {
      if (isHurdaProduct(r.cinsi)) continue;
      const item = get(r.cinsi, r.ayar);
      item.alis_gram = item.alis_gram.add(d(r.gram));
      item.alis_has = item.alis_has.add(d(r.has));
      item.alis_maliyet = item.alis_maliyet.add(purchaseTotal(r));
    }
    for (const r of this.s.satis) {
      if (isHurdaProduct(r.cinsi)) continue;
      const item = get(r.cinsi, r.ayar);
      item.satis_gram = item.satis_gram.add(d(r.gram));
      item.satis_has = item.satis_has.add(d(r.has));
      const purchase = this.alis(salePurchaseId(r));
      const ratio = purchase && d(purchase.gram).gt(ZERO)
        ? d(purchase.has).div(d(purchase.gram))
        : item.alis_gram.gt(ZERO) ? item.alis_has.div(item.alis_gram) : ZERO;
      item.satis_stok_has = item.satis_stok_has.add(Number(r.stoktan) ? this.allocatedStockHas('normal', r) : d(r.gram).mul(ratio));
      item.satilan_maliyet = item.satilan_maliyet.add(this.salePurchaseCost(r));
    }
    const result = [...items.values()].map((item) => {
      const kalan_gram = item.alis_gram.sub(item.satis_gram).q(NUM_Q);
      const open = !kalan_gram.isZero();
      const kalan_has = open ? item.alis_has.sub(item.satis_stok_has) : ZERO;
      const avg = item.alis_has.gt(ZERO) ? item.alis_maliyet.div(item.alis_has) : ZERO;
      return {
        cinsi: item.cinsi,
        ayar: item.ayar,
        alis_gram: asFloat(item.alis_gram, NUM_Q),
        alis_has: asFloat(item.alis_has, HAS_Q),
        satis_gram: asFloat(item.satis_gram, NUM_Q),
        satis_has: asFloat(item.satis_has, HAS_Q),
        kalan_gram: asFloat(kalan_gram, NUM_Q),
        kalan_has: asFloat(kalan_has, HAS_Q),
        ortalama_has_maliyeti: asFloat(avg, MONEY_Q),
        stok_degeri: asFloat(open ? item.alis_maliyet.sub(item.satilan_maliyet) : ZERO, MONEY_Q),
        uyari: kalan_gram.isNeg() ? 'STOK YETERSIZ' : '',
      };
    });
    this.stockCache = result.sort((a, b) => cmpTuple([normalizeText(a.cinsi), normalizeText(a.ayar)], [normalizeText(b.cinsi), normalizeText(b.ayar)]));
    return this.stockCache;
  }

  hurdaStockItems(): Row[] {
    if (this.hurdaStockCache) return this.hurdaStockCache;
    type Item = {
      cinsi: string; ayar: string; hurda_alis_gram: Dec; hurda_alis_has: Dec; hurda_alis_tutari: Dec;
      hurda_satis_gram: Dec; hurda_satis_has: Dec; hurda_satis_tutari: Dec; satilan_maliyet: Dec; satis_stok_has: Dec; unlinked_satis_gram: Dec;
    };
    const items = new Map<string, Item>();
    const get = (cinsi: unknown, ayar: unknown): Item => {
      const key = `${normalizeText(cinsi)}\u0000${normalizeText(ayar)}`;
      let item = items.get(key);
      if (!item) {
        item = {
          cinsi: normalizeProduct(cinsi), ayar: cleanText(ayar), hurda_alis_gram: ZERO, hurda_alis_has: ZERO, hurda_alis_tutari: ZERO,
          hurda_satis_gram: ZERO, hurda_satis_has: ZERO, hurda_satis_tutari: ZERO, satilan_maliyet: ZERO, satis_stok_has: ZERO, unlinked_satis_gram: ZERO,
        };
        items.set(key, item);
      }
      return item;
    };
    for (const r of this.s.hurda) {
      const item = get(r.cinsi, r.ayar);
      if (r.islem_turu === 'ALIS') {
        item.hurda_alis_gram = item.hurda_alis_gram.add(d(r.gram));
        item.hurda_alis_has = item.hurda_alis_has.add(d(r.has));
        item.hurda_alis_tutari = item.hurda_alis_tutari.add(scrapTotal(r));
      } else {
        item.hurda_satis_gram = item.hurda_satis_gram.add(d(r.gram));
        item.hurda_satis_has = item.hurda_satis_has.add(d(r.has));
        const purchase = this.hurdaAlis(r.hurda_alis_id);
        if (Number(r.stoktan)) item.satis_stok_has = item.satis_stok_has.add(this.allocatedStockHas('hurda', r));
        else if (purchase && d(purchase.gram).gt(ZERO)) item.satis_stok_has = item.satis_stok_has.add(d(r.gram).mul(d(purchase.has)).div(d(purchase.gram)));
        else item.unlinked_satis_gram = item.unlinked_satis_gram.add(d(r.gram));
        item.hurda_satis_tutari = item.hurda_satis_tutari.add(scrapTotal(r));
        item.satilan_maliyet = item.satilan_maliyet.add(scrapTotal(r).sub(this.hurdaProfit(r)));
      }
    }
    const result = [...items.values()].map((item) => {
      const kalan_gram = item.hurda_alis_gram.sub(item.hurda_satis_gram).q(NUM_Q);
      const open = !kalan_gram.isZero();
      const ratio = item.hurda_alis_gram.gt(ZERO) ? item.hurda_alis_has.div(item.hurda_alis_gram) : ZERO;
      const kalan_has = open ? item.hurda_alis_has.sub(item.satis_stok_has).sub(item.unlinked_satis_gram.mul(ratio)) : ZERO;
      const avg = item.hurda_alis_has.gt(ZERO) ? item.hurda_alis_tutari.div(item.hurda_alis_has) : ZERO;
      return {
        cinsi: item.cinsi,
        ayar: item.ayar,
        hurda_alis_gram: asFloat(item.hurda_alis_gram, NUM_Q),
        hurda_alis_has: asFloat(item.hurda_alis_has, HAS_Q),
        hurda_alis_tutari: asFloat(item.hurda_alis_tutari, MONEY_Q),
        hurda_satis_gram: asFloat(item.hurda_satis_gram, NUM_Q),
        hurda_satis_has: asFloat(item.hurda_satis_has, HAS_Q),
        hurda_satis_tutari: asFloat(item.hurda_satis_tutari, MONEY_Q),
        kalan_gram: asFloat(kalan_gram, NUM_Q),
        kalan_has: asFloat(kalan_has, HAS_Q),
        ortalama_has_maliyeti: asFloat(avg, MONEY_Q),
        stok_degeri: asFloat(open ? item.hurda_alis_tutari.sub(item.satilan_maliyet) : ZERO, MONEY_Q),
        uyari: kalan_gram.isNeg() ? 'STOK YETERSIZ' : '',
      };
    });
    this.hurdaStockCache = result.sort((a, b) => cmpTuple([normalizeText(a.cinsi), normalizeText(a.ayar)], [normalizeText(b.cinsi), normalizeText(b.ayar)]));
    return this.hurdaStockCache;
  }

  private hurdaStockLookup(cinsi: unknown, ayar: unknown): Row | undefined {
    return this.hurdaStockItems().find((i) => normalizeText(i.cinsi) === normalizeText(cinsi) && normalizeText(i.ayar) === normalizeText(ayar));
  }

  /** Normal satışta stok kontrolü (seçilen alış kaydından). */
  ensureSaleStock(payload: { alis_id: number | null; cinsi: string; ayar: string; gram: Dec }, excludeSaleId: number | null = null): Row {
    const alis = this.alis(payload.alis_id);
    if (!alis) throw new HttpError(400, 'ALIŞ KAYDI BULUNAMADI');
    if (!sameProduct(alis, payload.cinsi, payload.ayar)) throw new HttpError(400, 'Seçilen alış ile satış ürünü uyuşmuyor.');
    const rem = this.purchaseRemaining(alis, excludeSaleId);
    if (payload.gram.gt(rem.kalan_gram)) throw new HttpError(400, 'STOK YETERSİZ');
    return alis;
  }

  ensureHurdaStock(payload: { islem_turu: string; hurda_alis_id: number | null; cinsi: string; ayar: string; gram: Dec }, excludeId: number | null = null): Row | null {
    if (payload.islem_turu !== 'SATIS') return null;
    if (!payload.hurda_alis_id) throw new HttpError(400, 'Hurda satış için hurda alıştan ürün seçilmeli.');
    const alis = this.hurdaAlis(payload.hurda_alis_id);
    if (!alis) throw new HttpError(400, 'Hurda alış kaydı bulunamadı.');
    if (!sameProduct(alis, payload.cinsi, payload.ayar)) throw new HttpError(400, 'Seçilen hurda alış ile satış ürünü uyuşmuyor.');
    const rem = this.hurdaPurchaseRemaining(alis, excludeId);
    if (payload.gram.gt(rem.kalan_gram)) throw new HttpError(400, 'STOK YETERSİZ');
    return alis;
  }

  /* ------------------------------ satış ---------------------------------- */

  salePurchaseCost(row: Row): Dec {
    if (Number(row.stoktan)) return this.allocatedValue('normal', row, 'cost').q(MONEY_Q);
    const alis = this.alis(salePurchaseId(row));
    if (alis && d(alis.gram).gt(ZERO)) return purchaseTotal(alis).mul(d(row.gram)).div(d(alis.gram)).q(MONEY_Q);
    const purchases = this.s.alis.filter((r) => sameProduct(r, row.cinsi, row.ayar));
    const grams = Dec.sum(purchases.map((r) => d(r.gram)));
    return grams.isZero() ? ZERO : Dec.sum(purchases.map(purchaseTotal)).mul(d(row.gram)).div(grams).q(MONEY_Q);
  }

  saleProfit(row: Row): Dec {
    if (Number(row.stoktan)) return d(row.gram).mul(d(row.milyem).sub(this.allocatedMilyem('normal', row))).div(1000).q(HAS_Q);
    const alis = this.alis(salePurchaseId(row));
    if (!alis) return ZERO;
    return d(row.gram).mul(d(row.milyem).sub(d(alis.milyem))).div(1000).q(HAS_Q);
  }

  saleMetrics(row: Row): Row {
    const alis = this.alis(salePurchaseId(row));
    if (!alis && !Number(row.stoktan)) {
      return {
        alis_milyem: 0, satis_milyem: asFloat(row.milyem, NUM_Q), milyem_farki: 0,
        satis_has: asFloat(row.has, HAS_Q), has_kari: 0, milyem_kari: 0, tahmini_kar: 0,
      };
    }
    const alisMilyem = Number(row.stoktan) ? this.allocatedMilyem('normal', row) : d(alis!.milyem);
    const satisMilyem = d(row.milyem);
    const fark = satisMilyem.sub(alisMilyem);
    const hasKari = d(row.gram).mul(fark).div(1000).q(HAS_Q);
    return {
      alis_milyem: asFloat(alisMilyem, NUM_Q),
      satis_milyem: asFloat(satisMilyem, NUM_Q),
      milyem_farki: asFloat(fark, NUM_Q),
      satis_has: asFloat(row.has, HAS_Q),
      milyem_farki_has_etkisi: asFloat(hasKari, HAS_Q),
      has_kari: asFloat(hasKari, HAS_Q),
      milyem_kari: asFloat(hasKari, HAS_Q),
      has_kari_milyem: asFloat(fark, NUM_Q),
      tahmini_kar: asFloat(hasKari, HAS_Q),
    };
  }

  saleOut(row: Row): Row {
    const total = saleTotal(row);
    const item = rowDict(row, 'toplam_tutar', total);
    item.kalan_borc = asFloat(total.sub(d(row.alinan)), MONEY_Q);
    Object.assign(item, this.saleMetrics(row));
    const purchaseId = salePurchaseId(row);
    item.purchase_id = purchaseId;
    item.alis_id = purchaseId;
    item.milyem_kari = item.has_kari;
    item.kar = item.milyem_kari;
    const cost = this.salePurchaseCost(row);
    item.alis_maliyeti = asFloat(cost);
    item.brut_kar = asFloat(total.sub(cost));
    item.uyari = '';
    if (Number(row.stoktan)) item.stok_dagilimi = this.allocationRows('normal', Number(row.id)).map((p) => ({ ...p }));
    return item;
  }

  purchaseOut(row: Row): Row {
    const total = purchaseTotal(row);
    const item = rowDict(row, 'toplam_tutar', total);
    item.kalan_borc = asFloat(total.sub(d(row.odenen)), MONEY_Q);
    return item;
  }

  /* ------------------------------ hurda ---------------------------------- */

  hurdaProfit(row: Row): Dec {
    if (Number(row.stoktan) && row.islem_turu === 'SATIS') return scrapTotal(row).sub(this.allocatedValue('hurda', row, 'cost')).q(MONEY_Q);
    if (row.islem_turu !== 'SATIS') return ZERO;
    const alis = this.hurdaAlis(row.hurda_alis_id);
    if (alis && d(alis.gram).gt(ZERO)) return scrapTotal(row).sub(d(row.gram).mul(scrapTotal(alis)).div(d(alis.gram))).q(MONEY_Q);
    const purchases = this.s.hurda.filter((r) => r.islem_turu === 'ALIS' && sameProduct(r, row.cinsi, row.ayar));
    const grams = Dec.sum(purchases.map((r) => d(r.gram)));
    const cost = Dec.sum(purchases.map(scrapTotal));
    return grams.isZero() ? scrapTotal(row) : scrapTotal(row).sub(d(row.gram).mul(cost).div(grams)).q(MONEY_Q);
  }

  hurdaOut(row: Row): Row {
    const total = scrapTotal(row);
    const satis = row.islem_turu === 'SATIS';
    const item = rowDict(row, 'toplam_tutar', total);
    item.kalan_borc = asFloat(total.sub(d(row.odenen_veya_alinan)), MONEY_Q);
    item.hurda_kar = satis ? asFloat(this.hurdaProfit(row), MONEY_Q) : 0;
    const linked = satis ? this.hurdaAlis(row.hurda_alis_id) : undefined;
    const source = linked ?? row;
    const rem = source.islem_turu === 'ALIS' ? this.hurdaPurchaseRemaining(source) : { kalan_gram: ZERO, kalan_has: ZERO };
    item.kalan_gram = asFloat(rem.kalan_gram, NUM_Q);
    item.kalan_has = asFloat(rem.kalan_has, HAS_Q);
    let alisMilyem = linked ? d(linked.milyem) : !satis ? d(row.milyem) : ZERO;
    if (Number(row.stoktan) && satis) {
      alisMilyem = this.allocatedMilyem('hurda', row);
      const stock = this.hurdaStockLookup(row.cinsi, row.ayar);
      item.kalan_gram = stock?.kalan_gram ?? 0;
      item.kalan_has = stock?.kalan_has ?? 0;
    }
    const satisMilyem = satis ? d(row.milyem) : ZERO;
    const fark = satis ? satisMilyem.sub(alisMilyem) : ZERO;
    const kar = satis ? d(row.gram).mul(fark).div(1000).q(HAS_Q) : ZERO;
    item.alis_milyem = asFloat(alisMilyem, NUM_Q);
    item.satis_milyem = asFloat(satisMilyem, NUM_Q);
    item.milyem_farki = asFloat(fark, NUM_Q);
    item.milyem_kari = asFloat(kar, HAS_Q);
    item.has_kari = item.milyem_kari;
    if (Number(row.stoktan)) item.stok_dagilimi = this.allocationRows('hurda', Number(row.id)).map((p) => ({ ...p }));
    return item;
  }

  hurdaList(): Row {
    const rows = this.s.hurda;
    const alis = rows.filter((r) => r.islem_turu === 'ALIS');
    const satis = rows.filter((r) => r.islem_turu === 'SATIS');
    return {
      ozet: {
        hurda_alis_has: asFloat(Dec.sum(alis.map((r) => d(r.has))), HAS_Q),
        hurda_satis_has: asFloat(Dec.sum(satis.map((r) => d(r.has))), HAS_Q),
        hurda_kalan_has: asFloat(Dec.sum(this.hurdaStockItems().map((i) => d(i.kalan_has))), HAS_Q),
        hurda_alis_tutari: asFloat(Dec.sum(alis.map(scrapTotal)), MONEY_Q),
        hurda_satis_tutari: asFloat(Dec.sum(satis.map(scrapTotal)), MONEY_Q),
        hurda_kar: asFloat(Dec.sum(rows.map((r) => this.hurdaProfit(r))), MONEY_Q),
      },
      stok: this.hurdaStockItems(),
      kayitlar: rows.map((r) => this.hurdaOut(r)),
    };
  }

  saleOptions(): Row[] {
    const result: Row[] = [];
    for (const r of this.s.alis) {
      if (isHurdaProduct(r.cinsi)) continue;
      const rem = this.purchaseRemaining(r);
      if (!rem.kalan_gram.gt(ZERO)) continue;
      const total = purchaseTotal(r);
      const item = rowDict(r, 'toplam_tutar', total);
      item.alis_milyem = item.milyem;
      item.alis_has_maliyeti = asFloat(d(r.has).gt(ZERO) ? total.div(d(r.has)) : ZERO, MONEY_Q);
      item.kalan_gram = asFloat(rem.kalan_gram, NUM_Q);
      item.kalan_has = asFloat(rem.kalan_has, HAS_Q);
      item.kalan_stok = `${pyFloat(item.kalan_gram)} gr / ${pyFloat(item.kalan_has)} has`;
      result.push(item);
    }
    return result;
  }

  hurdaSaleOptions(): Row[] {
    const result: Row[] = [];
    for (const r of this.s.hurda) {
      if (r.islem_turu !== 'ALIS') continue;
      const rem = this.hurdaPurchaseRemaining(r);
      if (!rem.kalan_gram.gt(ZERO)) continue;
      const item = this.hurdaOut(r);
      item.hurda_alis_id = item.id;
      item.alis_milyem = item.milyem;
      item.alis_has_maliyeti = asFloat(d(r.has).gt(ZERO) ? scrapTotal(r).div(d(r.has)) : ZERO, MONEY_Q);
      item.kalan_gram = asFloat(rem.kalan_gram, NUM_Q);
      item.kalan_has = asFloat(rem.kalan_has, HAS_Q);
      item.kalan_stok = `${pyFloat(item.kalan_gram)} gr / ${pyFloat(item.kalan_has)} has`;
      result.push(item);
    }
    return result;
  }

  /* ------------------------------- cari ---------------------------------- */

  cariData(): Row {
    if (this.cariCache) return this.cariCache;
    type Person = {
      isim: string; toplam_alis: Dec; odenen: Dec; toplam_satis: Dec; alinan: Dec; normal_alis_has: Dec; normal_satis_has: Dec;
      hurda_alis_has: Dec; hurda_satis_has: Dec; odedigimiz_has: Dec; tahsil_edilen_has: Dec; son_islem_tarihi: string;
    };
    const combined = new Map<string, Person>();
    const customerKeys = new Set<string>();
    const supplierKeys = new Set<string>();
    const get = (name: unknown): Person => {
      const key = normalizeText(name);
      let p = combined.get(key);
      if (!p) {
        p = {
          isim: cleanText(name), toplam_alis: ZERO, odenen: ZERO, toplam_satis: ZERO, alinan: ZERO, normal_alis_has: ZERO, normal_satis_has: ZERO,
          hurda_alis_has: ZERO, hurda_satis_has: ZERO, odedigimiz_has: ZERO, tahsil_edilen_has: ZERO, son_islem_tarihi: '',
        };
        combined.set(key, p);
      }
      return p;
    };
    const latest = (a: string, b: unknown) => (cmpStr(a, String(b)) >= 0 ? a : String(b));
    const addPurchase = (name: unknown, total: Dec, paid: Dec, has: Dec, paidHas: Dec, tarih: unknown, hurda = false) => {
      supplierKeys.add(normalizeText(name));
      const p = get(name);
      p.toplam_alis = p.toplam_alis.add(total);
      p.odenen = p.odenen.add(paid);
      if (hurda) p.hurda_alis_has = p.hurda_alis_has.add(has);
      else p.normal_alis_has = p.normal_alis_has.add(has);
      p.odedigimiz_has = p.odedigimiz_has.add(paidHas);
      p.son_islem_tarihi = latest(p.son_islem_tarihi, tarih);
    };
    const addSale = (name: unknown, total: Dec, received: Dec, has: Dec, paidHas: Dec, tarih: unknown, hurda = false) => {
      customerKeys.add(normalizeText(name));
      const p = get(name);
      p.toplam_satis = p.toplam_satis.add(total);
      p.alinan = p.alinan.add(received);
      if (hurda) p.hurda_satis_has = p.hurda_satis_has.add(has);
      else p.normal_satis_has = p.normal_satis_has.add(has);
      p.tahsil_edilen_has = p.tahsil_edilen_has.add(paidHas);
      p.son_islem_tarihi = latest(p.son_islem_tarihi, tarih);
    };
    for (const r of this.s.alis) addPurchase(r.tedarikci, purchaseTotal(r), d(r.odenen), d(r.has), d(r.odenen_has), r.tarih);
    for (const r of this.s.satis) addSale(r.musteri, saleTotal(r), d(r.alinan), d(r.has), d(r.odenen_has), r.tarih);
    for (const r of this.s.hurda) {
      if (r.islem_turu === 'ALIS') addPurchase(r.kisi, scrapTotal(r), d(r.odenen_veya_alinan), d(r.has), d(r.odenen_has), r.tarih, true);
      else addSale(r.kisi, scrapTotal(r), d(r.odenen_veya_alinan), d(r.has), d(r.odenen_has), r.tarih, true);
    }
    for (const r of this.s.cari_odeme) {
      const p = get(r.isim);
      if ((r.yon ?? 'TAHSILAT') === 'ODEME') p.odedigimiz_has = p.odedigimiz_has.add(d(r.odenen_has));
      else p.tahsil_edilen_has = p.tahsil_edilen_has.add(d(r.odenen_has));
      p.son_islem_tarihi = latest(p.son_islem_tarihi, r.tarih);
    }
    const people = [...combined.values()].map((c) => {
      const alisBorcu = c.toplam_alis.sub(c.odenen);
      const satisBorcu = c.toplam_satis.sub(c.alinan);
      const alisHas = c.normal_alis_has.add(c.hurda_alis_has);
      const satisHas = c.normal_satis_has.add(c.hurda_satis_has);
      const kalanHas = satisHas.sub(c.tahsil_edilen_has).sub(alisHas).add(c.odedigimiz_has);
      return {
        isim: c.isim,
        toplam_alis: asFloat(c.toplam_alis, MONEY_Q),
        odenen: asFloat(c.odenen, MONEY_Q),
        alis_borcu: asFloat(alisBorcu, MONEY_Q),
        toplam_satis: asFloat(c.toplam_satis, MONEY_Q),
        alinan: asFloat(c.alinan, MONEY_Q),
        satis_borcu: asFloat(satisBorcu, MONEY_Q),
        net_bakiye: asFloat(satisBorcu.sub(alisBorcu), MONEY_Q),
        normal_alis_has: asFloat(c.normal_alis_has, HAS_Q),
        normal_satis_has: asFloat(c.normal_satis_has, HAS_Q),
        hurda_alis_has: asFloat(c.hurda_alis_has, HAS_Q),
        hurda_satis_has: asFloat(c.hurda_satis_has, HAS_Q),
        toplam_alis_has: asFloat(alisHas, HAS_Q),
        toplam_satis_has: asFloat(satisHas, HAS_Q),
        toplam_has: asFloat(alisHas.add(satisHas), HAS_Q),
        odeme_has: asFloat(c.odedigimiz_has.add(c.tahsil_edilen_has), HAS_Q),
        odedigimiz_has: asFloat(c.odedigimiz_has, HAS_Q),
        tahsil_edilen_has: asFloat(c.tahsil_edilen_has, HAS_Q),
        odeyecegimiz_has: asFloat(Dec.max(kalanHas.neg(), ZERO), HAS_Q),
        tahsil_edilecek_has: asFloat(Dec.max(kalanHas, ZERO), HAS_Q),
        kalan_has: asFloat(kalanHas, HAS_Q),
        net_bakiye_has: asFloat(kalanHas, HAS_Q),
        son_islem_tarihi: c.son_islem_tarihi,
      } as Row;
    }).sort((a, b) => cmpStr(normalizeText(a.isim), normalizeText(b.isim)));
    const byKey = new Map(people.map((p) => [normalizeText(p.isim), p]));
    const roleRows = (keys: Set<string>, customer: boolean) =>
      [...keys].sort(cmpStr).map((key) => {
        const p = { ...byKey.get(key)! };
        if (customer) Object.assign(p, { musteri_adi: p.isim, kalan_borc: p.satis_borcu, tip: 'MÜŞTERİ' });
        else Object.assign(p, { tedarikci_adi: p.isim, kalan_borc: p.alis_borcu, tip: 'TEDARİKÇİ' });
        return p;
      });
    this.cariCache = {
      kisiler: people,
      musteriler: roleRows(customerKeys, true),
      tedarikciler: roleRows(supplierKeys, false),
      odemeler: this.s.cari_odeme.map(cariPaymentOut),
      uyari: 'Aynı kişi/firma farklı yazılırsa ayrı cari olarak görünür.',
    };
    return this.cariCache;
  }

  /* ------------------------------ ekstre --------------------------------- */

  /**
   * Bir carinin has hareketleri tarih sırasıyla. İşaretler cari ekranıyla aynıdır:
   * artı = kişi bize borçlu (biz alacaklıyız), eksi = biz kişiye borçluyuz.
   * `tutar` işlemin TL tutarıdır, bilgi içindir; bakiye has üzerinden yürür.
   */
  cariMovements(name: unknown): Row[] {
    const key = normalizeText(name);
    const rows: { tarih: string; sira: number; id: number; islem: string; aciklama: string; gram: Dec; tutar: Dec; has: Dec }[] = [];
    const urun = (r: Row) => [normalizeProduct(r.cinsi), cleanText(r.ayar)].filter(Boolean).join(' ');
    for (const r of this.s.satis) {
      if (normalizeText(r.musteri) !== key) continue;
      rows.push({ tarih: String(r.tarih), sira: 1, id: Number(r.id), islem: 'Satış', aciklama: urun(r), gram: d(r.gram),
        tutar: saleTotal(r), has: d(r.has).sub(d(r.odenen_has)) });
    }
    for (const r of this.s.alis) {
      if (normalizeText(r.tedarikci) !== key) continue;
      rows.push({ tarih: String(r.tarih), sira: 2, id: Number(r.id), islem: 'Alış', aciklama: urun(r), gram: d(r.gram),
        tutar: purchaseTotal(r), has: d(r.has).sub(d(r.odenen_has)).neg() });
    }
    for (const r of this.s.hurda) {
      if (normalizeText(r.kisi) !== key) continue;
      const has = d(r.has).sub(d(r.odenen_has));
      const sale = r.islem_turu !== 'ALIS';
      rows.push({ tarih: String(r.tarih), sira: 3, id: Number(r.id), islem: sale ? 'Hurda satış' : 'Hurda alış', aciklama: urun(r), gram: d(r.gram),
        tutar: scrapTotal(r), has: sale ? has : has.neg() });
    }
    for (const r of this.s.cari_odeme) {
      if (normalizeText(r.isim) !== key) continue;
      const odeme = (r.yon ?? 'TAHSILAT') === 'ODEME';
      rows.push({ tarih: String(r.tarih), sira: 4, id: Number(r.id), islem: odeme ? 'Ödeme (biz ödedik)' : 'Tahsilat', aciklama: cleanText(r.notlar), gram: d(r.gram),
        tutar: ZERO, has: odeme ? d(r.odenen_has) : d(r.odenen_has).neg() });
    }
    rows.sort((a, b) => cmpStr(a.tarih, b.tarih) || a.sira - b.sira || a.id - b.id);
    return rows.map((r) => ({ tarih: r.tarih, islem: r.islem, aciklama: r.aciklama, gram: asFloat(r.gram, NUM_Q), tutar: asFloat(r.tutar, MONEY_Q), has: asFloat(r.has, HAS_Q) }));
  }

  /**
   * Bir ürünün (cinsi + ayar) stok giriş ve çıkışları tarih sırasıyla. Çıkışta has,
   * stok ekranındaki gibi stoktan düşen (alış maliyetindeki) hastır.
   */
  stockMovements(kind: Kind, cinsi: unknown, ayar: unknown): Row[] {
    const rows: { tarih: string; id: number; islem: string; kisi: string; gram: Dec; has: Dec; milyem: unknown }[] = [];
    if (kind === 'normal') {
      const purchases = this.s.alis.filter((r) => sameProduct(r, cinsi, ayar) && !isHurdaProduct(r.cinsi));
      const totalGram = Dec.sum(purchases.map((r) => d(r.gram)));
      const avg = totalGram.gt(ZERO) ? Dec.sum(purchases.map((r) => d(r.has))).div(totalGram) : ZERO;
      for (const r of purchases) rows.push({ tarih: String(r.tarih), id: Number(r.id), islem: 'Alış', kisi: cleanText(r.tedarikci), gram: d(r.gram), has: d(r.has), milyem: r.milyem });
      for (const r of this.s.satis.filter((x) => sameProduct(x, cinsi, ayar) && !isHurdaProduct(x.cinsi))) {
        const purchase = this.alis(salePurchaseId(r));
        const ratio = purchase && d(purchase.gram).gt(ZERO) ? d(purchase.has).div(d(purchase.gram)) : avg;
        const has = Number(r.stoktan) ? this.allocatedStockHas('normal', r) : d(r.gram).mul(ratio);
        rows.push({ tarih: String(r.tarih), id: Number(r.id), islem: 'Satış', kisi: cleanText(r.musteri), gram: d(r.gram).neg(), has: has.neg(), milyem: r.satis_milyem ?? r.milyem });
      }
    } else {
      const items = this.s.hurda.filter((r) => sameProduct(r, cinsi, ayar));
      const buys = items.filter((r) => r.islem_turu === 'ALIS');
      const totalGram = Dec.sum(buys.map((r) => d(r.gram)));
      const avg = totalGram.gt(ZERO) ? Dec.sum(buys.map((r) => d(r.has))).div(totalGram) : ZERO;
      for (const r of items) {
        if (r.islem_turu === 'ALIS') { rows.push({ tarih: String(r.tarih), id: Number(r.id), islem: 'Hurda alış', kisi: cleanText(r.kisi), gram: d(r.gram), has: d(r.has), milyem: r.milyem }); continue; }
        const purchase = this.hurdaAlis(r.hurda_alis_id);
        const has = Number(r.stoktan) ? this.allocatedStockHas('hurda', r)
          : purchase && d(purchase.gram).gt(ZERO) ? d(r.gram).mul(d(purchase.has)).div(d(purchase.gram)) : d(r.gram).mul(avg);
        rows.push({ tarih: String(r.tarih), id: Number(r.id), islem: 'Hurda satış', kisi: cleanText(r.kisi), gram: d(r.gram).neg(), has: has.neg(), milyem: r.milyem });
      }
    }
    rows.sort((a, b) => cmpStr(a.tarih, b.tarih) || Number(b.gram.gt(ZERO)) - Number(a.gram.gt(ZERO)) || a.id - b.id);
    return rows.map((r) => ({ tarih: r.tarih, islem: r.islem, kisi: r.kisi, milyem: asFloat(d(r.milyem ?? 0), NUM_Q), gram: asFloat(r.gram, NUM_Q), has: asFloat(r.has, HAS_Q) }));
  }

  /* ----------------------------- öneriler -------------------------------- */

  suggestions(): Row {
    const products = new Set<string>(PRODUCTS);
    const customers = new Set<unknown>();
    const suppliers = new Set<unknown>();
    const people = new Set<unknown>();
    for (const r of [...this.s.alis].sort(byId)) {
      products.add(normalizeProduct(r.cinsi));
      suppliers.add(r.tedarikci);
      people.add(r.tedarikci);
    }
    for (const r of [...this.s.satis].sort(byId)) {
      products.add(normalizeProduct(r.cinsi));
      customers.add(r.musteri);
      people.add(r.musteri);
    }
    for (const r of [...this.s.hurda].sort(byId)) {
      products.add(normalizeProduct(r.cinsi));
      people.add(r.kisi);
      if (r.islem_turu === 'ALIS') suppliers.add(r.kisi);
      else customers.add(r.kisi);
    }
    const sorted = (values: Set<unknown>) =>
      [...values].map(cleanText).filter(Boolean).sort((a, b) => cmpStr(normalizeText(a), normalizeText(b)));
    return { products: sorted(products), customers: sorted(customers), suppliers: sorted(suppliers), people: sorted(people) };
  }

  /* ----------------------------- dashboard ------------------------------- */

  dashboard(todayText: string): Row {
    const { alis, satis, hurda, giderler } = this.s;
    const stocks = this.stockItems();
    const hurdaStocks = this.hurdaStockItems();
    const cari = this.cariData();
    const saleDates = satis.map((r) => String(r.tarih));
    const dailyDate = saleDates.includes(todayText) ? todayText : saleDates.reduce((m, t) => (m === null || cmpStr(t, m) > 0 ? t : m), null as string | null) ?? todayText;
    const dailyRows = satis.filter((r) => r.tarih === dailyDate);
    const totalProfit = Dec.sum(satis.map((r) => this.saleProfit(r)));
    const dailyProfit = Dec.sum(dailyRows.map((r) => this.saleProfit(r)));
    const hurdaAlis = hurda.filter((r) => r.islem_turu === 'ALIS');
    const hurdaSatis = hurda.filter((r) => r.islem_turu === 'SATIS');
    const hurdaProfitTotal = Dec.sum(hurda.map((r) => this.hurdaProfit(r)));
    const hurdaMilyemProfit = Dec.sum(hurdaSatis.map((r) => d(this.hurdaOut(r).milyem_kari)));
    const kisiler: Row[] = cari.kisiler;
    const alacak = Dec.sum(kisiler.map((r) => Dec.max(d(r.kalan_has), ZERO)));
    const borc = Dec.sum(kisiler.map((r) => Dec.min(d(r.kalan_has), ZERO).neg()));
    const normalStockHas = Dec.sum(stocks.map((i) => d(i.kalan_has)));
    const normalStockGram = Dec.sum(stocks.map((i) => d(i.kalan_gram)));
    const normalStockValue = Dec.sum(stocks.map((i) => d(i.stok_degeri)));
    const hurdaStockHas = Dec.sum(hurdaStocks.map((i) => d(i.kalan_has)));
    const hurdaStockGram = Dec.sum(hurdaStocks.map((i) => d(i.kalan_gram)));
    const hurdaStockValue = Dec.sum(hurdaStocks.map((i) => d(i.stok_degeri)));
    const gross = totalProfit.add(hurdaMilyemProfit);
    const expenses = Dec.sum(giderler.map((r) => d(r.tutar)));
    const purchaseSum = Dec.sum(alis.map(purchaseTotal));
    const saleSum = Dec.sum(satis.map(saleTotal));
    return {
      kar_birimi: 'HAS',
      genel_milyem_kari: asFloat(gross, HAS_Q),
      brut_kar: asFloat(gross, HAS_Q),
      toplam_gider: asFloat(expenses, HAS_Q),
      net_kar: asFloat(gross.sub(expenses), HAS_Q),
      toplam_normal_alis: asFloat(purchaseSum, MONEY_Q),
      toplam_normal_satis: asFloat(saleSum, MONEY_Q),
      toplam_normal_alis_has: asFloat(Dec.sum(alis.map((r) => d(r.has))), HAS_Q),
      toplam_normal_satis_has: asFloat(Dec.sum(satis.map((r) => d(r.has))), HAS_Q),
      toplam_alis: asFloat(purchaseSum, MONEY_Q),
      toplam_satis: asFloat(saleSum, MONEY_Q),
      gunluk_tarih: dailyDate,
      gunluk_satis: asFloat(Dec.sum(dailyRows.map(saleTotal)), MONEY_Q),
      gunluk_urun_kari: asFloat(dailyProfit, HAS_Q),
      genel_urun_kari: asFloat(totalProfit, HAS_Q),
      gunluk_kar: asFloat(dailyProfit, HAS_Q),
      toplam_kar: asFloat(totalProfit, HAS_Q),
      hurda_alis_toplami: asFloat(Dec.sum(hurdaAlis.map(scrapTotal)), MONEY_Q),
      hurda_satis_toplami: asFloat(Dec.sum(hurdaSatis.map(scrapTotal)), MONEY_Q),
      hurda_alis_has_toplami: asFloat(Dec.sum(hurdaAlis.map((r) => d(r.has))), HAS_Q),
      hurda_satis_has_toplami: asFloat(Dec.sum(hurdaSatis.map((r) => d(r.has))), HAS_Q),
      hurda_kar: asFloat(hurdaProfitTotal, MONEY_Q),
      hurda_milyem_kari: asFloat(hurdaMilyemProfit, HAS_Q),
      toplam_musteri_borcu: asFloat(Dec.sum(cari.musteriler.map((r: Row) => d(r.kalan_borc))), MONEY_Q),
      toplam_tedarikci_borcu: asFloat(Dec.sum(cari.tedarikciler.map((r: Row) => d(r.kalan_borc))), MONEY_Q),
      toplam_musteri_has_borcu: asFloat(alacak, HAS_Q),
      musteri_emanet_has: asFloat(borc, HAS_Q),
      toplam_tedarikci_has_borcu: asFloat(borc, HAS_Q),
      tedarikci_alacak_has: asFloat(alacak, HAS_Q),
      net_cari_alacak_has: asFloat(alacak, HAS_Q),
      net_cari_borc_has: asFloat(borc, HAS_Q),
      alacakli_cari_sayisi: kisiler.filter((r) => d(r.kalan_has).gt(ZERO)).length,
      borclu_cari_sayisi: kisiler.filter((r) => d(r.kalan_has).lt(ZERO)).length,
      normal_stok_has: asFloat(normalStockHas, HAS_Q),
      normal_stok_gram: asFloat(normalStockGram, NUM_Q),
      normal_stok_degeri: asFloat(normalStockValue, MONEY_Q),
      toplam_stok_has: asFloat(normalStockHas.add(hurdaStockHas), HAS_Q),
      stok_degeri: asFloat(normalStockValue.add(hurdaStockValue), MONEY_Q),
      hurda_kalan_has: asFloat(hurdaStockHas, HAS_Q),
      hurda_kalan_gram: asFloat(hurdaStockGram, NUM_Q),
      hurda_stok_degeri: asFloat(hurdaStockValue, MONEY_Q),
      uyari_sayisi: [...stocks, ...hurdaStocks].filter((i) => i.uyari).length,
      alis_adedi: alis.length,
      satis_adedi: satis.length,
      hurda_adedi: hurda.length,
      // TL karşılıkları (bulut sürümü): satış tutarı − stok maliyeti; hurda için hurda kârı.
      toplam_tl_kar: asFloat(Dec.sum(satis.map((r) => saleTotal(r).sub(this.salePurchaseCost(r)))).add(hurdaProfitTotal), MONEY_Q),
      gunluk_tl_kar: asFloat(Dec.sum(dailyRows.map((r) => saleTotal(r).sub(this.salePurchaseCost(r)))), MONEY_Q),
      son_7_gun: this.lastDays(todayText, 7),
    };
  }

  /** Son `n` günün TL satış, alış ve kârı (grafik için; normal + hurda). */
  lastDays(todayText: string, n: number): Row[] {
    const base = Date.parse(`${todayText}T00:00:00Z`);
    if (Number.isNaN(base)) return [];
    return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86400000).toISOString().slice(0, 10)).map((day) => {
      const sales = this.s.satis.filter((r) => r.tarih === day);
      const purchases = this.s.alis.filter((r) => r.tarih === day);
      const scrap = this.s.hurda.filter((r) => r.tarih === day);
      const scrapSales = scrap.filter((r) => r.islem_turu === 'SATIS');
      return {
        tarih: day,
        satis_tl: asFloat(Dec.sum(sales.map(saleTotal)).add(Dec.sum(scrapSales.map(scrapTotal))), MONEY_Q),
        alis_tl: asFloat(Dec.sum(purchases.map(purchaseTotal)).add(Dec.sum(scrap.filter((r) => r.islem_turu === 'ALIS').map(scrapTotal))), MONEY_Q),
        kar_tl: asFloat(Dec.sum(sales.map((r) => saleTotal(r).sub(this.salePurchaseCost(r)))).add(Dec.sum(scrapSales.map((r) => this.hurdaProfit(r)))), MONEY_Q),
        satis_has: asFloat(Dec.sum(sales.map((r) => d(r.has))).add(Dec.sum(scrapSales.map((r) => d(r.has)))), HAS_Q),
        islem_sayisi: sales.length + purchases.length + scrap.length,
      };
    });
  }
}

export function cariPaymentOut(row: Row): Row {
  const item = rowDict(row);
  item.odenen_has = asFloat(row.odenen_has, HAS_Q);
  item.hesaplanan_has = item.odenen_has;
  item.yon = row.yon ?? 'TAHSILAT';
  item.not = item.not ?? '';
  return item;
}

/** Python `str(float)` biçimi: tam sayılar "5.0" olarak yazılır. */
export function pyFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function byId(a: Row, b: Row): number {
  return Number(a.id) - Number(b.id);
}
