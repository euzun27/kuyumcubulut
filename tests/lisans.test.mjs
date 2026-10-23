import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { anahtarCoz, durumHesapla, makineKodu, parolaKoduCoz, yazmaSerbest, DENEME_GUN } from './.build/lisans.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const uret = (bilgi, key = privateKey) => {
  const veri = Buffer.from(JSON.stringify({ v: 1, ...bilgi }));
  return `DT1-${veri.toString('base64url')}.${sign(null, veri, key).toString('base64url')}`;
};
const makine = makineKodu('3f2a9c1e-1111-2222-3333-444455556666');

test('makine kodu sabit ve XXXX-XXXX-XXXX-XXXX biçiminde', () => {
  assert.match(makine, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  assert.equal(makineKodu(' 3F2A9C1E-1111-2222-3333-444455556666 '), makine);
  assert.notEqual(makineKodu('baska-bilgisayar'), makine);
});

test('lisans anahtarı: doğru, başka makine, sahte imza, bozuk', () => {
  const anahtar = uret({ f: 'YILMAZ KUYUMCULUK', m: makine, b: '2026-10-19', s: '2027-10-19' });
  assert.equal(anahtarCoz(anahtar, makine, publicKey).f, 'YILMAZ KUYUMCULUK');
  assert.equal(anahtarCoz(`  ${anahtar.slice(0, 40)}\n${anahtar.slice(40)} `, makine, publicKey).m, makine);
  assert.throws(() => anahtarCoz(anahtar, makineKodu('baska'), publicKey), /başka bir bilgisayar/);
  const sahte = uret({ f: 'X', m: makine, b: '2026-10-19', s: null }, generateKeyPairSync('ed25519').privateKey);
  assert.throws(() => anahtarCoz(sahte, makine, publicKey), /geçersiz/);
  // İçeriği değiştirilmiş anahtar (bitiş uzatılmış) imzayı bozar.
  const [bas, imza] = anahtar.slice(4).split('.');
  const degisik = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(bas, 'base64url')), s: null })).toString('base64url');
  assert.throws(() => anahtarCoz(`DT1-${degisik}.${imza}`, makine, publicKey), /geçersiz/);
  assert.throws(() => anahtarCoz('merhaba', makine, publicKey), /biçimi/);
  // Gerçek açık anahtar test anahtarını kabul etmez.
  assert.throws(() => anahtarCoz(anahtar, makine), /geçersiz/);
});

test('deneme, lisanslı, süresi dolmuş durumları', () => {
  const d = (anahtar, bugun) => durumHesapla({ makine, anahtar, denemeBaslangic: '2026-10-01', bugun, publicKey });
  assert.equal(d(null, '2026-10-01').durum, 'deneme');
  assert.equal(d(null, '2026-10-01').kalan_gun, DENEME_GUN);
  assert.equal(d(null, '2026-10-15').kalan_gun, 1);
  assert.equal(d(null, '2026-10-16').durum, 'bitti');
  const yillik = uret({ f: 'A', m: makine, b: '2026-10-19', s: '2027-10-19' });
  assert.equal(d(yillik, '2027-10-19').durum, 'lisansli');
  assert.equal(d(yillik, '2027-10-20').durum, 'bitti');
  assert.equal(d(uret({ f: 'A', m: makine, b: '2026-10-19', s: null }), '2040-01-01').durum, 'lisansli');
  // Başka makinenin anahtarı denemeye düşer.
  assert.equal(d(uret({ f: 'A', m: makineKodu('baska'), b: '2026-10-19', s: null }), '2026-10-02').durum, 'deneme');
});

test('süre bitince yalnızca okuma, giriş, yedek ve lisans serbest', () => {
  assert.ok(yazmaSerbest('GET', '/api/satis'));
  assert.ok(yazmaSerbest('POST', '/api/auth/login'));
  assert.ok(yazmaSerbest('POST', '/api/backup'));
  assert.ok(yazmaSerbest('POST', '/api/lisans'));
  assert.ok(!yazmaSerbest('POST', '/api/satis'));
  assert.ok(!yazmaSerbest('DELETE', '/api/satis/1'));
  assert.ok(!yazmaSerbest('POST', '/api/verileri-sifirla'));
});

test('parola sıfırlama kodu: yalnızca o makine ve o istek kodu için', () => {
  const kod = (bilgi, key = privateKey) => {
    const veri = Buffer.from(JSON.stringify({ v: 1, t: 'parola', ...bilgi }));
    return `DP1-${veri.toString('base64url')}.${sign(null, veri, key).toString('base64url')}`;
  };
  const dogru = kod({ m: makine, r: 'AB12-CD34' });
  assert.equal(parolaKoduCoz(dogru, makine, 'AB12-CD34', publicKey).r, 'AB12-CD34');
  assert.throws(() => parolaKoduCoz(dogru, makine, 'FFFF-0000', publicKey), /eski bir istek/);
  assert.throws(() => parolaKoduCoz(dogru, makineKodu('baska'), 'AB12-CD34', publicKey), /başka bir bilgisayar/);
  assert.throws(() => parolaKoduCoz(kod({ m: makine, r: 'AB12-CD34' }, generateKeyPairSync('ed25519').privateKey), makine, 'AB12-CD34', publicKey), /geçersiz/);
  // Lisans anahtarı parola kodu yerine kullanılamaz.
  assert.throws(() => parolaKoduCoz(uret({ f: 'X', m: makine, b: '2026-10-19', s: null }), makine, 'AB12-CD34', publicKey), /biçimi/);
  assert.equal(yazmaSerbest('POST', '/api/parola-sifirla'), true);
});
