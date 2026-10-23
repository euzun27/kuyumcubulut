// Cari kartları, sipariş/tamir takibi ve vade uyarıları (bulut sürümünün ek modülleri).
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

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (days) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const nakit = async (c, day) => (await c.call('GET', `/api/kasa?tarih=${day}`)).body.data.hesaplar.find((h) => h.ad === 'Nakit TL');

test('cari kartı: tür, telefon, vade; isim değişince ve silinince taşınır', async () => {
  const c = await client();
  const put = await c.call('PUT', '/api/cari-kart', { isim: 'Usta Atölye', tur: 'atolye', telefon: '0555', vade_gun: '15', limit_has: '50' });
  assert.equal(put.status, 200);
  assert.equal(put.body.data.tur, 'ATOLYE');
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'X', tur: 'BAŞKA' })).status, 422);
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'X', vade_gun: '-1' })).status, 422);
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'X', kisi_tipi: 'KURUM' })).status, 422);
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'X', vergi_no: '123' })).status, 422);
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'X', eposta: 'yok' })).status, 422);
  const firma = await c.call('PUT', '/api/cari-kart', { isim: 'Dünya Ltd', tur: 'TOPTANCI', kisi_tipi: 'tuzel', vergi_dairesi: 'Kadıköy', vergi_no: '1234567890', eposta: 'info@dunya.com', yetkili: 'Ahmet', il: 'İstanbul' });
  assert.deepEqual([firma.body.data.kisi_tipi, firma.body.data.vergi_no, firma.body.data.yetkili], ['TUZEL', '1234567890', 'Ahmet']);
  // Aynı isim farklı yazımla güncellenir.
  await c.call('PUT', '/api/cari-kart', { isim: 'usta atölye', tur: 'ATOLYE', telefon: '0532' });
  let list = (await c.call('GET', '/api/cari-kart')).body.data;
  const usta = list.kartlar.find((k) => k.anahtar === 'usta atolye');
  assert.equal(list.kartlar.length, 2);
  assert.equal(usta.telefon, '0532');
  assert.equal(usta.kisi_tipi, 'SAHIS');
  assert.equal(usta.vade_gun, null);
  assert.equal(list.vade_gun_varsayilan, 30);
  await c.call('POST', '/api/alis', { tarih: TODAY, tedarikci: 'usta atölye', cinsi: 'BILEZIK', ayar: '22', gram: '10', milyem: '916' });
  await c.call('PUT', '/api/cari/kisi', { eski_isim: 'usta atölye', yeni_isim: 'Usta Kuyumculuk' });
  list = (await c.call('GET', '/api/cari-kart')).body.data;
  assert.deepEqual(list.kartlar.map((k) => [k.isim, k.tur]), [['DÜNYA LTD', 'TOPTANCI'], ['USTA KUYUMCULUK', 'ATOLYE']]);
  await c.call('POST', '/api/cari/kisi/sil', { isim: 'Usta Kuyumculuk' });
  assert.equal((await c.call('GET', '/api/cari-kart')).body.data.kartlar.length, 1);
});

