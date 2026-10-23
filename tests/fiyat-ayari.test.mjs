// Canlı altın fiyatına yüzde farkı (ayarlar → has fiyatı penceresi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

function liveCache() {
  globalThis.__kuyumcu_fiyat__ = {
    at: Date.now(),
    data: { price: { alis: 6000, satis: 6358, kaynak: 'canli', ad: 'Has Altın', guncelleme: '', saglayici: 'Truncgil Finans' }, kurlar: { USD: { alis: 41, satis: 42, kaynak: 'canli' } }, metaller: {}, urunler: { CEYREK: { alis: 10000, satis: 10400 } } },
  };
}

async function client() {
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const self = { donmus: false };
  const call = async (method, path, body) => {
    if (!self.donmus) liveCache();
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return Object.assign(self, { call, logout: () => (cookie = '') });
}

test('fiyat farkı canlı has fiyatına ve ürünlere uygulanır, döviz değişmez', async () => {
  const c = await client();
  let data = (await c.call('GET', '/api/altin-fiyati')).body.data;
  assert.equal(data.fiyat.satis, 6358);
  assert.deepEqual(data.fiyat_ayari, { alis: 0, satis: 0 });

  assert.equal((await c.call('PUT', '/api/altin-fiyati/ayar', { alis: '-0,5', satis: 1.5 })).status, 200);
  data = (await c.call('GET', '/api/altin-fiyati')).body.data;
  assert.deepEqual(data.fiyat_ayari, { alis: -0.5, satis: 1.5 });
  assert.equal(data.fiyat.alis, 5970); // 6000 × 0,995
  assert.equal(data.fiyat.satis, 6453.37); // 6358 × 1,015
  assert.equal(data.canli_ham.satis, 6358);
  assert.equal(data.kurlar.USD.satis, 42);
  const urunler = (await c.call('GET', '/api/pano/urunler')).body.data;
  assert.deepEqual(urunler.CEYREK, { alis: 9950, satis: 10556 });

  // Elle girilen fiyat olduğu gibi kalır (canlı yokken kullanılır).
  await c.call('PUT', '/api/altin-fiyati', { alis: '6100', satis: '6200' });
  data = (await c.call('GET', '/api/altin-fiyati')).body.data;
  assert.equal(data.manuel.satis, 6200);

  assert.equal((await c.call('PUT', '/api/altin-fiyati/ayar', { alis: 0, satis: 0 })).status, 200);
  assert.equal((await c.call('GET', '/api/altin-fiyati')).body.data.fiyat.satis, 6358);
});

test('fiyat farkını yalnızca yönetici değiştirir ve sınır dışı değer reddedilir', async () => {
  const c = await client();
  assert.equal((await c.call('PUT', '/api/altin-fiyati/ayar', { satis: 80 })).status, 422);
  assert.equal((await c.call('PUT', '/api/altin-fiyati/ayar', { satis: 'abc' })).status, 422);
  await c.call('POST', '/api/auth/users', { name: 'P', email: 'p@d.com', password: 'gizli-parola', role: 'staff' });
  c.logout();
  await c.call('POST', '/api/auth/login', { email: 'p@d.com', password: 'gizli-parola' });
  assert.equal((await c.call('PUT', '/api/altin-fiyati/ayar', { satis: 1 })).status, 403);
});

test('fiyat isteği dış kaynağı beklemez: bayat önbellek hemen döner, yenileme arkada yapılır', async () => {
  const c = await client();
  c.donmus = true;
  liveCache();
  globalThis.__kuyumcu_fiyat__.at = Date.now() - 5 * 60 * 1000; // 30 sn'den eski, 10 dk'dan genç
  const started = Date.now();
  const res = await c.call('GET', '/api/altin-fiyati');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.fiyat.satis, 6358);
  assert.ok(Date.now() - started < 1000, 'dış kaynak beklenmemeli');
});
