// Fiyat panosu (TV) ve işyeri logosu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1, parseLiveProducts, parseAltinApi } from './.build/harness.mjs';

/** Canlı fiyat önbelleğini doldurur: test internet olsa da olmasa da aynı fiyatlarla çalışır. */
function liveCache(data = {}) {
  globalThis.__kuyumcu_fiyat__ = { at: Date.now(), data: { price: null, kurlar: {}, metaller: {}, urunler: {}, ...data } };
}

async function client() {
  liveCache();
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return { call, env };
}

test('canlı kaynaktaki ürün fiyatları anahtar adlarından okunur', () => {
  const out = parseLiveProducts({ 'ceyrek-altin': { Buying: '10.512,00', Selling: '10.790,50' }, '22-ayar-bilezik': { Buying: 5980, Selling: 6250 }, 'tam-altin': { Buying: 'x' } });
  assert.deepEqual(out, { CEYREK: { alis: 10512, satis: 10790.5 }, B22: { alis: 5980, satis: 6250 } });
});

test('pano: fiyatlar has x çarpandan hesaplanır, elle fiyat önce gelir, gizlenen satır görünmez', async () => {
  const c = await client();
  await c.call('PUT', '/api/altin-fiyati', { alis: '6500', satis: '6600', kurlar: { USD: { alis: '49.6', satis: '49.8' } } });
  const sayfa = await app.fetch(new Request('http://localhost/pano'), c.env);
  assert.equal(sayfa.status, 302); // oturumsuz giriş sayfasına
  // Canlı kaynak yok sayılır; elle girilen has fiyatı kullanılır.
  const ilk = (await c.call('GET', '/api/pano')).body.data;
  const row = (kod) => ilk.satirlar.find((r) => r.kod === kod);
  assert.deepEqual([row('HAS').alis, row('HAS').satis], [6500, 6600]);
  assert.deepEqual([row('CEYREK').alis, row('CEYREK').satis, row('CEYREK').fiyat_kaynagi], [10400, 10824, 'hesap']); // 6500 x 1,6 / 6600 x 1,64
  assert.deepEqual([row('USD').alis, row('USD').fiyat_kaynagi], [49.6, 'piyasa']);
  assert.equal(row('GUMUS').alis, null); // gümüş fiyatı girilmedi
  const kayit = await c.call('PUT', '/api/pano', {
    alt_yazi: 'Kredi kartına taksit',
    satirlar: [
      { kod: 'CEYREK', kaynak: 'elle', elle_alis: 10450, elle_satis: 10780 },
      { kod: 'B22', kaynak: 'hesap', alis_carpan: '0.92', satis_carpan: '0.95' },
      { kod: 'A14', gorunur: false },
    ],
  });
  assert.equal(kayit.status, 200);
  const son = (await c.call('GET', '/api/pano')).body.data;
  const r2 = (kod) => son.satirlar.find((r) => r.kod === kod);
  assert.equal(son.alt_yazi, 'Kredi kartına taksit');
  assert.deepEqual([r2('CEYREK').alis, r2('CEYREK').satis, r2('CEYREK').fiyat_kaynagi], [10450, 10780, 'elle']);
  assert.deepEqual([r2('B22').alis, r2('B22').satis], [5980, 6270]);
  assert.equal(r2('A14'), undefined);
  assert.equal(son.satirlar[0].kod, 'CEYREK'); // kayıtlı sıra korunur
  const hepsi = (await c.call('GET', '/api/pano?hepsi=1')).body.data.satirlar;
  assert.equal(hepsi.find((r) => r.kod === 'A14').gorunur, false);
  assert.equal(hepsi.find((r) => r.kod === 'CEYREK').kaynak, 'elle');
  // Piyasada ürünün fiyatı varsa "piyasa" satırı onu gösterir; "hesap" satırı yine çarpanla hesaplanır.
  liveCache({ urunler: { TAM: { alis: 42000, satis: 43500 }, B22: { alis: 6000, satis: 6300 } } });
  // Formlar için ürün fiyatları panoyla aynıdır (gizli satırlar da dahil; has ve kurlar yok).
  const urunler = (await c.call('GET', '/api/pano/urunler')).body.data;
  assert.deepEqual(urunler.CEYREK, { alis: 10450, satis: 10780 });
  assert.deepEqual(urunler.TAM, { alis: 42000, satis: 43500 });
  assert.ok(urunler.A14 && !urunler.HAS && !urunler.USD);
  const canli = (await c.call('GET', '/api/pano')).body.data.satirlar;
  assert.deepEqual([canli.find((r) => r.kod === 'TAM').alis, canli.find((r) => r.kod === 'TAM').fiyat_kaynagi], [42000, 'piyasa']);
  assert.deepEqual([canli.find((r) => r.kod === 'B22').alis, canli.find((r) => r.kod === 'B22').fiyat_kaynagi], [5980, 'hesap']);
  liveCache();
  // Elle seçilip fiyat yazılmazsa kaydedilmez.
  const eksik = await c.call('PUT', '/api/pano', { satirlar: [{ kod: 'TAM', kaynak: 'elle' }] });
  assert.equal(eksik.status, 422);
});