test('sipariş: kapora ve teslim ödemesi kasaya bağlı, durum akışı, silinince kasa temizlenir', async () => {
  const c = await client();
  assert.equal((await c.call('POST', '/api/siparis', { musteri: 'Ayşe', urun: '' })).status, 422);
  assert.equal((await c.call('POST', '/api/siparis', { tarih: TODAY, musteri: 'Ayşe', urun: 'Yüzük', teslim_tarihi: shift(-1) })).status, 422);
  const res = await c.call('POST', '/api/siparis', {
    tarih: TODAY, tur: 'SIPARIS', musteri: 'Ayşe', telefon: '0555', urun: 'İsimli kolye', cinsi: 'KOLYE', ayar: '14', gram: '4,5', tutar: '12000',
    teslim_tarihi: shift(1), kasa: [{ hesap_id: 1, tutar: '3000' }],
  });
  assert.equal(res.status, 201);
  const id = res.body.data.id;
  assert.equal((await nakit(c, TODAY)).bakiye, 3000);
  let data = (await c.call('GET', '/api/siparis')).body.data;
  assert.deepEqual([data.kayitlar[0].kapora, data.kayitlar[0].kalan_tl, data.kayitlar[0].kalan_gun], [3000, 9000, 1]);
  assert.equal(data.ozet.acik, 1);
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${TODAY}&bitis=${TODAY}`)).body.data;
  assert.equal(moves[0].kaynak, 'Sipariş');
  assert.equal(moves[0].kategori, 'SIPARIS_KAPORA');
  assert.equal((await c.call('DELETE', `/api/kasa/hareket/${moves[0].id}`)).status, 400);
  // Atölyeye giderken atölye adı zorunlu.
  assert.equal((await c.call('POST', `/api/siparis/${id}/durum`, { durum: 'ATOLYEDE' })).status, 422);
  assert.equal((await c.call('POST', `/api/siparis/${id}/durum`, { durum: 'ATOLYEDE', atolye: 'Usta' })).status, 200);
  await c.call('POST', `/api/siparis/${id}/durum`, { durum: 'HAZIR' });
  // Teslimde kalan para POS'tan alınır.
  await c.call('POST', `/api/siparis/${id}/durum`, { durum: 'TESLIM', tarih: TODAY, kasa: [{ hesap_id: 4, tutar: '9000' }] });
  data = (await c.call('GET', '/api/siparis')).body.data;
  const row = data.kayitlar[0];
  assert.deepEqual([row.durum, row.atolye, row.teslim_edildi, row.alinan_tl, row.kalan_tl, row.kalan_gun], ['TESLIM', 'USTA', TODAY, 12000, 0, null]);
  assert.equal(data.ozet.acik, 0);
  // Düzenleme kasa alanı olmadan kaporayı korur.
  assert.equal((await c.call('PUT', `/api/siparis/${id}`, { tarih: TODAY, musteri: 'Ayşe K.', urun: 'İsimli kolye', tutar: '12000' })).status, 200);
  assert.equal((await nakit(c, TODAY)).bakiye, 3000);
  // Geri alınınca teslim ödemesi silinir.
  await c.call('POST', `/api/siparis/${id}/durum`, { durum: 'HAZIR' });
  assert.equal((await c.call('GET', `/api/kasa?tarih=${TODAY}`)).body.data.hesaplar.find((h) => h.ad === 'POS').bakiye, 0);
  assert.equal((await c.call('DELETE', `/api/siparis/${id}`)).status, 200);
  assert.equal((await nakit(c, TODAY)).bakiye, 0);
});

test('uyarılar: vadesi geçen cari, has limiti ve teslim günü gelen sipariş', async () => {
  const c = await client();
  const old = shift(-40);
  await c.call('POST', '/api/alis', { tarih: old, tedarikci: 'Toptancı', cinsi: 'BILEZIK', ayar: '22', gram: '100', milyem: '916' });
  await c.call('POST', '/api/satis', { tarih: old, musteri: 'Borçlu', cinsi: 'BILEZIK', ayar: '22', gram: '10', satis_milyem: '950', stoktan: true });
  await c.call('POST', '/api/satis', { tarih: TODAY, musteri: 'Yeni', cinsi: 'BILEZIK', ayar: '22', gram: '30', satis_milyem: '950', stoktan: true });
  await c.call('POST', '/api/siparis', { tarih: shift(-5), musteri: 'Geciken', urun: 'Tamir', tur: 'TAMIR', teslim_tarihi: shift(-2) });
  await c.call('POST', '/api/siparis', { tarih: TODAY, musteri: 'Uzak', urun: 'Yüzük', teslim_tarihi: shift(10) });
  let u = (await c.call('GET', '/api/uyarilar')).body.data;
  assert.deepEqual(u.vade.map((v) => [v.isim, v.yon, v.gun]).sort(), [['BORÇLU', 'ALACAK', 40], ['TOPTANCI', 'BORC', 40]]);
  assert.equal(u.limit.length, 0);
  assert.deepEqual(u.siparis.map((s) => [s.musteri, s.kalan_gun]), [['GECİKEN', -2]]);
  // Kartta vade 0 = uyarı yok; limit aşımı ayrıca bildirilir.
  await c.call('PUT', '/api/cari-kart', { isim: 'Toptancı', tur: 'TOPTANCI', vade_gun: '0' });
  await c.call('PUT', '/api/cari-kart', { isim: 'Yeni', limit_has: '20' });
  u = (await c.call('GET', '/api/uyarilar')).body.data;
  assert.deepEqual(u.vade.map((v) => v.isim), ['BORÇLU']);
  assert.deepEqual(u.limit.map((v) => [v.isim, v.limit_has]), [['YENİ', 20]]);
  // Genel vade ayarı.
  await c.call('PUT', '/api/cari-kart/ayar', { vade_gun_varsayilan: '60' });
  u = (await c.call('GET', '/api/uyarilar')).body.data;
  assert.equal(u.vade.length, 0);
  assert.equal(u.toplam, 2);
});

test('işlemi olmayan atölyeye kartla has ödemesi yapılabilir', async () => {
  const c = await client();
  assert.equal((await c.call('POST', '/api/cari/odeme', { tarih: TODAY, isim: 'Yeni Atölye', yon: 'ODEME', odeme_tipi: 'HAS', odenen_has: '10' })).status, 404);
  await c.call('PUT', '/api/cari-kart', { isim: 'Yeni Atölye', tur: 'ATOLYE' });
  const pay = await c.call('POST', '/api/cari/odeme', { tarih: TODAY, isim: 'Yeni Atölye', yon: 'ODEME', odeme_tipi: 'HAS', odenen_has: '10' });
  assert.equal(pay.body.status, 'ok');
  const kisi = (await c.call('GET', '/api/cari')).body.data.kisiler.find((k) => k.isim === 'YENİ ATÖLYE');
  assert.equal(kisi.kalan_has, 10); // atölyedeki altınımız
  assert.equal((await c.call('PUT', '/api/cari-kart', { isim: 'Boş Kart' })).status, 200);
  assert.equal((await c.call('PUT', '/api/cari/kisi', { eski_isim: 'Boş Kart', yeni_isim: 'Dolu Kart' })).status, 200);
  assert.equal((await c.call('POST', '/api/cari/kisi/sil', { isim: 'Dolu Kart' })).status, 200);
  assert.deepEqual((await c.call('GET', '/api/cari-kart')).body.data.kartlar.map((k) => k.isim), ['YENİ ATÖLYE']);
});

test('verileri sıfırla: yönetici parolası ister, yalnızca işlem verilerini siler, son yedekle geri alınır', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', gram: '10', milyem: '916' });
  await c.call('POST', '/api/satis', { musteri: 'Erdal', cinsi: 'BİLEZİK', ayar: '22', gram: '2', satis_milyem: '935', stoktan: true });
  await c.call('PUT', '/api/cari-kart', { isim: 'Erdal', telefon: '0555' });
  assert.equal((await c.call('POST', '/api/verileri-sifirla', {})).status, 403);
  assert.equal((await c.call('POST', '/api/verileri-sifirla', { parola: 'yanlis' })).status, 403);
  const ok = await c.call('POST', '/api/verileri-sifirla', { parola: 'gizli-parola' });
  assert.equal(ok.status, 200);
  assert.equal((await c.call('GET', '/api/satis')).body.data.length, 0);
  assert.equal((await c.call('GET', '/api/alis')).body.data.length, 0);
  assert.equal((await c.call('GET', '/api/cari-kart')).body.data.kartlar.length, 0);
  assert.ok((await nakit(c, TODAY)), 'kasa hesapları korunur');
  assert.equal((await c.call('GET', '/api/auth/me')).status, 200, 'kullanıcı ve oturum korunur');
  const geri = await c.call('POST', '/api/restore-latest');
  assert.equal(geri.status, 200);
  assert.equal((await c.call('GET', '/api/satis')).body.data.length, 1);
  assert.equal((await c.call('GET', '/api/cari-kart')).body.data.kartlar.length, 1);
});

test('yedekler: liste, indirme, seçilen yedeği ve dosyadan geri yükleme', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', gram: '10', milyem: '916' });
  const ilk = await c.call('POST', '/api/backup');
  await c.call('POST', '/api/satis', { musteri: 'Erdal', cinsi: 'BİLEZİK', ayar: '22', gram: '2', satis_milyem: '935', stoktan: true });
  await c.call('POST', '/api/backup');
  const liste = (await c.call('GET', '/api/yedekler')).body.data;
  assert.ok(liste.length >= 2);
  const dosya = (await c.call('GET', `/api/yedekler/${ilk.body.data.id}`)).body.data;
  assert.equal(dosya.app, 'dunyatek-kuyumcu');
  assert.equal(dosya.tables.satis.length, 0);
  assert.equal((await c.call('GET', '/api/yedekler/son')).body.data.tables.satis.length, 1);
  // Seçilen (ilk) yedeğe dönüş: satış yok olur.
  assert.equal((await c.call('POST', `/api/yedekler/${ilk.body.data.id}/geri-yukle`)).status, 200);
  assert.equal((await c.call('GET', '/api/satis')).body.data.length, 0);
  // Bilgisayardaki dosyadan geri yükleme.
  const son = (await c.call('GET', '/api/yedekler')).body.data.find((y) => y.reason === 'manual' && y.id !== ilk.body.data.id);
  const tam = (await c.call('GET', `/api/yedekler/${son.id}`)).body.data;
  assert.equal((await c.call('POST', '/api/yedek-dosyadan', { name: 'x', tables: { satis: 'bozuk' } })).status, 422);
  assert.equal((await c.call('POST', '/api/yedek-dosyadan', tam)).status, 200);
  assert.equal((await c.call('GET', '/api/satis')).body.data.length, 1);
});

test('dışa aktarma dosyası başka bir bilgisayarda yedek olarak geri yüklenir', async () => {
  const eski = await client();
  await eski.call('POST', '/api/alis', { tedarikci: 'Toptancı', cinsi: 'BİLEZİK', ayar: '22', gram: '10', milyem: '916' });
  await eski.call('POST', '/api/satis', { musteri: 'Erdal', cinsi: 'BİLEZİK', ayar: '22', gram: '2', satis_milyem: '935', stoktan: true });
  await eski.call('POST', '/api/emanet', { kisi: 'Kemal', yon: 'ALINAN', tur: 'ALTIN', cinsi: 'ÇEYREK', ayar: '22', gram: '7', milyem: '916' });
  const dosya = (await eski.call('GET', '/api/export')).body.data;
  assert.equal(dosya.app, 'dunyatek-kuyumcu');
  assert.equal(dosya.tables.satis.length, 1);
  // Ayrı veritabanı = başka bilgisayar.
  const yeni = await client();
  assert.equal((await yeni.call('POST', '/api/yedek-dosyadan', { ...dosya, name: 'kuyumcu_disa_aktarim.json' })).status, 200);
  assert.equal((await yeni.call('GET', '/api/satis')).body.data.length, 1);
  assert.equal((await yeni.call('GET', '/api/alis')).body.data.length, 1);
  assert.equal((await yeni.call('GET', '/api/stok/normal')).body.data[0].kalan_gram, 8);
  assert.equal(dosya.emanetler.length, 1);
  assert.deepEqual((await yeni.call('GET', '/api/export')).body.data.emanetler.map((e) => e.kisi), dosya.emanetler.map((e) => e.kisi));
});
