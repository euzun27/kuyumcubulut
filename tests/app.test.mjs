// Bulut sürümüne özgü davranışlar: giriş, roller, yedek/geri yükleme, dışa aktarma.
// Hesap kurallarının eski programla aynılığı ayrıca karşılaştırma testiyle doğrulanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1, parseLivePrice } from './.build/harness.mjs';

function client() {
  globalThis.__kuyumcu_day__ = undefined; // her test temiz veritabanıyla başlar
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { env, call, logout: () => (cookie = '') };
}

test('ilk kurulum yönetici oluşturur, sonra kayıt kapanır', async () => {
  const c = client();
  assert.equal((await c.call('GET', '/api/auth/status')).body.data.needs_setup, true);
  assert.equal((await c.call('GET', '/api/dashboard')).status, 401);
  assert.equal((await c.call('GET', '/')).status, 302);
  const reg = await c.call('POST', '/api/auth/register', { name: 'Yönetici', email: 'Admin@Dunyatek.com', password: 'gizli-parola' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.data.role, 'admin');
  assert.equal((await c.call('GET', '/api/session')).body.data.authenticated, true);
  assert.equal((await c.call('GET', '/')).status, 200);
  assert.equal((await c.call('GET', '/api/dashboard')).body.status, 'ok');
  c.logout();
  const again = await c.call('POST', '/api/auth/register', { name: 'X', email: 'x@x.com', password: 'gizli-parola' });
  assert.equal(again.status, 403);
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'admin@dunyatek.com', password: 'yanlis-parola' })).status, 401);
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'admin@dunyatek.com', password: 'gizli-parola' })).status, 200);
  await c.call('POST', '/api/logout');
  assert.equal((await c.call('GET', '/api/session')).body.data.authenticated, false);
});

test('izleyici okuyabilir ama kayıt değiştiremez; pasif kullanıcı giremez', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  assert.equal((await c.call('POST', '/api/auth/users', { name: 'İzleyici', email: 'v@d.com', password: 'izle-parola', role: 'viewer' })).status, 201);
  assert.equal((await c.call('POST', '/api/auth/users', { name: 'Kısa', email: 'k@d.com', password: 'kisa' })).status, 422);
  c.logout();
  await c.call('POST', '/api/auth/login', { email: 'v@d.com', password: 'izle-parola' });
  assert.equal((await c.call('GET', '/api/alis')).status, 200);
  const blocked = await c.call('POST', '/api/alis', { tedarikci: 'T', cinsi: 'BILEZIK', ayar: '22', gram: 10, milyem: 916 });
  assert.equal(blocked.status, 403);
  assert.equal((await c.call('GET', '/api/auth/users')).status, 403);
  c.logout();
  await c.call('POST', '/api/auth/login', { email: 'a@d.com', password: 'gizli-parola' });
  const users = (await c.call('GET', '/api/auth/users')).body.data;
  const viewer = users.find((u) => u.email === 'v@d.com');
  assert.equal((await c.call('PUT', `/api/auth/users/${viewer.id}`, { is_active: false })).status, 200);
  assert.equal((await c.call('PUT', `/api/auth/users/1`, { role: 'staff' })).status, 422);
  c.logout();
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'v@d.com', password: 'izle-parola' })).status, 401);
});

test('parola değiştirme', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'eski-parola' });
  assert.equal((await c.call('POST', '/api/auth/change-password', { current_password: 'yanlis', new_password: 'yeni-parola' })).status, 422);
  assert.equal((await c.call('POST', '/api/auth/change-password', { current_password: 'eski-parola', new_password: 'yeni-parola' })).status, 200);
  c.logout();
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'a@d.com', password: 'yeni-parola' })).status, 200);
});

