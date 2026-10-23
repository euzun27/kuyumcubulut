// Giderlerin TL girilmesi ve kişi adlarının büyük harfle saklanması.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

// Bu testler kasayı bilerek eksiye düşürür; TL eksi bakiye onayı kasa.test.mjs'de ayrıca denenir.
const onay = (b) => (b && typeof b === 'object' && !Array.isArray(b) && !('eksi_onay' in b) ? { ...b, eksi_onay: true } : b);

async function client() {
  globalThis.__kuyumcu_day__ = undefined;
  globalThis.__kuyumcu_fiyat__ = { at: Date.now(), data: { price: null, kurlar: {}, metaller: {}, urunler: {} } };
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(onay(body)) }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  return { call, env };
}

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const kasa = async (c) => (await c.call('GET', `/api/kasa/hareketler?baslangic=${TODAY}&bitis=${TODAY}`)).body.data;

test('gider TL girilir, günün has fiyatıyla hasa çevrilir ve kasadan düşer', async () => {
  const c = await client();
  // Has fiyatı yokken TL gider kaydedilemez (çevrilemez).
  assert.equal((await c.call('POST', '/api/giderler', { tarih: TODAY, tl_tutar: '650', kategori: 'Yemek' })).status, 422);
  await c.call('PUT', '/api/altin-fiyati', { alis: '6500', satis: '6600' });
  // 650 TL yemek, nakitten: 650 / 6500 = 0,1 has.
  const yemek = await c.call('POST', '/api/giderler', { tarih: TODAY, tl_tutar: '650', kategori: 'Yemek', kasa: [{ hesap_id: 1, tutar: '650' }] });
  assert.equal(yemek.status, 200);
  assert.deepEqual([yemek.body.data.tutar, yemek.body.data.tl_tutar, yemek.body.data.has_fiyati], [0.1, 650, 6500]);
  let hareket = await kasa(c);
  assert.deepEqual(hareket.map((h) => [h.yon, h.tutar, h.kaynak, h.duzenlenebilir]), [['CIKIS', 650, 'Gider', false]]);
  // Has fiyatı elle verilebilir; kasaya yazılmayan TL gider.
  const kira = await c.call('POST', '/api/giderler', { tarih: TODAY, tl_tutar: '20000', has_fiyati: '6400', kategori: 'Kira' });
  assert.equal(kira.body.data.tutar, 3.125);
  // Eski usul has gider de çalışır.
  const has = await c.call('POST', '/api/giderler', { tarih: TODAY, tutar: '0.5', kategori: 'Çalışan ödemesi' });
  assert.deepEqual([has.body.data.tutar, has.body.data.tl_tutar], [0.5, null]);
  // Net kâr has giderlerin toplamıyla azalır.
  assert.equal((await c.call('GET', '/api/dashboard')).body.data.toplam_gider, 3.725);
  // Liste bağlı kasa ödemesini gösterir; tutar değişince kasa da güncellenir.
  const list = (await c.call('GET', '/api/giderler')).body.data;
  assert.equal(list.find((g) => g.id === yemek.body.data.id).kasa_odemeleri[0].tutar, 650);
  await c.call('PUT', `/api/giderler/${yemek.body.data.id}`, { tarih: TODAY, tl_tutar: '1300', kategori: 'Yemek', kasa: [{ hesap_id: 1, tutar: '1300' }] });
  hareket = await kasa(c);
  assert.deepEqual(hareket.map((h) => h.tutar), [1300]);
  // Gider silinince kasa hareketi de silinir.
  await c.call('DELETE', `/api/giderler/${yemek.body.data.id}`);
  assert.equal((await kasa(c)).length, 0);
});

test('kişi adları büyük harfle saklanır; eski kayıtlar bir kez dönüştürülür', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tarih: TODAY, tedarikci: 'ahmet  yılmaz', cinsi: 'BİLEZİK', ayar: '22', gram: '10', milyem: '916', has_fiyati: '6000' });
  assert.equal((await c.call('GET', '/api/cari')).body.data.kisiler[0].isim, 'AHMET YILMAZ');
  // 1.1.1 öncesinden kalan küçük harfli kayıt: günün ilk isteğinde bir kez büyük harfe çevrilir.
  await c.env.DB.prepare(`INSERT INTO cari_odeme (tarih, isim, odeme_tipi, odenen_has, yon) VALUES (?, 'şükrü işçi', 'HAS', 1, 'ODEME')`).bind(TODAY).run();
  await c.env.DB.prepare(`DELETE FROM app_meta WHERE key = 'isim_buyuk_harf'`).run();
  globalThis.__kuyumcu_day__ = undefined;
  const names = (await c.call('GET', '/api/cari')).body.data.kisiler.map((k) => k.isim).sort();
  assert.deepEqual(names, ['AHMET YILMAZ', 'ŞÜKRÜ İŞÇİ']);
});
