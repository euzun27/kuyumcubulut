// Önerilen satış fiyatı: alışın işçilik dahil maliyet milyemi etikete ve stok
// seçeneklerine gelir; kâr milyemi ve yuvarlama yönetici ayarından okunur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

async function client() {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const j = await res.json();
    return { status: res.status, data: j.data, message: j.message };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return call;
}

test('maliyet milyemi alıştan: 11,61 gr bilezik 57.155,72 TL → 765', async () => {
  const call = await client();
  // 6,79185 has × 6.435,15 = 43.706,57; kalan 13.449,15 işçilik.
  const alis = await call('POST', '/api/alis', { tedarikci: 'HASDEN ALTIN', cinsi: 'Bilezik', ayar: '14', adet: '1', gram: '11,61', milyem: '585', has_fiyati: '6435,15', iscilik: '13449,15' });
  assert.equal(alis.status, 200, alis.message);
  const secenek = (await call('GET', '/api/stok/normal/secenekler')).data.find((r) => r.cinsi === 'BİLEZİK');
  assert.ok(Math.abs(secenek.maliyet_milyem - 765) < 0.05, String(secenek.maliyet_milyem));
  assert.equal(secenek.maliyet_iscilik, true);
  const tag = (await call('POST', '/api/etiket', { items: [{ alis_id: alis.data.id, cinsi: 'Bilezik', ayar: '14', gram: '11,61', milyem: '585' }] })).data[0];
  const kod = await call('GET', `/api/etiket/kod/${tag.barkod}`);
  assert.equal(kod.status, 200, kod.message);
  assert.ok(Math.abs(kod.data.maliyet_milyem - 765) < 0.05);
  // Alışa bağlı olmayan etikette maliyet alanı gelmez (form stok seçeneğine bakar).
  const free = (await call('POST', '/api/etiket', { items: [{ cinsi: 'Bilezik', ayar: '14', gram: '5', milyem: '585' }] })).data[0];
  assert.equal((await call('GET', `/api/etiket/kod/${free.barkod}`)).data.maliyet_milyem, undefined);
});

test('satış ayarı: kâr milyemi, cins bazında kâr ve yuvarlama', async () => {
  const call = await client();
  assert.deepEqual((await call('GET', '/api/altin-fiyati/satis-ayari')).data, { varsayilan: 0, cinsler: {}, adim: 0, yuvarlama: 'YUKARI' });
  const put = await call('PUT', '/api/altin-fiyati/satis-ayari', { varsayilan: '30', cinsler: { bilezik: '25,5', '': 9 }, adim: 100, yuvarlama: 'YAKIN' });
  assert.equal(put.status, 200, put.message);
  assert.deepEqual((await call('GET', '/api/altin-fiyati/satis-ayari')).data, { varsayilan: 30, cinsler: { 'BİLEZİK': 25.5 }, adim: 100, yuvarlama: 'YAKIN' });
  assert.equal((await call('PUT', '/api/altin-fiyati/satis-ayari', { adim: 7 })).status, 422);
  assert.equal((await call('PUT', '/api/altin-fiyati/satis-ayari', { varsayilan: 'abc' })).status, 422);
});