test('yedek alma ve son yedeği geri yükleme stok dağılımını korur', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'gizli-parola' });
  // Günlük açılış yedeği ilk istekte alınır.
  assert.ok((await c.call('GET', '/api/uygulama-ayarlari')).body.data.last_backup);
  await c.call('POST', '/api/alis', { tedarikci: 'T', cinsi: 'BILEZIK', ayar: '22', gram: '20', milyem: '900', has_fiyati: '3000' });
  const sale = await c.call('POST', '/api/satis', { musteri: 'M', cinsi: 'BILEZIK', ayar: '22', gram: '5', satis_milyem: '950', stoktan: true });
  assert.equal(sale.body.status, 'ok');
  assert.equal((await c.call('POST', '/api/backup')).body.status, 'ok');
  await c.call('DELETE', `/api/satis/${sale.body.data.id}`);
  assert.equal((await c.call('GET', '/api/satis')).body.data.length, 0);
  const restored = await c.call('POST', '/api/restore-latest');
  assert.equal(restored.body.status, 'ok');
  assert.match(restored.body.data.restored_from, /^kuyumcu_manual_/);
  const sales = (await c.call('GET', '/api/satis')).body.data;
  assert.equal(sales.length, 1);
  assert.deepEqual(sales[0].stok_dagilimi.map((p) => [p.gram, p.milyem]), [['5', '900.0']]);
  assert.equal((await c.call('GET', '/api/stok/normal')).body.data[0].kalan_gram, 15);
});

test('dışa aktarma ve bilinmeyen uç', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'gizli-parola' });
  await c.call('POST', '/api/alis', { tedarikci: 'T', cinsi: 'BILEZIK', ayar: '22', gram: '10', milyem: '916', has_fiyati: '3000' });
  const data = (await c.call('GET', '/api/export')).body.data;
  assert.equal(data.alis.length, 1);
  assert.equal(data.alis[0].toplam_tutar, 27480);
  assert.equal((await c.call('GET', '/api/yok-boyle')).status, 404);
});

test('TL: has fiyatı ve işçilikle tutar ve kâr hesaplanır', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'gizli-parola' });
  await c.call('POST', '/api/alis', { tedarikci: 'T', cinsi: 'BILEZIK', ayar: '22', gram: '10', milyem: '916', has_fiyati: '3000', iscilik: '200' });
  const sale = await c.call('POST', '/api/satis', { musteri: 'M', cinsi: 'BILEZIK', ayar: '22', gram: '5', satis_milyem: '950', stoktan: true, has_fiyati: '3100,50', iscilik: '150' });
  // 5 × 950 / 1000 = 4,75 has × 3100,50 + 150 = 14877,38
  assert.equal(sale.body.data.toplam_tutar, 14877.38);
  // Maliyet: (9,16 × 3000 + 200) × 5 / 10 = 13840
  assert.equal(sale.body.data.brut_kar, 1037.38);
  const dash = (await c.call('GET', '/api/dashboard')).body.data;
  assert.equal(dash.toplam_tl_kar, 1037.38);
  assert.equal(dash.gunluk_tl_kar, 1037.38);
});

test('günün has fiyatı elle girilir; canlı kaynak biçimleri okunur', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'gizli-parola' });
  assert.equal((await c.call('GET', '/api/altin-fiyati?kaynak=manuel')).body.data.fiyat, null);
  assert.equal((await c.call('PUT', '/api/altin-fiyati', { alis: 'abc' })).status, 422);
  const saved = await c.call('PUT', '/api/altin-fiyati', { alis: '3.150,25'.replace('.', ''), satis: '3170' });
  assert.equal(saved.body.data.alis, 3150.25);
  const price = (await c.call('GET', '/api/altin-fiyati?kaynak=manuel')).body.data.fiyat;
  assert.deepEqual([price.alis, price.satis, price.kaynak], [3150.25, 3170, 'manuel']);
  assert.deepEqual(parseLivePrice({ Update_Date: 'x', HAS: { Name: 'Has Altın', Buying: 3001.5, Selling: 3010 } }).satis, 3010);
  assert.deepEqual(parseLivePrice({ 'gram-has-altin': { 'Alış': '3.001,50', 'Satış': '3.010,00' } }).alis, 3001.5);
  assert.equal(parseLivePrice({ USD: { Buying: 40 } }), null);
});
