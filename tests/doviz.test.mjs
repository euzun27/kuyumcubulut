// Döviz alış / satış: kasa (Nakit Dolar / Euro) tek kaynak, cari döviz bakiyesi, kâr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

// Bu testler kasayı bilerek eksiye düşürür; TL eksi bakiye onayı kasa.test.mjs'de ayrıca denenir.
const onay = (b) => (b && typeof b === 'object' && !Array.isArray(b) && !('eksi_onay' in b) ? { ...b, eksi_onay: true } : b);

async function client() {
  globalThis.__kuyumcu_day__ = undefined;
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

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (days) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const bakiye = async (c, ad) => (await c.call('GET', `/api/kasa?tarih=${TODAY}`)).body.data.hesaplar.find((h) => h.ad === ad).bakiye;

test('döviz alış ve satış kasaya bağlı: dolar Nakit Dolar hesabına, TL Nakit TL hesabına; kâr ortalama maliyetle', async () => {
  const c = await client();
  // Kasada dolar yokken satış yapılamaz.
  const bos = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'SAT', doviz: 'USD', miktar: '100', kur: '35' });
  assert.equal(bos.status, 422);
  assert.match(bos.body.message, /Nakit Dolar/);
  // Dün 1000 $ 34'ten, bugün 1000 $ 36'dan alındı (kasa gönderilmezse tamamı nakit TL).
  const a1 = await c.call('POST', '/api/doviz', { tarih: shift(-1), islem: 'AL', doviz: 'USD', miktar: '1000', kur: '34' });
  assert.equal(a1.status, 201);
  assert.deepEqual([a1.body.data.tutar_tl, a1.body.data.kalan], [34000, 0]);
  const a2 = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '36', kisi: 'ali kaya', kasa: [{ hesap_id: 1, tutar: '36000' }] });
  assert.equal(a2.status, 201);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 2000);
  assert.equal(await bakiye(c, 'Nakit TL'), -70000);
  // 500 $ 37'den satış; karşılığı kartla (POS) ve nakit.
  const s = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'SAT', doviz: 'USD', miktar: '500', kur: '37', kasa: [{ hesap_id: 1, tutar: '10000' }, { hesap_id: 4, tutar: '8500' }] });
  assert.equal(s.status, 201);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 1500);
  assert.equal(await bakiye(c, 'Nakit TL'), -60000);
  assert.equal(await bakiye(c, 'POS'), 8500);
  // Aynı dövizle karşılık ödenemez; ödeme işlem tutarını aşamaz.
  assert.equal((await c.call('POST', '/api/doviz', { islem: 'SAT', doviz: 'USD', miktar: '10', kur: '37', kasa: [{ hesap_id: 2, tutar: '10' }] })).status, 422);
  assert.equal((await c.call('POST', '/api/doviz', { islem: 'SAT', doviz: 'USD', miktar: '10', kur: '37', kasa: [{ hesap_id: 1, tutar: '400' }] })).status, 422);

  const data = (await c.call('GET', '/api/doviz')).body.data;
  const sat = data.kayitlar.find((r) => r.id === s.body.data.id);
  // Ortalama maliyet (34 + 36) / 2 = 35 -> kâr 500 x (37 - 35) = 1000 TL.
  assert.deepEqual([sat.tutar_tl, sat.odenen_tl, sat.kalan, sat.kar_tl, sat.doviz_hesap], [18500, 18500, 0, 1000, 'Nakit Dolar']);
  assert.equal(sat.kasa_odemeleri.length, 2);
  const usd = data.stok.find((x) => x.doviz === 'USD');
  assert.deepEqual([usd.nakit, usd.ortalama_maliyet, usd.maliyet_tl], [1500, 35, 52500]);
  assert.equal(data.ozet.bugun_kar_tl, 1000);
  const bugun = data.bugun.find((x) => x.doviz === 'USD');
  assert.deepEqual([bugun.alis_miktar, bugun.satis_miktar, bugun.satis_tl, bugun.kar_tl], [1000, 500, 18500, 1000]);

  // Kasa hareketleri "Döviz" kaynağıyla görünür ve elle düzenlenemez.
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${TODAY}&bitis=${TODAY}`)).body.data;
  assert.ok(moves.length >= 4 && moves.every((m) => m.kaynak === 'Döviz' && !m.duzenlenebilir));
  assert.equal(moves.find((m) => m.kategori === 'DOVIZ_ALIS' && m.para_birimi === 'USD').kur, 36);
  // Gün sonu ve rapor döviz özetini içerir.
  const gs = (await c.call('GET', `/api/kasa/gun-sonu?tarih=${TODAY}`)).body.data;
  assert.equal(gs.doviz.find((x) => x.doviz === 'USD').kar_tl, 1000);
  const rapor = (await c.call('GET', `/api/rapor?baslangic=${shift(-1)}&bitis=${TODAY}`)).body.data;
  assert.deepEqual(rapor.doviz.map((x) => [x.doviz, x.alis_miktar, x.alis_tl, x.satis_miktar]), [['USD', 2000, 70000, 500]]);

  // Satılmış dövizin alışı kasayı eksiye düşürecekse iptal edilemez; silme yoktur, iptal ters kayıt atar.
  assert.equal((await c.call('DELETE', `/api/doviz/${s.body.data.id}`)).status, 405);
  assert.equal((await c.call('POST', `/api/doviz/${s.body.data.id}/iptal`, {})).status, 422); // gerekçe zorunlu
  assert.equal((await c.call('POST', `/api/doviz/${a2.body.data.id}/iptal`, { gerekce: 'yanlış kur' })).status, 200); // 1000 $ kalır, 500 satıldı
  assert.equal((await c.call('POST', `/api/doviz/${a1.body.data.id}/iptal`, { gerekce: 'deneme' })).status, 422);
  assert.equal((await c.call('POST', `/api/doviz/${s.body.data.id}/iptal`, { gerekce: 'müşteri vazgeçti' })).status, 200);
  assert.equal((await c.call('POST', `/api/doviz/${s.body.data.id}/iptal`, { gerekce: 'tekrar' })).status, 422);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 1000);
  assert.equal(await bakiye(c, 'POS'), 0);
  assert.equal((await c.call('POST', `/api/doviz/${a1.body.data.id}/iptal`, { gerekce: 'deneme' })).status, 200);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 0);
  assert.equal(await bakiye(c, 'Nakit TL'), 0);
  // Kayıtlar durur (iptal olarak), ters kayıtlar kasada görünür; kâr ve özet iptalleri saymaz.
  const after = (await c.call('GET', '/api/doviz')).body.data;
  assert.equal(after.kayitlar.length, 3);
  assert.ok(after.kayitlar.every((r) => r.durum === 'IPTAL' && r.iptal_gerekce && r.kar_tl === null));
  assert.equal(after.ozet.toplam_kar_tl, 0);
  const iptalMoves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${shift(-1)}&bitis=${TODAY}`)).body.data.filter((m) => m.kategori === 'DOVIZ_IPTAL');
  assert.equal(iptalMoves.length, 7);
});

