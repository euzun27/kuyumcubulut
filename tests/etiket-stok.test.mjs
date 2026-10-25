// Etiketten stoğa alma: programa yeni geçen kuyumcu elindeki ürünü etiketlerken
// stoğa da alır. Açılış stoğu alışı stok oluşturur, cari ve kasayı değiştirmez.
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

test('etiket oluştururken stoğa al: her parçaya ödemesi kapalı açılış alışı', async () => {
  const call = await client();
  const made = await call('POST', '/api/etiket', { items: [{ cinsi: 'Set', ayar: '22', gram: '112', milyem: '916', iscilik: '2800' }], kopya: 2, stoga_al: true, has_fiyati: '6000' });
  assert.equal(made.status, 201, made.message);
  assert.equal(made.data.length, 2);
  assert.ok(made.data.every((r) => r.alis_id));
  assert.notEqual(made.data[0].alis_id, made.data[1].alis_id);
  const stok = (await call('GET', '/api/stok/normal')).data.find((r) => r.cinsi === 'SET');
  assert.deepEqual([stok.kalan_gram, stok.kalan_has], [224, 205.184]);
  const alis = (await call('GET', '/api/alis')).data;
  assert.equal(alis.length, 2);
  assert.deepEqual([alis[0].tedarikci, alis[0].has_fiyati, alis[0].gram], ['AÇILIŞ STOĞU', 6000, 112]);
  // Cari ve kasa değişmez.
  const cari = (await call('GET', '/api/cari')).data.kisiler.find((p) => p.isim === 'AÇILIŞ STOĞU');
  assert.equal(cari.kalan_has, 0);
  const kasa = (await call('GET', '/api/kasa')).data.hesaplar;
  assert.ok(kasa.every((h) => h.bakiye === 0));
  // Gram/milyem olmadan stoğa alınmaz.
  assert.equal((await call('POST', '/api/etiket', { items: [{ cinsi: 'Yüzük', ayar: '14', gram: '3' }], stoga_al: true, has_fiyati: '6000' })).status, 422);
});

test('mevcut etiketleri sonradan stoğa al; ikinci kez alınmaz', async () => {
  const call = await client();
  const made = (await call('POST', '/api/etiket', { items: [{ cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916' }], kopya: 3 })).data;
  assert.ok(made.every((r) => !r.alis_id));
  const ids = made.map((r) => r.id);
  const r1 = await call('POST', '/api/etiket/stoga-al', { ids: ids.slice(0, 2), has_fiyati: '6100' });
  assert.equal(r1.status, 200, r1.message);
  assert.deepEqual(r1.data, { adet: 2, atlanan: 0 });
  const r2 = await call('POST', '/api/etiket/stoga-al', { ids, has_fiyati: '6100' });
  assert.deepEqual(r2.data, { adet: 1, atlanan: 2 });
  assert.equal((await call('POST', '/api/etiket/stoga-al', { ids, has_fiyati: '6100' })).status, 422);
  const stok = (await call('GET', '/api/stok/normal')).data.find((r) => r.cinsi === 'BİLEZİK');
  assert.equal(stok.kalan_gram, 30);
  const list = (await call('GET', '/api/etiket')).data.kayitlar;
  assert.ok(list.every((r) => r.alis_id));
  // Etiket düzenlenince alış bağı korunur (ikinci kez stoğa alınamaz).
  const put = await call('PUT', `/api/etiket/${ids[0]}`, { cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916', model: 'B2' });
  assert.equal(put.status, 200, put.message);
  assert.equal(put.data.alis_id, made.length && list.find((r) => r.id === ids[0]).alis_id);
});

test('etiketten stoğa alınan ürün sayımda tekrar stoğa girmez; maliyet fiyatı zorunlu', async () => {
  const call = await client();
  assert.equal((await call('POST', '/api/etiket', { items: [{ cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916' }], stoga_al: true })).status, 422);
  const [tag] = (await call('POST', '/api/etiket', { items: [{ cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916' }], stoga_al: true, has_fiyati: '6000' })).data;
  const s = (await call('POST', '/api/sayim', { tur: 'ACILIS', has_fiyati: '6000' })).data;
  const r = await call('POST', `/api/sayim/${s.id}/okut`, { kod: tag.barkod });
  assert.match(r.message, /zaten stokta/);
  assert.equal((await call('POST', `/api/sayim/${s.id}/bitir`)).data.stoga_alinan, 0);
  assert.equal((await call('GET', '/api/alis')).data.length, 1);
  assert.equal((await call('POST', '/api/etiket/stoga-al', { ids: [tag.id], has_fiyati: '6000' })).status, 422);
});
