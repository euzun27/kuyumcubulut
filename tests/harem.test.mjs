// Harem Altın canlı akışı: socket.io mesajı, fiyat kaynağı sırası ve sahte sunucuyla bağlantı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { app, TestD1, haremMesaj, haremSnapshot, startHaremStream } from './.build/harness.mjs';

const ornek = (data) => `42${JSON.stringify(['price_changed', { meta: { tarih: '22-10-2026 11:06:27' }, data }])}`;
const temizle = () => { globalThis.__harem__ = undefined; globalThis.__kuyumcu_fiyat__ = { at: Date.now(), data: { price: null, kurlar: {}, metaller: {}, urunler: {} } }; };

async function client() {
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Y', email: 'a@d.com', password: 'gizli-parola' });
  return call;
}

test('price_changed mesajı birikir; parçalı güncellemeler eski kodları korur', () => {
  temizle();
  assert.equal(haremMesaj('2'), false);
  assert.equal(haremMesaj('42["baska",{}]'), false);
  assert.equal(haremMesaj(ornek({ ALTIN: { code: 'ALTIN', alis: 6509.82, satis: 6530.37 }, USDTRY: { alis: '41.85', satis: '41.92' } })), true);
  assert.equal(haremMesaj(ornek({ CEYREK_YENI: { alis: 10600, satis: 10850 } })), true);
  const s = haremSnapshot();
  assert.equal(s.data.ALTIN.alis, 6509.82);
  assert.equal(s.data.CEYREK_YENI.satis, 10850);
  assert.equal(s.tarih, '22-10-2026 11:06:27');
  assert.equal(haremSnapshot(Date.now() + 3 * 60 * 1000), null, '2 dakikadan eski akış kullanılmaz');
  temizle();
});

test('Harem akışı varsa fiyat Harem\'den, yoksa diğer kaynaktan gelir', async () => {
  temizle();
  const call = await client();
  await call('PUT', '/api/altin-fiyati', { alis: '6500', satis: '6600' });
  assert.equal((await call('GET', '/api/altin-fiyati')).body.data.fiyat.kaynak, 'manuel');
  haremMesaj(ornek({ ALTIN: { alis: '6509.82', satis: '6530.37' }, USDTRY: { alis: 41.85, satis: 41.92 }, GUMUSTRY: { alis: 71.3, satis: 77.62 } }));
  const d = (await call('GET', '/api/altin-fiyati')).body.data;
  assert.equal(d.fiyat.saglayici, 'Harem Altın');
  assert.equal(d.fiyat.alis, 6509.82);
  assert.equal(d.kurlar.USD.satis, 41.92);
  assert.equal(d.canli_metaller.GUMUS.alis, 71.3);
  temizle();
});

test('sahte socket.io sunucusu: bağlanır, 40 gönderir, ping yanıtlar, fiyatı alır', async () => {
  temizle();
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const gelen = [];
  let origin = null;
  wss.on('connection', (sock, req) => {
    origin = req.headers.origin;
    assert.match(req.url, /^\/socket\.io\/\?EIO=4&transport=websocket/);
    sock.on('message', (m) => {
      gelen.push(String(m));
      if (String(m) === '40') { sock.send('40{"sid":"x"}'); sock.send('2'); sock.send(ornek({ ALTIN: { alis: 6511.62, satis: 6531.77 } })); }
    });
    sock.send('0{"sid":"abc","pingInterval":25000,"pingTimeout":20000}');
  });
  const stop = startHaremStream(() => {}, `ws://127.0.0.1:${port}`);
  // Fiyat istemciye, ping yanıtı sunucuya ayrı ayrı ulaşır; ikisini de bekle.
  for (let i = 0; i < 100 && !(haremSnapshot() && gelen.includes('3')); i++) await new Promise((r) => setTimeout(r, 20));
  stop(); wss.close();
  assert.equal(haremSnapshot()?.data.ALTIN.alis, 6511.62);
  assert.ok(gelen.includes('40'), 'ad alanına bağlanma');
  assert.ok(gelen.includes('3'), 'ping yanıtı');
  assert.equal(origin, 'https://www.haremaltin.com');
  temizle();
});
