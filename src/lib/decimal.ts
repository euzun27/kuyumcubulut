/**
 * Kesin ondalık sayı (Python Decimal karşılığı).
 *
 * Gram, milyem, has ve TL hesapları float ile yapılırsa 0,1 + 0,2 gibi
 * yuvarlama hataları birikir. Değerler katsayı × 10^üs olarak BigInt ile
 * tutulur ve masaüstü sürümdeki Python `decimal` modülünün varsayılan
 * bağlamıyla aynı davranır: her işlem sonucu 28 anlamlı basamağa
 * ROUND_HALF_EVEN ile yuvarlanır, sondaki sıfırlar (örn. "18000.0000")
 * Python'daki gibi korunur. Çıktı yuvarlaması `q()` ile ROUND_HALF_UP'tır.
 */

const PREC = 28;

export class InvalidNumber extends Error {}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function digits(c: bigint): number {
  return (c < 0n ? -c : c).toString().length;
}

/** c / 10^n, en yakına (eşitlikte çifte) yuvarlanmış. */
function shiftHalfEven(c: bigint, n: number): bigint {
  const negative = c < 0n;
  const x = negative ? -c : c;
  const unit = pow10(n);
  let q = x / unit;
  const r2 = (x % unit) * 2n;
  if (r2 > unit || (r2 === unit && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/** Python `_fix`: katsayıyı en fazla 28 basamağa indirir. */
function fix(c: bigint, e: number): Dec {
  const n = digits(c);
  if (c !== 0n && n > PREC) {
    let drop = n - PREC;
    let coef = shiftHalfEven(c, drop);
    if (digits(coef) > PREC) {
      coef /= 10n;
      drop += 1;
    }
    return new Dec(coef, e + drop);
  }
  return new Dec(c, e);
}

function parse(text: string): Dec | null {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.replace(/_/g, ''));
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] || '';
  const coef = BigInt((m[2] || '') + frac || '0');
  const exp = (m[4] ? parseInt(m[4], 10) : 0) - frac.length;
  return new Dec(m[1] === '-' ? -coef : coef, exp);
}

/** Python'daki `str(float)` ile aynı basamakları üretir (900 -> "900.0"). */
function floatRepr(value: number): string {
  if (Number.isInteger(value)) return Math.abs(value) >= 1e16 ? value.toExponential() : value.toFixed(1);
  return String(value);
}

/** Koddaki sabitler ve JSON tamsayıları: Python `Decimal("1000")` gibi. */
function lit(value: Dec | number): Dec {
  if (value instanceof Dec) return value;
  const parsed = parse(String(value));
  if (!parsed) throw new InvalidNumber(`Geçersiz sayı: ${value}`);
  return parsed;
}

export class Dec {
  /** Değer = c × 10^e */
  readonly c: bigint;
  readonly e: number;

  constructor(c: bigint, e: number) {
    this.c = c;
    this.e = e;
  }

  static readonly ZERO = new Dec(0n, 0);

  /**
   * Python `d()` ile aynı: boş değer 0, virgül nokta kabul edilir.
   * Sayılar veritabanındaki REAL değerler gibi (Python float) yorumlanır.
   */
  static from(value: unknown): Dec {
    if (value instanceof Dec) return value;
    if (value === null || value === undefined || value === '') return Dec.ZERO;
    if (typeof value === 'bigint') return new Dec(value, 0);
    let text: string;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new InvalidNumber(`Geçersiz sayı: ${value}`);
      text = floatRepr(value);
    } else if (typeof value === 'string') {
      text = value;
    } else {
      throw new InvalidNumber(`Geçersiz sayı: ${String(value)}`);
    }
    const parsed = parse(text.trim().replace(/ /g, '').replace(/,/g, '.'));
    if (parsed === null) throw new InvalidNumber(`Geçersiz sayı: ${String(value)}`);
    return parsed;
  }

  /** İstek gövdesinden gelen değer: JSON tamsayısı Python'da `int` olur. */
  static fromJson(value: unknown): Dec {
    return typeof value === 'number' && Number.isFinite(value) ? lit(value) : Dec.from(value);
  }

  add(o: Dec | number): Dec {
    const b = lit(o);
    const e = Math.min(this.e, b.e);
    return fix(this.c * pow10(this.e - e) + b.c * pow10(b.e - e), e);
  }
  sub(o: Dec | number): Dec {
    return this.add(lit(o).neg());
  }
  mul(o: Dec | number): Dec {
    const b = lit(o);
    return fix(this.c * b.c, this.e + b.e);
  }
  /** Python `__truediv__` (kesin bölünürse ideal üs korunur). */
  div(o: Dec | number): Dec {
    const b = lit(o);
    if (b.c === 0n) throw new Error('Sıfıra bölme hatası.');
    const ideal = this.e - b.e;
    if (this.c === 0n) return new Dec(0n, ideal);
    const negative = (this.c < 0n) !== (b.c < 0n);
    const x = this.c < 0n ? -this.c : this.c;
    const y = b.c < 0n ? -b.c : b.c;
    const shift = digits(y) - digits(x) + PREC + 1;
    let exp = this.e - b.e - shift;
    let coef: bigint;
    let rem: bigint;
    if (shift >= 0) {
      coef = (x * pow10(shift)) / y;
      rem = (x * pow10(shift)) % y;
    } else {
      coef = x / (y * pow10(-shift));
      rem = x % (y * pow10(-shift));
    }
    if (rem !== 0n) {
      if (coef % 5n === 0n) coef += 1n;
    } else {
      while (exp < ideal && coef % 10n === 0n) {
        coef /= 10n;
        exp += 1;
      }
    }
    return fix(negative ? -coef : coef, exp);
  }
  neg(): Dec {
    return new Dec(-this.c, this.e);
  }
  abs(): Dec {
    return this.c < 0n ? this.neg() : this;
  }
  cmp(o: Dec | number): number {
    const b = lit(o);
    const e = Math.min(this.e, b.e);
    const x = this.c * pow10(this.e - e);
    const y = b.c * pow10(b.e - e);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  eq(o: Dec | number): boolean {
    return this.cmp(o) === 0;
  }
  gt(o: Dec | number): boolean {
    return this.cmp(o) > 0;
  }
  ge(o: Dec | number): boolean {
    return this.cmp(o) >= 0;
  }
  lt(o: Dec | number): boolean {
    return this.cmp(o) < 0;
  }
  le(o: Dec | number): boolean {
    return this.cmp(o) <= 0;
  }
  isZero(): boolean {
    return this.c === 0n;
  }
  isNeg(): boolean {
    return this.c < 0n;
  }

  /** ROUND_HALF_UP ile `places` basamağa yuvarlar (Python quantize). */
  q(places: number): Dec {
    const target = -places;
    if (this.e >= target) return new Dec(this.c * pow10(this.e - target), target);
    const unit = pow10(target - this.e);
    const x = this.c < 0n ? -this.c : this.c;
    let n = x / unit;
    if ((x % unit) * 2n >= unit) n += 1n;
    return new Dec(this.c < 0n ? -n : n, target);
  }

  /** Python `str(Decimal)` ile aynı metin (örn. "2.748", "18000.0000", "1E+3"). */
  toString(): string {
    const sign = this.c < 0n ? '-' : '';
    const int = (this.c < 0n ? -this.c : this.c).toString();
    const left = this.e + int.length;
    const dot = this.e <= 0 && left > -6 ? left : 1;
    let intPart: string;
    let fracPart: string;
    if (dot <= 0) {
      intPart = '0';
      fracPart = '.' + '0'.repeat(-dot) + int;
    } else if (dot >= int.length) {
      intPart = int + '0'.repeat(dot - int.length);
      fracPart = '';
    } else {
      intPart = int.slice(0, dot);
      fracPart = '.' + int.slice(dot);
    }
    const exp = left === dot ? '' : `E${left - dot >= 0 ? '+' : ''}${left - dot}`;
    return sign + intPart + fracPart + exp;
  }

  toNumber(): number {
    return Number(this.toString());
  }

  /** Python `max(a, b)`: eşitlikte ilk değer. */
  static max(a: Dec, b: Dec): Dec {
    return b.cmp(a) > 0 ? b : a;
  }
  /** Python `min(a, b)`: eşitlikte ilk değer. */
  static min(a: Dec, b: Dec): Dec {
    return b.cmp(a) < 0 ? b : a;
  }
  /** Python `sum(values, ZERO)`. */
  static sum(values: Iterable<Dec>): Dec {
    let total: Dec = Dec.ZERO;
    for (const v of values) total = total.add(v);
    return total;
  }
}

export const d = Dec.from;
export const ZERO = Dec.ZERO;
export const MONEY_Q = 2;
export const HAS_Q = 3;
export const NUM_Q = 3;

/** Python `as_float(value, precision)`: yuvarlayıp sayıya çevirir. */
export function asFloat(value: unknown, places: number = MONEY_Q): number {
  return d(value).q(places).toNumber();
}
