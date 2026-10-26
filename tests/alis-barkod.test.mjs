// Alışta barkod ve etiket: kayıt ve etiket tek adımda, ürün ikinci kez stoğa girmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

async function client() {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return { call };
}

const DAY = '2026-03-10';
const ALIS = { tarih: DAY, tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', milyem: '916', has_fiyati: '6000' };
const alisCount = async (c) => (await c.call('GET', '/api/alis')).body.data.length;

test('etiket bas: adet kadar etiket açılır, alışa bağlanır, ayrıca stok alışı açılmaz', async () => {
  const c = await client();
  const res = await c.call('POST', '/api/alis', { ...ALIS, adet: '3', gram: '10', etiket_bas: '1' });
  assert.equal(res.body.status, 'ok');
  const tags = res.body.data.etiketler;
  assert.equal(tags.length, 3);
  assert.deepEqual(tags.map((t) => t.gram), [3.333, 3.333, 3.334]);
  assert.ok(tags.every((t) => t.alis_id === res.body.data.id && t.durum === 'STOKTA' && /^DT\d{6}$/.test(t.barkod)));
  assert.equal(await alisCount(c), 1);
  // Seçilmezse etiket açılmaz.
  assert.deepEqual((await c.call('POST', '/api/alis', { ...ALIS, gram: '5' })).body.data.etiketler, []);
});

test('başka firma barkodu saklanır; satışta okutulunca stoktaki parça düşer', async () => {
  const c = await client();
  const g = { ...ALIS, cinsi: 'GRAM ALTIN', ayar: '24', milyem: '995' };
  const ilk = (await c.call('POST', '/api/alis', { ...g, adet: '2', gram: '2', barkod: '8691234567890' })).body.data;
  assert.deepEqual(ilk.etiketler.map((t) => [t.eski_barkod, t.gram]), [['8691234567890', 1], ['8691234567890', 1]]);
  // Aynı barkodlu üründen ikinci alış: tanınır, yeni parçalar eklenir.
  const found = (await c.call('GET', '/api/etiket/kod/8691234567890')).body.data;
  assert.deepEqual([found.cinsi, found.durum], ['GRAM ALTIN', 'STOKTA']);
  await c.call('POST', '/api/alis', { ...g, adet: '1', gram: '1', barkod: '8691234567890' });
  assert.equal((await c.call('GET', '/api/etiket')).body.data.ozet.stokta, 3);
  // Satış: okutulan barkod stoktaki birini SATILDI yapar.
  const sale = await c.call('POST', '/api/satis', { tarih: DAY, musteri: 'Ayşe', cinsi: 'GRAM ALTIN', ayar: '24', gram: '1', satis_milyem: '1000', stoktan: true, etiket_id: found.barkod });
  assert.equal(sale.body.status, 'ok');
  assert.equal((await c.call('GET', '/api/etiket')).body.data.ozet.stokta, 2);
  const next = (await c.call('GET', '/api/etiket/kod/8691234567890')).body.data;
  assert.equal(next.durum, 'STOKTA');
  assert.notEqual(next.id, found.id);
});

test('geri alım: satılmış DT etiketi aynı etiketle yeniden stokta; stoktaki etiket ikinci kez alınamaz', async () => {
  const c = await client();
  const [tag] = (await c.call('POST', '/api/alis', { ...ALIS, adet: '1', gram: '12', etiket_bas: '1' })).body.data.etiketler;
  assert.equal((await c.call('POST', '/api/alis', { ...ALIS, gram: '12', barkod: tag.barkod })).status, 422); // zaten stokta
  await c.call('POST', '/api/satis', { tarih: DAY, musteri: 'Ayşe', cinsi: 'BİLEZİK', ayar: '22', gram: '12', satis_milyem: '935', stoktan: true, etiket_id: tag.barkod });
  assert.equal((await c.call('GET', `/api/etiket/kod/${tag.barkod}`)).body.data.durum, 'SATILDI');
  assert.equal((await c.call('POST', '/api/alis', { ...ALIS, adet: '2', gram: '12', barkod: tag.barkod })).status, 422); // tek parça
  const back = (await c.call('POST', '/api/alis', { ...ALIS, tedarikci: 'Ayşe', adet: '1', gram: '11,9', barkod: tag.barkod })).body.data;
  assert.equal(back.etiketler.length, 1);
  assert.deepEqual([back.etiketler[0].id, back.etiketler[0].durum, back.etiketler[0].gram, back.etiketler[0].satis_id], [tag.id, 'STOKTA', 11.9, null]);
  assert.equal((await c.call('GET', '/api/etiket')).body.data.kayitlar.length, 1); // yeni etiket açılmadı
  assert.equal((await c.call('POST', '/api/alis', { ...ALIS, gram: '1', barkod: 'DT999999' })).status, 422);
});
