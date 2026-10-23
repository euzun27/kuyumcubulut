/**
 * İstek doğrulama. Masaüstü sürümdeki (Pydantic) kuralların birebir karşılığı:
 * alanlar tanım sırasıyla kontrol edilir, ilk hata 422 ile döner.
 */

import { Dec, InvalidNumber, d, ZERO, HAS_Q } from './decimal';
import { cleanText, normalizeText, personName, normalizeProduct, isHurdaProduct, normalizeIslemTuru } from './text';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 422 doğrulama hatası. */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(422, message);
  }
}

type Body = Record<string, unknown>;
const MISSING = Symbol('missing');

function get(body: Body, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(body, name) ? body[name] : MISSING;
}

/** Değer hatasını (ValueError) doğrulama hatasına çevirir. */
function check<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new ValidationError(String((e as Error)?.message || e));
  }
}

type StrOpts = { default?: string; strip?: boolean; min?: number; max?: number };

function str(body: Body, name: string, opts: StrOpts = {}): string {
  const raw = get(body, name);
  if (raw === MISSING) {
    if (opts.default === undefined) throw new ValidationError('Bu alan zorunlu.');
    return opts.default;
  }
  if (typeof raw !== 'string') throw new ValidationError('Metin girilmelidir.');
  const value = opts.strip === false ? raw : raw.trim();
  if (opts.min !== undefined && [...value].length < opts.min) throw new ValidationError(`En az ${opts.min} karakter girilmelidir.`);
  if (opts.max !== undefined && [...value].length > opts.max) throw new ValidationError(`En fazla ${opts.max} karakter girilebilir.`);
  return value;
}

function any(body: Body, name: string, fallback: unknown = ZERO): unknown {
  const raw = get(body, name);
  return raw === MISSING ? fallback : raw;
}

function optInt(body: Body, name: string): number | null {
  const raw = get(body, name);
  if (raw === MISSING || raw === null) return null;
  return toInt(raw);
}

function toInt(raw: unknown): number {
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) throw new ValidationError('Tam sayı girilmelidir.');
    return raw;
  }
  if (typeof raw === 'string' && /^[+-]?\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  throw new ValidationError('Tam sayı girilmelidir.');
}

const TRUE_WORDS = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_WORDS = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

function bool(body: Body, name: string, fallback = false): boolean {
  const raw = get(body, name);
  if (raw === MISSING) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 0 || raw === 1) return raw === 1;
  if (typeof raw === 'string') {
    const key = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(key)) return true;
    if (FALSE_WORDS.has(key)) return false;
  }
  throw new ValidationError('Evet/hayır değeri girilmelidir.');
}

export function nonNegative(value: unknown, field: string): Dec {
  let number: Dec;
  try {
    number = Dec.fromJson(value);
  } catch (e) {
    if (e instanceof InvalidNumber) throw new ValidationError(e.message);
    throw e;
  }
  if (number.isNeg()) throw new ValidationError(`${field} negatif olamaz.`);
  return number;
}

export function calcHas(gram: unknown, milyem: unknown): Dec {
  return d(gram).mul(d(milyem)).div(1000).q(HAS_Q);
}

export type OdemeTipi = 'ODEME_YOK' | 'HAS' | 'ADET_GRAM_MILYEM' | 'TAM_KAPAT';

export function normalizeOdemeTipi(value: unknown): OdemeTipi {
  const key = normalizeText(value).replace(/ /g, '_');
  if (['', 'odeme_yok', 'yok', 'none'].includes(key)) return 'ODEME_YOK';
  if (['has', 'has_ile_odeme'].includes(key)) return 'HAS';
  if (['gram_milyem', 'gram+milyem', 'adet_gram_milyem', 'adet+gram+milyem', 'milyem'].includes(key)) return 'ADET_GRAM_MILYEM';
  if (['tam', 'borcu_tam_kapat', 'tam_kapat'].includes(key)) return 'TAM_KAPAT';
  throw new ValidationError('Ödeme tipi geçersiz.');
}

export function calcTransactionPayment(p: TxPayload, transactionHas: Dec): Dec {
  if (p.odeme_tipi === 'ODEME_YOK') return ZERO;
  if (p.odeme_tipi === 'HAS') return p.odenen_has.q(HAS_Q);
  if (p.odeme_tipi === 'TAM_KAPAT') return transactionHas.q(HAS_Q);
  return calcHas(p.odenen_gram, p.odenen_milyem);
}

