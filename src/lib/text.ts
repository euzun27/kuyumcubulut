/** Metin normalleştirme: aynı kişi/ürün farklı yazılsa da eşleşsin. */

export const PRODUCTS = [
  'BİLEZİK',
  'YÜZÜK',
  'KOLYE',
  'KÜPE',
  'BİLEKLİK',
  'ZİNCİR',
  'KOLYE UCU',
  'SET',
  'ÇEYREK',
  'YARIM',
  'TAM',
  'GRAM ALTIN',
  'REŞAT',
  'REŞAT ÇEYREK',
  'REŞAT YARIM',
  'REŞAT TAM',
  'REŞAT GREMSE',
  'REŞAT BEŞLİ',
  'ATA LİRA',
  'CUMHURİYET',
  'GREMSE',
  'BEŞLİ',
  'DİĞER',
];

/** Python `str(value or "").strip()` */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return '';
  return String(value).trim();
}

/**
 * Kişi / firma adı: cari, ekstre ve fişlerde aynı görünsün diye Türkçe kurala
 * göre büyük harf (i -> İ, ı -> I) ve tek boşluk.
 */
export function personName(value: unknown): string {
  return cleanText(value).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
}

/** Büyük/küçük harf, Türkçe ı/İ ve aksan farklarını yok sayan anahtar. */
export function normalizeText(value: unknown): string {
  const text = cleanText(value).toLowerCase().replace(/ß/g, 'ss').replace(/ı/g, 'i');
  return text.normalize('NFKD').replace(/\p{M}/gu, '');
}

const PRODUCT_KEYS = new Map(PRODUCTS.map((p) => [normalizeText(p), p]));

export function normalizeProduct(value: unknown): string {
  const text = cleanText(value);
  return PRODUCT_KEYS.get(normalizeText(text)) ?? text;
}

export function isHurdaProduct(value: unknown): boolean {
  return normalizeText(value).includes('hurda');
}

export function normalizeIslemTuru(value: unknown): 'ALIS' | 'SATIS' {
  const key = normalizeText(value).replace(/ /g, '');
  if (key === 'alis' || key === 'al') return 'ALIS';
  if (key === 'satis' || key === 'sat') return 'SATIS';
  throw new Error('İşlem türü ALIŞ veya SATIŞ olmalı.');
}

export function displayIslemTuru(value: unknown): 'ALIS' | 'SATIS' {
  return cleanText(value) === 'ALIS' ? 'ALIS' : 'SATIS';
}

/** Python'daki gibi kod noktası sırasıyla karşılaştırır. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function cmpTuple(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpStr(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}
