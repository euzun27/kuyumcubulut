/**
 * Masaüstü sürümün lisansı.
 *
 * Her bilgisayarın bir makine kodu vardır (Windows MachineGuid'den türetilir).
 * Dünyatek, yalnızca kendisinde duran özel anahtarla bu koda özel bir lisans
 * anahtarı imzalar (Ed25519). Program anahtarı içindeki açık anahtarla doğrular;
 * başka bilgisayarda makine kodu tutmadığı için çalışmaz.
 *
 * Anahtar biçimi: DT1-<base64url(JSON)>.<base64url(imza)>
 *   JSON: { v: 1, f: firma, m: makine kodu, b: başlangıç, s: bitiş | null }
 *
 * Lisans yoksa ilk açılıştan itibaren DENEME_GUN gün deneme; süre bitince
 * program yalnızca görüntüleme modunda çalışır, veriler silinmez.
 */

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export const DENEME_GUN = 15;

/** Lisans imzalarını doğrulayan açık anahtar (özel anahtar yalnızca Dünyatek'te). */
const PUBLIC_KEY = createPublicKey({
  key: { kty: 'OKP', crv: 'Ed25519', x: 'XaQdbxF_hoMAihj8dLCdU-V3Iz9jBdUc_Zg28qKoI3c' },
  format: 'jwk',
});

export type LisansBilgisi = { v: 1; f: string; m: string; b: string; s: string | null };

export type LisansDurumu = {
  durum: 'lisansli' | 'deneme' | 'bitti';
  makine_kodu: string;
  firma: string | null;
  bitis: string | null;
  kalan_gun: number | null;
  mesaj: string;
};

/** Makine kodu: XXXX-XXXX-XXXX-XXXX (büyük harf, onaltılık). */
export function makineKodu(machineId: string): string {
  const hex = createHash('sha256').update(`dunyatek-kuyumcu|${machineId.trim().toLowerCase()}`).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

/** Lisans anahtarını doğrular; geçersizse açıklayıcı bir hata fırlatır. */
export function anahtarCoz(anahtar: string, makine: string, publicKey: KeyObject = PUBLIC_KEY): LisansBilgisi {
  const temiz = anahtar.replace(/\s+/g, '');
  const m = /^DT1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(temiz);
  if (!m) throw new Error('Lisans anahtarı biçimi hatalı. Size gönderilen anahtarın tamamını yapıştırın.');
  const veri = Buffer.from(m[1], 'base64url');
  if (!verify(null, veri, publicKey, Buffer.from(m[2], 'base64url'))) throw new Error('Lisans anahtarı geçersiz.');
  const bilgi = JSON.parse(veri.toString('utf8')) as LisansBilgisi;
  if (bilgi.v !== 1 || typeof bilgi.m !== 'string') throw new Error('Lisans anahtarı bu sürümle uyumlu değil.');
  if (bilgi.m !== makine) throw new Error(`Bu anahtar başka bir bilgisayar için üretilmiş (${bilgi.m}). Bu bilgisayarın makine kodu: ${makine}`);
  return bilgi;
}

/**
 * Parola sıfırlama kodu: DP1-<base64url(JSON)>.<base64url(imza)>
 *   JSON: { v: 1, t: 'parola', m: makine kodu, r: istek kodu }
 * İstek kodu programın "Parolamı unuttum" ekranında rastgele üretilir ve bir kez
 * kullanılır; kod başka bilgisayarda veya eski bir istekle çalışmaz.
 */
export function parolaKoduCoz(kod: string, makine: string, istek: string, publicKey: KeyObject = PUBLIC_KEY) {
  const m = /^DP1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(kod.replace(/\s+/g, ''));
  if (!m) throw new Error('Sıfırlama kodu biçimi hatalı. Size verilen kodun tamamını yapıştırın.');
  const veri = Buffer.from(m[1], 'base64url');
  if (!verify(null, veri, publicKey, Buffer.from(m[2], 'base64url'))) throw new Error('Sıfırlama kodu geçersiz.');
  const bilgi = JSON.parse(veri.toString('utf8')) as { v: number; t: string; m: string; r: string };
  if (bilgi.v !== 1 || bilgi.t !== 'parola') throw new Error('Sıfırlama kodu bu sürümle uyumlu değil.');
  if (bilgi.m !== makine) throw new Error('Bu kod başka bir bilgisayar için üretilmiş.');
  if (bilgi.r !== istek) throw new Error('Bu kod eski bir istek için üretilmiş. Ekrandaki güncel istek kodunu destek hattına okuyun.');
  return bilgi;
}

const gunFarki = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const trTarih = (iso: string) => iso.split('-').reverse().join('.');

/**
 * Lisans durumunu hesaplar. `bugun`, saat geri alınarak süre uzatılmasın diye
 * programın gördüğü en ileri tarihtir.
 */
export function durumHesapla(opts: { makine: string; anahtar: string | null; denemeBaslangic: string; bugun: string; publicKey?: KeyObject }): LisansDurumu {
  const { makine, anahtar, denemeBaslangic, bugun, publicKey } = opts;
  if (anahtar) {
    try {
      const l = anahtarCoz(anahtar, makine, publicKey);
      if (!l.s || l.s >= bugun) {
        return {
          durum: 'lisansli',
          makine_kodu: makine,
          firma: l.f,
          bitis: l.s,
          kalan_gun: l.s ? gunFarki(l.s, bugun) : null,
          mesaj: l.s ? `${l.f} adına lisanslı, ${trTarih(l.s)} tarihine kadar.` : `${l.f} adına süresiz lisanslı.`,
        };
      }
      return { durum: 'bitti', makine_kodu: makine, firma: l.f, bitis: l.s, kalan_gun: 0, mesaj: `Lisans süresi ${trTarih(l.s)} tarihinde doldu. Program yalnızca görüntüleme modunda.` };
    } catch {
      /* geçersiz anahtar: deneme kurallarına düşer */
    }
  }
  const bitis = new Date(Date.parse(`${denemeBaslangic}T00:00:00Z`) + DENEME_GUN * 86400000).toISOString().slice(0, 10);
  const kalan = gunFarki(bitis, bugun);
  if (kalan > 0) return { durum: 'deneme', makine_kodu: makine, firma: null, bitis, kalan_gun: kalan, mesaj: `Deneme sürümü: ${kalan} gün kaldı.` };
  return { durum: 'bitti', makine_kodu: makine, firma: null, bitis, kalan_gun: 0, mesaj: 'Deneme süresi doldu. Program yalnızca görüntüleme modunda; devam etmek için lisans anahtarı girin.' };
}

/** Lisans bitince de yapılabilen yazma işlemleri (giriş, çıkış, yedek, lisans). */
const SERBEST = ['/api/auth/login', '/api/auth/logout', '/api/logout', '/api/auth/register', '/api/auth/change-password', '/api/backup', '/api/lisans', '/api/yerel-yedekler/klasoru-ac', '/api/parola-sifirla'];

export const yazmaSerbest = (method: string, path: string) => method === 'GET' || method === 'HEAD' || SERBEST.includes(path);