/** Bugünün tarihi (YYYY-MM-DD), dükkânın saat diliminde. */
export function today(tz = 'Europe/Istanbul'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* ------------------------------------------------------------------ */
/* İşlem (alış / satış / hurda) gövdeleri                              */
/* ------------------------------------------------------------------ */

export type TxPayload = {
  tarih: string;
  cinsi: string;
  ayar: string;
  adet: Dec;
  gram: Dec;
  milyem: Dec;
  has_fiyati: Dec;
  iscilik: Dec;
  notlar: string;
  has_override: Dec | null;
  stoktan: boolean;
  odeme_tipi: OdemeTipi;
  odenen_has: Dec;
  odenen_adet: Dec;
  odenen_gram: Dec;
  odenen_milyem: Dec;
};

export type AlisPayload = TxPayload & { tedarikci: string; ek_masraf: Dec; odenen: Dec };
export type SatisPayload = TxPayload & {
  musteri: string;
  ek_ucret: Dec;
  indirim: Dec;
  alinan: Dec;
  alis_id: number | null;
};
export type HurdaPayload = TxPayload & {
  islem_turu: 'ALIS' | 'SATIS';
  kisi: string;
  hurda_alis_id: number | null;
  odenen_veya_alinan: Dec;
};

function requiredText(body: Body, name: string, message: string): string {
  const value = cleanText(str(body, name));
  if (!value) throw new ValidationError(message);
  return value;
}

type RawTx = Record<string, unknown>;

function baseFields(body: Body, tz: string): RawTx {
  return {
    tarih: str(body, 'tarih', { default: today(tz) }),
    cinsi: normalizeProduct(requiredText(body, 'cinsi', 'Bu alan zorunlu.')),
    ayar: requiredText(body, 'ayar', 'Bu alan zorunlu.'),
    adet: any(body, 'adet'),
    gram: any(body, 'gram'),
    milyem: any(body, 'milyem'),
    has_fiyati: any(body, 'has_fiyati'),
    iscilik: any(body, 'iscilik'),
    notlar: str(body, 'notlar', { default: '', max: 500 }),
    has_override: any(body, 'has_override', null),
    stoktan: bool(body, 'stoktan'),
    odeme_tipi: str(body, 'odeme_tipi', { default: 'ODEME_YOK' }),
    odenen_has: any(body, 'odenen_has'),
    odenen_adet: any(body, 'odenen_adet', ''),
    odenen_gram: any(body, 'odenen_gram'),
    odenen_milyem: any(body, 'odenen_milyem'),
  };
}

function baseNumbers(raw: RawTx): TxPayload {
  return check(() => {
    const adet = cleanText(raw.adet) !== '' ? nonNegative(raw.adet, 'adet') : ZERO;
    const gram = nonNegative(raw.gram, 'gram');
    const milyem = nonNegative(raw.milyem, 'milyem');
    const has_fiyati = nonNegative(raw.has_fiyati, 'has_fiyati');
    const iscilik = nonNegative(raw.iscilik, 'iscilik');
    const has_override = raw.has_override === null ? null : nonNegative(raw.has_override, 'has_override');
    const odeme_tipi = normalizeOdemeTipi(raw.odeme_tipi);
    const odenen_has = nonNegative(raw.odenen_has, 'odenen_has');
    if (cleanText(raw.odenen_adet) !== '') nonNegative(raw.odenen_adet, 'odenen_adet');
    const odenen_gram = nonNegative(raw.odenen_gram, 'odenen_gram');
    const odenen_milyem = nonNegative(raw.odenen_milyem, 'odenen_milyem');
    return {
      tarih: raw.tarih as string,
      cinsi: normalizeProduct(raw.cinsi),
      ayar: cleanText(raw.ayar),
      adet, // bulut sürümü: sarrafiye (çeyrek, yarım...) için adet saklanır
      gram,
      milyem,
      has_fiyati,
      iscilik,
      notlar: raw.notlar as string,
      has_override,
      stoktan: raw.stoktan as boolean,
      odeme_tipi,
      odenen_has,
      odenen_adet: ZERO,
      odenen_gram,
      odenen_milyem,
    };
  });
}

export function parseAlis(body: Body, tz: string): AlisPayload {
  const raw = baseFields(body, tz);
  const tedarikci = personName(requiredText(body, 'tedarikci', 'Tedarikçi zorunlu.'));
  const ekMasraf = any(body, 'ek_masraf');
  const odenen = any(body, 'odenen');
  const base = baseNumbers(raw);
  return check(() => {
    if (isHurdaProduct(base.cinsi)) throw new ValidationError('Hurda ALIŞ sayfasına girilemez. HURDA sayfasını kullanın.');
    return { ...base, tedarikci, ek_masraf: nonNegative(ekMasraf, 'ek_masraf'), odenen: nonNegative(odenen, 'odenen') };
  });
}

export function parseSatis(body: Body, tz: string): SatisPayload {
  const raw = baseFields(body, tz);
  const musteri = personName(requiredText(body, 'musteri', 'Müşteri zorunlu.'));
  const satisMilyem = any(body, 'satis_milyem', null);
  const ekUcret = any(body, 'ek_ucret');
  const indirim = any(body, 'indirim');
  const alinan = any(body, 'alinan');
  const alisId = optInt(body, 'alis_id');
  const purchaseId = optInt(body, 'purchase_id');
  const base = baseNumbers(raw);
  return check(() => {
    if (satisMilyem !== null && cleanText(satisMilyem) !== '') base.milyem = nonNegative(satisMilyem, 'satis_milyem');
    const payload: SatisPayload = {
      ...base,
      musteri,
      ek_ucret: nonNegative(ekUcret, 'ek_ucret'),
      indirim: nonNegative(indirim, 'indirim'),
      alinan: nonNegative(alinan, 'alinan'),
      alis_id: alisId || purchaseId || null,
    };
    if (!payload.alis_id && !payload.stoktan) throw new ValidationError('Satış için alıştan ürün seçilmeli.');
    return payload;
  });
}

export function parseHurda(body: Body, tz: string): HurdaPayload {
  const raw = baseFields(body, tz);
  const islem = check(() => normalizeIslemTuru(str(body, 'islem_turu')));
  const kisi = personName(requiredText(body, 'kisi', 'Kişi zorunlu.'));
  const hurdaRaw = get(body, 'hurda_alis_id');
  let hurdaAlisId: number | null = null;
  if (hurdaRaw !== MISSING && hurdaRaw !== null && cleanText(hurdaRaw) !== '') {
    if (typeof hurdaRaw === 'number' && Number.isFinite(hurdaRaw)) hurdaAlisId = Math.trunc(hurdaRaw);
    else if (typeof hurdaRaw === 'boolean') hurdaAlisId = hurdaRaw ? 1 : 0;
    else if (typeof hurdaRaw === 'string' && /^\s*[+-]?\d+\s*$/.test(hurdaRaw)) hurdaAlisId = parseInt(hurdaRaw, 10);
    else throw new ValidationError('Hurda alış seçimi geçersiz.');
  }
  const odenenVeyaAlinan = any(body, 'odenen_veya_alinan');
  const base = baseNumbers(raw);
  return check(() => ({
    ...base,
    islem_turu: islem,
    kisi,
    hurda_alis_id: hurdaAlisId,
    odenen_veya_alinan: nonNegative(odenenVeyaAlinan, 'odenen_veya_alinan'),
  }));
}

/* ------------------------------------------------------------------ */
/* Cari                                                                */
/* ------------------------------------------------------------------ */

export type CariOdemePayload = {
  tarih: string;
  isim: string;
  odeme_tipi: 'HAS' | 'ADET_GRAM_MILYEM' | 'TAM_KAPAT';
  yon: 'OTOMATIK' | 'TAHSILAT' | 'ODEME';
  odenen_has: Dec;
  adet: Dec;
  gram: Dec;
  milyem: Dec;
  notlar: string;
};

export function parseCariOdeme(body: Body, tz: string): CariOdemePayload {
  const tarih = str(body, 'tarih', { default: today(tz) });
  const isim = personName(requiredText(body, 'isim', 'Cari kişi/firma zorunlu.'));
  const tipKey = normalizeText(str(body, 'odeme_tipi', { default: 'HAS' })).replace(/ /g, '_');
  let odeme_tipi: CariOdemePayload['odeme_tipi'];
  if (['has', 'has_ile_odeme'].includes(tipKey)) odeme_tipi = 'HAS';
  else if (['gram_milyem', 'gram+milyem', 'adet_gram_milyem', 'adet+gram+milyem', 'milyem'].includes(tipKey)) odeme_tipi = 'ADET_GRAM_MILYEM';
  else if (['tam', 'borcu_tam_kapat', 'tam_kapat'].includes(tipKey)) odeme_tipi = 'TAM_KAPAT';
  else throw new ValidationError('Ödeme tipi geçersiz.');
  const yonKey = normalizeText(str(body, 'yon', { default: 'OTOMATIK' })).replace(/ /g, '_');
  let yon: CariOdemePayload['yon'];
  if (['otomatik', 'auto'].includes(yonKey)) yon = 'OTOMATIK';
  else if (['tahsilat', 'musteriden_tahsilat', 'alinan'].includes(yonKey)) yon = 'TAHSILAT';
  else if (['odeme', 'tedarikciye_odeme', 'odenmis'].includes(yonKey)) yon = 'ODEME';
  else throw new ValidationError('Cari ödeme yönü geçersiz.');
  const odenenHas = any(body, 'odenen_has');
  const gramRaw = any(body, 'gram');
  const milyemRaw = any(body, 'milyem');
  const notlar = str(body, 'notlar', { default: '', max: 500 });
  return check(() => {
    const gram = nonNegative(gramRaw, 'gram');
    const milyem = nonNegative(milyemRaw, 'milyem');
    let odenen_has = ZERO;
    if (odeme_tipi === 'ADET_GRAM_MILYEM') odenen_has = calcHas(gram, milyem);
    else if (odeme_tipi === 'HAS') odenen_has = nonNegative(odenenHas, 'odenen_has');
    return { tarih, isim, odeme_tipi, yon, odenen_has, adet: ZERO, gram, milyem, notlar };
  });
}

export function parseCariRename(body: Body): { eski_isim: string; yeni_isim: string } {
  const eski = cleanText(str(body, 'eski_isim', { strip: false }));
  const yeni = personName(str(body, 'yeni_isim', { strip: false }));
  if (!eski || !yeni) throw new ValidationError('Eski ve yeni cari adı zorunlu.');
  return { eski_isim: eski, yeni_isim: yeni };
}

export function parseCariDelete(body: Body): { isim: string } {
  const isim = cleanText(str(body, 'isim', { strip: false }));
  if (!isim) throw new ValidationError('Cari adı zorunlu.');
  return { isim };
}

/* ------------------------------------------------------------------ */
/* Gider ve ayarlar                                                    */
/* ------------------------------------------------------------------ */

/** `tutar` has'tır; TL girilen giderde `tl_tutar` dolu, `tutar` API'de has fiyatıyla hesaplanır. */
export type GiderPayload = { tarih: string; tutar: Dec | null; tl_tutar: Dec | null; has_fiyati: Dec | null; kategori: string; notlar: string };

function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, day] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

