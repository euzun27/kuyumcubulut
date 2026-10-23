// Ekstreler: cari, stok ve kasa dökümünde devir, hareketler ve yürüyen bakiye
// ekranlardaki bakiyelerle aynı olmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const D = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

async function client() {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const j = await res.json();
    if (method !== 'GET') assert.equal(j.status, 'ok', `${method} ${path}: ${j.message}`);
    return { status: res.status, data: j.data, message: j.message };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return call;
}

test('cari, stok ve kasa ekstresi devir ve yürüyen bakiyeyle', async () => {
  const call = await client();
  await call('POST', '/api/kasa/hareket', { tarih: D(10), kategori: 'DEVIR', yon: 'GIRIS', hesap_id: 1, tutar: '100000' });
  // 20 gr bilezik veresiye alınır, 5 gr'ı peşin satılır, 5 gr'ı veresiye satılır.
  await call('POST', '/api/alis', { tarih: D(8), tedarikci: 'Can Altın', cinsi: 'BİLEZİK', ayar: '22', gram: '20', milyem: '916', has_fiyati: '6000', odeme_tipi: 'ODEME_YOK' });
  await call('POST', '/api/satis', { tarih: D(6), musteri: 'Elif', cinsi: 'BİLEZİK', ayar: '22', gram: '5', satis_milyem: '950', stoktan: true, has_fiyati: '6100', odeme_tipi: 'TAM_KAPAT', kasa: [{ hesap_id: 1, tutar: '28975' }] });
  await call('POST', '/api/satis', { tarih: D(3), musteri: 'Elif', cinsi: 'BİLEZİK', ayar: '22', gram: '5', satis_milyem: '950', stoktan: true, has_fiyati: '6100', odeme_tipi: 'ODEME_YOK' });

  // Cari (has): aralık D(5)..bugün; ilk satış devire girer (peşin, bakiye 0), ikincisi borç.
  const cari = (await call('GET', `/api/ekstre/cari?isim=elif&baslangic=${D(5)}&bitis=${TODAY}`)).data;
  assert.equal(cari.isim, 'ELİF');
  assert.deepEqual(cari.devir, { has: 0 });
  assert.equal(cari.satirlar.length, 1);
  assert.deepEqual([cari.satirlar[0].islem, cari.satirlar[0].tutar, cari.satirlar[0].has, cari.satirlar[0].bakiye_has], ['Satış', 28975, 4.75, 4.75]);
  assert.deepEqual(cari.kapanis, { has: 4.75 });
  const ekran = (await call('GET', '/api/cari')).data.kisiler.find((p) => p.isim === 'ELİF');
  assert.equal(ekran.kalan_has, cari.kapanis.has);
  // Tedarikçiye borç eksi görünür.
  const can = (await call('GET', `/api/ekstre/cari?isim=Can Altın&baslangic=${D(30)}&bitis=${TODAY}`)).data;
  assert.deepEqual(can.kapanis, { has: -18.32 });

  // Stok: tüm hareketler, kalan stok ekranıyla aynı.
  const stok = (await call('GET', `/api/ekstre/stok?tur=normal&cinsi=BİLEZİK&ayar=22&baslangic=${D(30)}&bitis=${TODAY}`)).data;
  assert.deepEqual(stok.satirlar.map((r) => [r.islem, r.gram, r.bakiye_gram]), [['Alış', 20, 20], ['Satış', -5, 15], ['Satış', -5, 10]]);
  const s = (await call('GET', '/api/stok/normal')).data.find((r) => r.cinsi === 'BİLEZİK');
  assert.deepEqual([stok.kapanis.gram, stok.kapanis.has], [s.kalan_gram, s.kalan_has]);

  // Kasa: devir 100.000, peşin satış girişi.
  const kasa = (await call('GET', `/api/ekstre/kasa?hesap_id=1&baslangic=${D(7)}&bitis=${TODAY}`)).data;
  assert.deepEqual([kasa.devir.tutar, kasa.giris.tutar, kasa.kapanis.tutar], [100000, 28975, 128975]);
  assert.equal(kasa.satirlar[0].bakiye_tutar, 128975);

  assert.equal((await call('GET', `/api/ekstre/cari?isim=Yok&baslangic=${D(5)}&bitis=${TODAY}`)).status, 404);
  assert.equal((await call('GET', `/api/ekstre/kasa?hesap_id=1&baslangic=${TODAY}&bitis=${D(5)}`)).status, 422);
});
