// Stok sayımı: barkod okutarak açılış (stoğa alır) ya da kontrol (fark gösterir)
// sayımı. Eski / farklı firma barkodu için etiket kaydı açılır ve barkod saklanır.
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

test('açılış sayımı: bizim etiket, eski barkod ve barkodsuz ürün stoğa girer', async () => {
  const call = await client();
  const [dt] = (await call('POST', '/api/etiket', { cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916' })).data;
  const s = (await call('POST', '/api/sayim', { tur: 'ACILIS', has_fiyati: '6000' })).data;
  assert.equal(s.durum, 'ACIK');

  // Bizim etiket okutulur; ikinci okutma reddedilir.
  const r1 = await call('POST', `/api/sayim/${s.id}/okut`, { kod: dt.barkod });
  assert.equal(r1.status, 200, r1.message);
  assert.equal((await call('POST', `/api/sayim/${s.id}/okut`, { kod: dt.barkod })).status, 409);

  // Eski firma barkodu (sayısal olabilir) kayıtlı değil: ürün bilgisi istenir.
  const r2 = await call('POST', `/api/sayim/${s.id}/okut`, { kod: '8690001234' });
  assert.deepEqual(r2.data, { yeni: true, kod: '8690001234' });
  const r3 = await call('POST', `/api/sayim/${s.id}/kalem`, { eski_barkod: '8690001234', cinsi: 'Kolye', ayar: '14', gram: '5', milyem: '585' });
  assert.equal(r3.status, 201, r3.message);
  assert.equal(r3.data.etiket.eski_barkod, '8690001234');
  // Aynı eski barkod tekrar elle eklenemez, okutulunca bulunur ve zaten sayılmıştır.
  assert.equal((await call('POST', `/api/sayim/${s.id}/kalem`, { eski_barkod: '8690001234', cinsi: 'Kolye', ayar: '14', gram: '5', milyem: '585' })).status, 409);
  assert.equal((await call('POST', `/api/sayim/${s.id}/okut`, { kod: '8690001234' })).status, 409);
  // Barkodsuz ürün; açılışta milyem zorunlu.
  assert.equal((await call('POST', `/api/sayim/${s.id}/kalem`, { cinsi: 'Yüzük', ayar: '14', gram: '3' })).status, 422);
  const r4 = await call('POST', `/api/sayim/${s.id}/kalem`, { cinsi: 'Yüzük', ayar: '14', gram: '3', milyem: '585' });
  assert.equal(r4.status, 201);
  // Geri alma: bu sayımda açılan etiket de silinir.
  const yuzuk = r4.data.sayim.kalemler.find((k) => k.cinsi === 'YÜZÜK');
  const del = await call('DELETE', `/api/sayim/${s.id}/kalem/${yuzuk.kalem_id}`);
  assert.equal(del.data.toplam.adet, 2);
  assert.equal((await call('GET', `/api/etiket/kod/${yuzuk.barkod}`)).status, 404);

  // Henüz stok yok; bitirince stoğa girer, cari ve kasa değişmez.
  assert.equal((await call('GET', '/api/stok/normal')).data.length, 0);
  const done = await call('POST', `/api/sayim/${s.id}/bitir`);
  assert.equal(done.status, 200, done.message);
  assert.equal(done.data.stoga_alinan, 2);
  const stok = (await call('GET', '/api/stok/normal')).data;
  assert.deepEqual(stok.map((r) => [r.cinsi, r.kalan_gram, r.kalan_has]).sort(), [['BİLEZİK', 10, 9.16], ['KOLYE', 5, 2.925]]);
  const alis = (await call('GET', '/api/alis')).data;
  assert.ok(alis.every((a) => a.tedarikci === 'AÇILIŞ STOĞU' && a.has_fiyati === 6000));
  assert.ok((await call('GET', '/api/kasa')).data.hesaplar.every((h) => h.bakiye === 0));
  // Kapalı sayım değişmez; satışta eski barkod okutulunca ürün bulunur.
  assert.equal((await call('POST', `/api/sayim/${s.id}/okut`, { kod: dt.barkod })).status, 400);
  const tag = await call('GET', '/api/etiket/kod/8690001234');
  assert.equal(tag.data.cinsi, 'KOLYE');
  assert.ok(tag.data.alis_id);

  // Yeni açılış sayımında aynı etiketler tekrar stoğa girmez.
  const s2 = (await call('POST', '/api/sayim', { tur: 'ACILIS', has_fiyati: '6000' })).data;
  await call('POST', `/api/sayim/${s2.id}/okut`, { kod: dt.barkod });
  assert.equal((await call('POST', `/api/sayim/${s2.id}/bitir`)).data.stoga_alinan, 0);
  assert.equal((await call('GET', '/api/alis')).data.length, 2);
});

test('açılış sayımı maliyet has fiyatı olmadan bitmez; iptal edilince eklenen etiketler silinir', async () => {
  const call = await client();
  const s = (await call('POST', '/api/sayim', { tur: 'ACILIS' })).data;
  const r = await call('POST', `/api/sayim/${s.id}/kalem`, { eski_barkod: 'ESK-1', cinsi: 'Set', ayar: '22', gram: '20', milyem: '916' });
  assert.equal((await call('POST', `/api/sayim/${s.id}/bitir`)).status, 422);
  assert.equal((await call('PUT', `/api/sayim/${s.id}`, { has_fiyati: '6100' })).data.has_fiyati, 6100);
  assert.equal((await call('DELETE', `/api/sayim/${s.id}`)).status, 200);
  assert.equal((await call('GET', `/api/etiket/kod/${r.data.etiket.barkod}`)).status, 404);
  assert.equal((await call('GET', '/api/sayim')).data.length, 0);
});

test('kontrol sayımı stoğa dokunmaz, farkı ve sayılmayan etiketleri gösterir', async () => {
  const call = await client();
  await call('POST', '/api/alis', { tedarikci: 'Can', cinsi: 'Bilezik', ayar: '22', gram: '30', milyem: '916', has_fiyati: '6000', odeme_tipi: 'TAM_KAPAT' });
  const tags = (await call('POST', '/api/etiket', { items: [{ cinsi: 'Bilezik', ayar: '22', gram: '10', milyem: '916' }], kopya: 3 })).data;
  const s = (await call('POST', '/api/sayim', { tur: 'KONTROL' })).data;
  await call('POST', `/api/sayim/${s.id}/okut`, { kod: tags[0].barkod });
  await call('POST', `/api/sayim/${s.id}/okut`, { kod: tags[1].barkod });
  const d = (await call('GET', `/api/sayim/${s.id}`)).data;
  const row = d.karsilastirma.find((r) => r.cinsi === 'BİLEZİK');
  assert.deepEqual([row.sistem_gram, row.sayilan_gram, row.fark_gram], [30, 20, -10]);
  assert.deepEqual(d.sayilmayan.map((r) => r.barkod), [tags[2].barkod]);
  const done = await call('POST', `/api/sayim/${s.id}/bitir`);
  assert.equal(done.data.stoga_alinan, 0);
  assert.equal((await call('GET', '/api/alis')).data.length, 1);
});
