// Ürün etiketleri: barkod, pırlanta bilgisi, satışta okutma.
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

test('etiket oluşturma, barkodla bulma, pırlanta alanları ve doğrulama', async () => {
  const c = await client();
  const alis = (await c.call('POST', '/api/alis', { tarih: DAY, tedarikci: 'Toptancı', cinsi: 'YÜZÜK', ayar: '14', gram: '20', milyem: '585' })).body.data;
  assert.equal((await c.call('POST', '/api/etiket', { cinsi: '' })).status, 422);
  assert.equal((await c.call('POST', '/api/etiket', { cinsi: 'YÜZÜK', ayar: '14' })).status, 422); // gram/fiyat yok
  assert.equal((await c.call('POST', '/api/etiket', { cinsi: 'YÜZÜK', gram: '2', tas_tipi: 'YAKUT' })).status, 422);
  assert.equal((await c.call('POST', '/api/etiket', { cinsi: 'YÜZÜK', gram: '2', kopya: 500 })).status, 422);
  const made = await c.call('POST', '/api/etiket', {
    kopya: 2, items: [{ tarih: DAY, alis_id: alis.id, cinsi: 'yüzük', ayar: '14', model: 'TS-01', gram: '2,35', milyem: '585', iscilik: '750', fiyat: '45000',
      tas_tipi: 'pirlanta', tas_adet: 1, karat: '0,25', renk: 'g', berraklik: 'vs1', kesim: 'Yuvarlak', sertifika: 'GIA 123' }],
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.data.length, 2);
  const [a, b] = made.body.data;
  assert.equal(a.barkod, `DT${String(a.id).padStart(6, '0')}`);
  assert.deepEqual([a.cinsi, a.gram, a.karat, a.renk, a.berraklik, a.tas_tipi], ['YÜZÜK', 2.35, 0.25, 'G', 'VS1', 'PIRLANTA']);
  for (const code of [a.barkod, a.barkod.toLowerCase(), String(a.id)]) assert.equal((await c.call('GET', `/api/etiket/kod/${code}`)).body.data.id, a.id);
  assert.equal((await c.call('GET', '/api/etiket/kod/DT999999')).status, 404);
  assert.equal((await c.call('GET', '/api/etiket/kod/xyz')).status, 400);
  const list = (await c.call('GET', '/api/etiket')).body.data;
  assert.deepEqual([list.ozet.stokta, list.ozet.gram, list.ozet.karat, list.ozet.pirlanta], [2, 4.7, 0.5, 2]);
  assert.equal((await c.call('PUT', `/api/etiket/${b.id}`, { cinsi: 'YÜZÜK', ayar: '14', gram: '2,4' })).body.data.gram, 2.4);
  assert.equal((await c.call('DELETE', `/api/etiket/${b.id}`)).status, 200);
});

test('satışta okutulan etiket satıldı olur; satış silinince stoğa döner', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tarih: DAY, tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', gram: '50', milyem: '916' });
  const [tag, other] = (await c.call('POST', '/api/etiket', { items: [{ cinsi: 'BİLEZİK', ayar: '22', gram: '10' }, { cinsi: 'BİLEZİK', ayar: '22', gram: '12' }] })).body.data;
  const sale = { tarih: DAY, musteri: 'Ayşe', cinsi: 'BİLEZİK', ayar: '22', gram: '10', satis_milyem: '935', stoktan: true };
  const res = await c.call('POST', '/api/satis', { ...sale, etiket_id: tag.barkod });
  assert.equal(res.body.status, 'ok');
  const saleId = res.body.data.id;
  let row = (await c.call('GET', `/api/etiket/kod/${tag.id}`)).body.data;
  assert.deepEqual([row.durum, row.satis_id], ['SATILDI', saleId]);
  assert.equal((await c.call('GET', '/api/satis')).body.data[0].etiket.barkod, tag.barkod);
  // Aynı etiket ikinci kez satılamaz, satılmış etiket silinemez.
  assert.equal((await c.call('POST', '/api/satis', { ...sale, etiket_id: tag.id })).status, 422);
  assert.equal((await c.call('DELETE', `/api/etiket/${tag.id}`)).status, 400);
  // Düzenlemede başka etiket seçilirse eskisi stoğa döner.
  await c.call('PUT', `/api/satis/${saleId}`, { ...sale, gram: '12', etiket_id: other.barkod });
  assert.equal((await c.call('GET', `/api/etiket/kod/${tag.id}`)).body.data.durum, 'STOKTA');
  assert.equal((await c.call('GET', `/api/etiket/kod/${other.id}`)).body.data.durum, 'SATILDI');
  // etiket_id gönderilmezse bağlantı korunur.
  await c.call('PUT', `/api/satis/${saleId}`, { ...sale, gram: '12' });
  assert.equal((await c.call('GET', `/api/etiket/kod/${other.id}`)).body.data.durum, 'SATILDI');
  await c.call('DELETE', `/api/satis/${saleId}`);
  row = (await c.call('GET', `/api/etiket/kod/${other.id}`)).body.data;
  assert.deepEqual([row.durum, row.satis_id], ['STOKTA', null]);
});