test('veresiye döviz cariye döviz olarak geçer, kur değişse de aynı miktar kalır; tahsilatla kapanır', async () => {
  const c = await client();
  await c.call('POST', '/api/kasa/hareket', { tarih: TODAY, hesap_id: 3, kategori: 'DEVIR', yon: 'GIRIS', tutar: '5000' });
  // Euro satışı: 1000 € x 38 = 38000 TL; 19000 TL ödendi -> 500 € borç.
  const isimsiz = await c.call('POST', '/api/doviz', { islem: 'SAT', doviz: 'EUR', miktar: '1000', kur: '38', kasa: [{ hesap_id: 1, tutar: '19000' }] });
  assert.equal(isimsiz.status, 422); // veresiye isim ister
  const s = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'SAT', doviz: 'EUR', miktar: '1000', kur: '38', kisi: 'Veli Can', telefon: '0555', kasa: [{ hesap_id: 1, tutar: '19000' }] });
  assert.equal(s.status, 201);
  assert.equal(s.body.data.kalan, 500);
  assert.equal(s.body.data.kisi, 'VELİ CAN');
  assert.equal(await bakiye(c, 'Nakit Euro'), 4000);
  let cari = (await c.call('GET', '/api/cari')).body.data;
  let veli = cari.kisiler.find((k) => k.isim === 'VELİ CAN');
  assert.deepEqual(veli.doviz_bakiye, { EUR: 500 });
  assert.equal(veli.net_bakiye_has, 0); // has carisi etkilenmez
  // Kur 40 olsa da borç 500 €; 200 € euro olarak, 300 € karşılığı TL (40'tan 12000) tahsil edildi.
  const t1 = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'TAHSILAT', doviz: 'EUR', miktar: '200', kur: '40', kisi: 'veli can', kasa: [{ hesap_id: 3, tutar: '200' }] });
  assert.equal(t1.status, 201);
  const t2 = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'TAHSILAT', doviz: 'EUR', miktar: '300', kur: '40', kisi: 'VELİ CAN', kasa: [{ hesap_id: 1, tutar: '12000' }] });
  assert.equal(t2.status, 201);
  assert.equal(await bakiye(c, 'Nakit Euro'), 4200);
  assert.equal(await bakiye(c, 'Nakit TL'), 31000);
  cari = (await c.call('GET', '/api/cari')).body.data;
  veli = cari.kisiler.find((k) => k.isim === 'VELİ CAN');
  assert.deepEqual(veli.doviz_bakiye, {});
  // Cari adı değişince döviz kayıtları ve kasa hareketleri de taşınır; açık döviz işlemi olan cari silinemez.
  assert.equal((await c.call('PUT', '/api/cari/kisi', { eski_isim: 'VELİ CAN', yeni_isim: 'VELİ CANLI' })).status, 200);
  const rows = (await c.call('GET', '/api/doviz')).body.data.kayitlar;
  assert.ok(rows.every((r) => r.kisi === 'VELİ CANLI'));
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${TODAY}&bitis=${TODAY}`)).body.data.filter((m) => m.kaynak === 'Döviz');
  assert.ok(moves.every((m) => m.cari === 'VELİ CANLI'));
  assert.equal((await c.call('POST', '/api/cari/kisi/sil', { isim: 'VELİ CANLI', onay: true })).status, 400);
  // Veresiye satışın iptali: cari borç da, kasa da geri döner (tahsilatlar ayrıca iptal edilir).
  for (const r of rows) assert.equal((await c.call('POST', `/api/doviz/${r.id}/iptal`, { gerekce: 'test' })).status, 200);
  assert.equal(await bakiye(c, 'Nakit Euro'), 5000);
  assert.equal(await bakiye(c, 'Nakit TL'), 0);
  cari = (await c.call('GET', '/api/cari')).body.data;
  assert.equal(cari.kisiler.some((k) => k.isim === 'VELİ CANLI'), false);
});

test('döviz alışında kalan: bize borç (eksi); tamamlanan işlem yalnız açıklama bilgisiyle düzeltilir', async () => {
  const c = await client();
  const a = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '35', kisi: 'Ayşe', kasa: [{ hesap_id: 5, tutar: '28000' }] });
  assert.equal(a.status, 201);
  assert.equal(a.body.data.kalan, 200);
  let ayse = (await c.call('GET', '/api/cari')).body.data.kisiler.find((k) => k.isim === 'AYŞE');
  assert.deepEqual(ayse.doviz_bakiye, { USD: -200 });
  // Tamamlanmış işlemin kuru / tutarı sessizce değiştirilemez; yalnız telefon, kimlik, not düzeltilir.
  assert.equal((await c.call('PUT', `/api/doviz/${a.body.data.id}`, { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '40', kisi: 'Ayşe' })).status, 422);
  const u = await c.call('PUT', `/api/doviz/${a.body.data.id}`, { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '35', kisi: 'Ayşe', telefon: '0532', notlar: 'havale ile' });
  assert.equal(u.status, 200);
  assert.deepEqual([u.body.data.telefon, u.body.data.notlar, u.body.data.kalan], ['0532', 'havale ile', 200]);
  assert.equal(await bakiye(c, 'Banka'), -28000);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 1000);
  // Yedek ve dışa aktarma döviz tablosunu içerir.
  const exp = (await c.call('GET', '/api/export')).body;
  assert.equal(exp.data.tables.doviz_islemleri.length, 1);
});

test('hareketli ağırlıklı ortalama: satış ortalamayı değiştirmez, sonraki alış eldeki miktarla ağırlıklanır', async () => {
  const c = await client();
  const post = (body) => c.call('POST', '/api/doviz', { tarih: TODAY, doviz: 'USD', ...body });
  await post({ islem: 'AL', miktar: '1000', kur: '34' });
  await post({ islem: 'AL', miktar: '1000', kur: '36' }); // ortalama 35
  const s1 = await post({ islem: 'SAT', miktar: '500', kur: '37' }); // kâr 500 x 2 = 1000
  await post({ islem: 'AL', miktar: '500', kur: '38' }); // (1500 x 35 + 500 x 38) / 2000 = 35,75
  const s2 = await post({ islem: 'SAT', miktar: '1000', kur: '39' }); // 39000 - 35750 = 3250
  const data = (await c.call('GET', '/api/doviz')).body.data;
  const kar = (id) => data.kayitlar.find((r) => r.id === id).kar_tl;
  assert.deepEqual([kar(s1.body.data.id), kar(s2.body.data.id)], [1000, 3250]);
  const usd = data.stok.find((x) => x.doviz === 'USD');
  assert.deepEqual([usd.nakit, usd.ortalama_maliyet, usd.maliyet_tl], [1000, 35.75, 35750]);
  // Kasadaki bozdurma ile giren dolar da aynı kasaya girer ve maliyete katılır: (1000 x 35,75 + 1000 x 36,25) / 2000 = 36.
  const fx = await c.call('POST', '/api/kasa/transfer', { tarih: TODAY, kaynak_id: 1, hedef_id: 2, tutar: '36250', hedef_tutar: '1000' });
  assert.equal(fx.status, 201);
  const usd2 = (await c.call('GET', '/api/doviz')).body.data.stok.find((x) => x.doviz === 'USD');
  assert.deepEqual([usd2.nakit, usd2.ortalama_maliyet], [2000, 36]);
});

test('çift kayıt engeli ve eşzamanlı satışta yetersiz bakiye', async () => {
  const c = await client();
  const key = 'form-1234';
  const first = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '35', islem_anahtari: key });
  const again = await c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'AL', doviz: 'USD', miktar: '1000', kur: '35', islem_anahtari: key });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.id, first.body.data.id);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 1000);
  assert.equal(await bakiye(c, 'Nakit TL'), -35000);
  // Kasada 1000 $ varken aynı anda iki 800 $ satış: biri kaydedilir, diğeri yetersiz bakiyeyle reddedilir.
  const [x, y] = await Promise.all([
    c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'SAT', doviz: 'USD', miktar: '800', kur: '36' }),
    c.call('POST', '/api/doviz', { tarih: TODAY, islem: 'SAT', doviz: 'USD', miktar: '800', kur: '36' }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 422]);
  assert.equal(await bakiye(c, 'Nakit Dolar'), 200);
  assert.equal((await c.call('GET', '/api/doviz')).body.data.kayitlar.length, 2);
});