export function parseGider(body: Body, tz: string): GiderPayload {
  const rawTarih = get(body, 'tarih');
  let tarih = today(tz);
  if (rawTarih !== MISSING) {
    if (typeof rawTarih !== 'string' || !isValidDate(rawTarih.trim())) throw new ValidationError('Geçerli bir tarih girilmelidir (YYYY-AA-GG).');
    tarih = rawTarih.trim();
  }
  const amount = (key: string, label: string, decimals: number): Dec | null => {
    const raw = get(body, key);
    if (raw === MISSING || raw === null || raw === '') return null;
    let text: string;
    if (typeof raw === 'number' && Number.isFinite(raw)) text = String(raw);
    else if (typeof raw === 'string') text = raw.trim();
    else throw new ValidationError(`Geçerli bir ${label} girilmelidir.`);
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) throw new ValidationError(`Geçerli bir ${label} girilmelidir.`);
    const value = d(text);
    if (!value.gt(ZERO)) throw new ValidationError(`${label[0].toLocaleUpperCase('tr-TR')}${label.slice(1)} 0'dan büyük olmalıdır.`);
    const [whole, frac = ''] = value.toString().split('.');
    if (frac.length > decimals) throw new ValidationError(`${label[0].toLocaleUpperCase('tr-TR')}${label.slice(1)} en fazla ${decimals} ondalık basamak içerebilir.`);
    if (whole.replace(/^0+/, '').length + frac.length > 14 || whole.replace(/^0+/, '').length > 11) throw new ValidationError('Tutar çok büyük.');
    return value;
  };
  const tl_tutar = amount('tl_tutar', 'TL tutarı', 2);
  const has_fiyati = amount('has_fiyati', 'has fiyatı', 2);
  // TL girildiyse has karşılığı API'de hesaplanır; girilmediyse has tutarı zorunludur.
  const tutar = tl_tutar ? null : amount('tutar', 'tutar', 3);
  if (!tl_tutar && !tutar) {
    if (get(body, 'tutar') === MISSING) throw new ValidationError('Bu alan zorunlu.');
    throw new ValidationError('Geçerli bir tutar girilmelidir.');
  }
  const kategori = str(body, 'kategori', { min: 1, max: 100 });
  const notlar = str(body, 'notlar', { default: '', max: 500 });
  return { tarih, tutar, tl_tutar, has_fiyati: tl_tutar ? has_fiyati : null, kategori, notlar };
}

export function parseUiSettings(body: Body): { backup_frequency: 'daily' | 'startup' } {
  const value = str(body, 'backup_frequency', { strip: false });
  if (value !== 'daily' && value !== 'startup') throw new ValidationError('Geçersiz yedekleme sıklığı.');
  return { backup_frequency: value };
}

export function parseId(value: string | undefined): number {
  if (!value || !/^[+-]?\d+$/.test(value)) throw new ValidationError('Kayıt numarası geçersiz.');
  return parseInt(value, 10);
}