test('rapor: aralıktaki satış, alış, ürün/müşteri dağılımı, kasa ve yaşlandırma', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tarih: '2026-03-01', tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', gram: '100', milyem: '916', has_fiyati: '3000' });
  await c.call('POST', '/api/satis', { tarih: '2026-03-05', musteri: 'Ayşe', cinsi: 'BİLEZİK', ayar: '22', gram: '10', satis_milyem: '950', stoktan: true, has_fiyati: '3100', kasa: [{ hesap_id: 1, tutar: '29450' }], odeme_tipi: 'TAM_KAPAT' });
  await c.call('POST', '/api/satis', { tarih: '2026-03-06', musteri: 'Veli', cinsi: 'BİLEZİK', ayar: '22', gram: '5', satis_milyem: '940', stoktan: true, has_fiyati: '3100', adet: '1' });
  await c.call('POST', '/api/satis', { tarih: '2026-04-01', musteri: 'Ayşe', cinsi: 'BİLEZİK', ayar: '22', gram: '1', satis_milyem: '940', stoktan: true, has_fiyati: '3100' });
  assert.equal((await c.call('GET', '/api/rapor?baslangic=2026-03-10&bitis=2026-03-01')).status, 422);
  const r = (await c.call('GET', '/api/rapor?baslangic=2026-03-01&bitis=2026-03-31')).body.data;
  assert.equal(r.ozet.satis_islem, 2);
  assert.equal(r.ozet.satis_gram, 15);
  assert.equal(r.ozet.satis_has, 14.2); // 9,5 + 4,7
  assert.equal(r.ozet.satis_tl, 44020); // 14,2 × 3100
  assert.equal(r.ozet.alis_tl, 274800); // 91,6 × 3000
  assert.equal(r.ozet.brut_kar_tl, 44020 - 13.74 * 3000);
  assert.deepEqual(r.urunler.map((u) => [u.ad, u.ayar, u.islem, u.gram]), [['BİLEZİK', '22', 2, 15]]);
  assert.deepEqual(r.musteriler.map((m) => [m.ad, m.tutar]), [['AYŞE', 29450], ['VELİ', 14570]]);
  assert.deepEqual(r.personel.map((p) => [p.ad, p.islem]), [['Yönetici', 2]]);
  assert.deepEqual(r.gunler.map((g) => g.tarih), ['2026-03-01', '2026-03-05', '2026-03-06']);
  assert.deepEqual(r.kasa.map((k) => [k.kategori, k.giris]), [['SATIS', 29450]]);
  const aging = Object.fromEntries(r.yaslandirma.map((b) => [b.ad, [b.alacak_sayi, b.borc_sayi]]));
  assert.equal(Object.values(aging).reduce((t, [a]) => t + a, 0), 2); // Ayşe (son alım borç) ve Veli
  assert.equal(r.stok[0].kalan_gram, 84);
});