test('işyeri logosu yüklenir, okunur ve kaldırılır', async () => {
  const c = await client();
  assert.equal((await c.call('GET', '/api/firma/logo')).status, 404);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await c.call('PUT', '/api/firma/logo', { data: `data:image/svg+xml;base64,${png}` })).status, 422);
  assert.equal((await c.call('PUT', '/api/firma/logo', { data: `data:image/png;base64,${png}` })).status, 200);
  const logo = await c.call('GET', '/api/firma/logo');
  assert.equal(logo.type, 'image/png');
  assert.deepEqual([...logo.body.slice(1, 4)].map((b) => String.fromCharCode(b)).join(''), 'PNG');
  assert.equal((await c.call('GET', '/api/firma')).body.data.logo, true);
  assert.equal((await c.call('GET', '/api/pano')).body.data.firma.logo, true);
  await c.call('PUT', '/api/firma/logo', { data: '' });
  assert.equal((await c.call('GET', '/api/firma/logo')).status, 404);
});

test('AltınAPI cevabı (Harem kodları): has, kurlar, gümüş ve ürünler', () => {
  const live = parseAltinApi({
    updatedAt: '2026-10-22T06:55:01.000Z', stale: false,
    data: [
      { symbol: 'ALTIN', category: 'MADEN', bid: 6558.12, ask: '6602.40', timestamp: 1 },
      { symbol: 'USDTRY', bid: 41.85, ask: 41.92 }, { symbol: 'EURTRY', bid: '48.70', ask: '48.95' },
      { symbol: 'GUMTRY', bid: 79.1, ask: 82.3 },
      { symbol: 'CEYREK_ESKI', bid: 10450, ask: 10750 }, { symbol: 'ceyrek_yeni', bid: 10600, ask: 10850 },
      { symbol: 'TEK_YENI', bid: 'x', ask: '' }, { bid: 1 },
    ],
  });
  assert.equal(live.price.alis, 6558.12);
  assert.equal(live.price.satis, 6602.4);
  assert.equal(live.price.saglayici, 'AltınAPI');
  assert.match(live.price.guncelleme, /22\.10\.2026/);
  assert.deepEqual(live.kurlar.USD, { alis: 41.85, satis: 41.92, kaynak: 'canli' });
  assert.equal(live.kurlar.EUR.satis, 48.95);
  assert.equal(live.metaller.GUMUS.alis, 79.1);
  assert.deepEqual(live.urunler.CEYREK, { alis: 10600, satis: 10850 });
  assert.equal(live.urunler.TAM, undefined);
  assert.equal(parseAltinApi({ data: [{ symbol: 'USDTRY', bid: 1, ask: 2 }] }), null);
  assert.equal(parseAltinApi({}), null);
});

test('fiyat kaynağı anahtarı: yalnızca yönetici, boş anahtar kaldırır', async () => {
  const c = await client();
  assert.equal((await c.call('GET', '/api/altin-fiyati/kaynak')).body.data.anahtar_var, false);
  assert.equal((await c.call('PUT', '/api/altin-fiyati/kaynak', { anahtar: 'x' })).status, 422);
  const del = await c.call('PUT', '/api/altin-fiyati/kaynak', { anahtar: '' });
  assert.equal(del.status, 200);
});

test('elle girilen has fiyatı ve kurlar silinince canlı fiyata dönülür', async () => {
  const c = await client();
  await c.call('PUT', '/api/altin-fiyati', { alis: '1', satis: '1', kurlar: { USD: { alis: '1', satis: '49.66' } } });
  let d = (await c.call('GET', '/api/altin-fiyati')).body.data;
  assert.equal(d.manuel.alis, 1);
  assert.equal(d.manuel_kurlar.USD.alis, 1);
  assert.equal((await c.call('DELETE', '/api/altin-fiyati')).status, 200);
  d = (await c.call('GET', '/api/altin-fiyati')).body.data;
  assert.equal(d.manuel, null);
  assert.deepEqual(d.manuel_kurlar, {});
});
