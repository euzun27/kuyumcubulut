// Uçtan uca senaryo: açılış → bankadan dolar → döviz satışı → altın alış/satış → hurda alış/satış.
// Kasa bakiyeleri, kâr, stok, cari ve rapor birbiriyle tutarlı olmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const D = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

test('uçtan uca: kasa, kâr, stok, cari ve rapor tutarlı', async () => {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const j = await res.json();
    if (method !== 'GET') assert.equal(j.status, 'ok', `${method} ${path}: ${j.message}`);
    return j.data;
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  await call('PUT', '/api/kasa/hesaplar/4', { komisyon_orani: '2,5' });
  // Açılış ve bankadan 10.000 $ (kur 41).
  await call('POST', '/api/kasa/hareket', { tarih: D(10), kategori: 'DEVIR', yon: 'GIRIS', hesap_id: 5, tutar: '1500000' });
  await call('POST', '/api/kasa/hareket', { tarih: D(10), kategori: 'DEVIR', yon: 'GIRIS', hesap_id: 1, tutar: '100000' });
  await call('POST', '/api/kasa/transfer', { tarih: D(9), kaynak_id: 5, hedef_id: 2, tutar: '410000', hedef_tutar: '10000' });
  // Döviz satışı: 5 kişi, biri POS (komisyonlu), biri havale, biri kısmen veresiye.
  await call('POST', '/api/doviz', { tarih: D(8), islem: 'SAT', doviz: 'USD', miktar: '1500', kur: '41.50', kisi: 'Ahmet' });
  await call('POST', '/api/doviz', { tarih: D(7), islem: 'SAT', doviz: 'USD', miktar: '1000', kur: '41.60', kisi: 'Ayşe', kasa: [{ hesap_id: 4, tutar: '41600' }] });
  await call('POST', '/api/doviz', { tarih: D(6), islem: 'SAT', doviz: 'USD', miktar: '2000', kur: '41.55', kisi: 'Mehmet', kasa: [{ hesap_id: 5, tutar: '83100' }] });
  await call('POST', '/api/doviz', { tarih: D(5), islem: 'SAT', doviz: 'USD', miktar: '500', kur: '41.70', kisi: 'Zeynep', kasa: [{ hesap_id: 1, tutar: '10425' }] });
  await call('POST', '/api/doviz', { tarih: D(4), islem: 'SAT', doviz: 'USD', miktar: '1000', kur: '41.65', kisi: 'Hakan' });
  // 100 gr külçe (milyem 995, has 6.400) bankadan; 5 kişiye 1000 milyemle satış, biri veresiye.
  await call('POST', '/api/alis', { tarih: D(8), tedarikci: 'Can Altın A.Ş.', cinsi: 'KÜLÇE', ayar: '24', gram: '100', milyem: '995', has_fiyati: '6400', odeme_tipi: 'TAM_KAPAT', kasa: [{ hesap_id: 5, tutar: '636800' }] });
  const sat = (n, musteri, gram, fiyat, kasa) => call('POST', '/api/satis', { tarih: D(n), musteri, cinsi: 'KÜLÇE', ayar: '24', gram, satis_milyem: '1000', stoktan: true, has_fiyati: fiyat, odeme_tipi: kasa.length ? 'TAM_KAPAT' : 'ODEME_YOK', kasa });
  await sat(7, 'Elif', '10', '6450', [{ hesap_id: 1, tutar: '64500' }]);
  await sat(6, 'Burak', '15', '6470', [{ hesap_id: 4, tutar: '97050' }]);
  await sat(5, 'Selin', '20', '6480', [{ hesap_id: 5, tutar: '129600' }]);
  await sat(4, 'Murat', '25', '6500', [{ hesap_id: 1, tutar: '100000' }, { hesap_id: 4, tutar: '62500' }]);
  await sat(3, 'Deniz', '30', '6520', []);
  // 100 gr hurda (milyem 912, has 6.380) bankadan; 70 gr 4 kişiye 916 milyemle.
  await call('POST', '/api/hurda', { tarih: D(6), islem_turu: 'ALIS', kisi: 'Fatma', cinsi: 'BİLEZİK', ayar: '22', gram: '100', milyem: '912', has_fiyati: '6380', odeme_tipi: 'TAM_KAPAT', kasa: [{ hesap_id: 5, tutar: '581856' }] });
  const hsat = (n, kisi, gram, fiyat, hesap, tutar) => call('POST', '/api/hurda', { tarih: D(n), islem_turu: 'SATIS', kisi, cinsi: 'BİLEZİK', ayar: '22', gram, milyem: '916', has_fiyati: fiyat, stoktan: true, odeme_tipi: 'TAM_KAPAT', kasa: [{ hesap_id: hesap, tutar }] });
  await hsat(5, 'Ali', '15', '6420', 1, '88210.8');
  await hsat(4, 'Emre', '20', '6440', 5, '117980.8');
  await hsat(3, 'Gizem', '15', '6460', 1, '88760.4');
  await hsat(2, 'Toptancı', '20', '6470', 5, '118530.4');

  const kasa = await call('GET', `/api/kasa?tarih=${TODAY}`);
  const bakiye = Object.fromEntries(kasa.hesaplar.map((x) => [x.ad, x.bakiye]));
  assert.deepEqual(bakiye, { 'Nakit TL': 555796.2, 'Nakit Dolar': 4000, 'Nakit Euro': 0, POS: 196121.25, Banka: 320555.2 });

  const r = await call('GET', `/api/rapor?baslangic=${D(10)}&bitis=${TODAY}`);
  assert.deepEqual([r.ozet.satis_tl, r.ozet.brut_kar_tl, r.ozet.milyem_kari_has], [649250, 12450, 0.5]);
  assert.deepEqual([r.ozet.hurda_satis_tl, r.ozet.hurda_kar_tl, r.ozet.hurda_satis_islem, r.ozet.hurda_satis_gram], [413482.4, 6183.2, 4, 70]);
  assert.deepEqual(r.doviz.map((x) => [x.doviz, x.satis_miktar, x.satis_tl, x.kar_tl]), [['USD', 6000, 249450, 3450]]);
  // Bankadan çekilen dolar müşteri alışı değildir; transferle giren olarak ayrıca görünür (kur 41).
  assert.deepEqual(r.doviz.map((x) => [x.alis_miktar, x.transfer_giris, x.transfer_giris_tl, x.transfer_cikis]), [[0, 10000, 410000, 0]]);
  // POS komisyonu kâr değil: ayrı raporlanır, net kâr = 12.450 + 6.183,20 + 3.450 − 5.028,75.
  assert.equal(r.ozet.komisyon_tl, 5028.75);
  assert.deepEqual(r.komisyon.map((k) => [k.tarih, k.hesap, k.kategori, k.tutar, k.komisyon, k.net]), [
    [D(7), 'POS', 'DOVIZ_SATIS', 41600, 1040, 40560],
    [D(6), 'POS', 'SATIS', 97050, 2426.25, 94623.75],
    [D(4), 'POS', 'SATIS', 62500, 1562.5, 60937.5],
  ]);
  assert.equal(r.ozet.brut_kar_tl + r.ozet.hurda_kar_tl + 3450 - r.ozet.komisyon_tl, 17054.45);
  assert.equal((await call('GET', `/api/kasa/komisyon?baslangic=2000-01-01`)).komisyon_tl, 5028.75);
  // Kalan hurda stoğu raporun stok değerinde görünür (maliyetiyle).
  assert.deepEqual(r.stok, [{ tur: 'Hurda', cinsi: 'BİLEZİK', ayar: '22', kalan_gram: 30, kalan_has: 27.36, maliyet: 174556.8 }]);

  const dv = await call('GET', '/api/doviz');
  assert.deepEqual(dv.stok.find((x) => x.doviz === 'USD'), { ...dv.stok.find((x) => x.doviz === 'USD'), nakit: 4000, ortalama_maliyet: 41, maliyet_tl: 164000 });
  const cari = Object.fromEntries((await call('GET', '/api/cari')).kisiler.map((p) => [p.isim, [p.net_bakiye_has, p.doviz_bakiye]]));
  assert.deepEqual(cari.DENİZ, [30, {}]);
  assert.deepEqual(cari.ZEYNEP, [0, { USD: 250 }]);
  assert.deepEqual(cari['CAN ALTIN A.Ş.'], [0, {}]);
  assert.deepEqual(cari.ALİ, [0, {}]);
});
