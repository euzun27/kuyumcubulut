// Gümüş / bakır alım-satımı ve atölye takibi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1, parseLiveSilver } from './.build/harness.mjs';

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

test('gümüş: saf gram fiyatıyla alış-satış, stok, kâr ve kasaya bağlı ödeme', async () => {
  const c = await client();
  // 925 ayar 100 gr hurda gümüş: 92,5 gr saf x 40 TL = 3700 TL, nakitle ödendi.
  const alis = await c.call('POST', '/api/metal', {
    tarih: TODAY, islem_turu: 'ALIS', metal: 'GUMUS', kisi: 'Ali', cinsi: 'Hurda gümüş', ayar: '925', gram: '100', birim_fiyat: '40', kasa: [{ hesap_id: 1, tutar: '3700' }],
  });
  assert.equal(alis.status, 201);
  assert.deepEqual([alis.body.data.milyem, alis.body.data.saf_gram, alis.body.data.tutar], [925, 92.5, 3700]);
  assert.equal(await bakiye(c, 'Nakit TL'), -3700);
  // Stoktan fazlası satılamaz.
  const fazla = await c.call('POST', '/api/metal', { islem_turu: 'SATIS', metal: 'GUMUS', kisi: 'Veli', ayar: '999', gram: '93', milyem: '999', birim_fiyat: '50' });
  assert.equal(fazla.status, 422);
  // 50 gr 925 takı satışı: 46,25 saf x 50 = 2312,5 + 200 işçilik; 1000 TL alındı, kalan veresiye.
  const satis = await c.call('POST', '/api/metal', {
    tarih: TODAY, islem_turu: 'SATIS', metal: 'GUMUS', kisi: 'Veli', cinsi: 'Takı', ayar: '925', gram: '50', birim_fiyat: '50', iscilik: '200', kasa: [{ hesap_id: 1, tutar: '1000' }],
  });
  assert.equal(satis.status, 201);
  assert.equal(satis.body.data.tutar, 2512.5);
  assert.equal(await bakiye(c, 'Nakit TL'), -2700);
  const data = (await c.call('GET', '/api/metal')).body.data;
  const gumus = data.stok.find((s) => s.metal === 'GUMUS');
  assert.deepEqual([gumus.alis_saf, gumus.satis_saf, gumus.kalan_saf, gumus.ortalama_maliyet], [92.5, 46.25, 46.25, 40]);
  const sat = data.kayitlar.find((r) => r.islem_turu === 'SATIS');
  assert.deepEqual([sat.odenen_tl, sat.kalan_tl, sat.kar_tl], [1000, 1512.5, 662.5]); // 2512,5 - 46,25 x 40
  assert.equal(data.ozet.tahsil_edilecek_tl, 1512.5);
  // Kasa hareketinde kaynak görünür.
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${TODAY}&bitis=${TODAY}`)).body.data;
  assert.ok(moves.every((m) => m.kaynak === 'Gümüş / Bakır'));
  // Satış varken alış silinemez; satış silinince kasası da gider.
  assert.equal((await c.call('DELETE', `/api/metal/${alis.body.data.id}`)).status, 400);
  assert.equal((await c.call('DELETE', `/api/metal/${satis.body.data.id}`)).status, 200);
  assert.equal(await bakiye(c, 'Nakit TL'), -3700);
  assert.equal((await c.call('DELETE', `/api/metal/${alis.body.data.id}`)).status, 200);
  assert.equal(await bakiye(c, 'Nakit TL'), 0);
});

test('bakır kilo fiyatıyla hesaplanır; altın stok ve carisi etkilenmez', async () => {
  const c = await client();
  const res = await c.call('POST', '/api/metal', { islem_turu: 'ALIS', metal: 'BAKIR', kisi: 'Hurdacı', cinsi: 'Bakır tel', gram: '2500', birim_fiyat: '380' });
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.data.milyem, res.body.data.saf_gram, res.body.data.tutar], [1000, 2500, 950]); // 2,5 kg x 380
  const stok = (await c.call('GET', '/api/metal')).body.data.stok.find((s) => s.metal === 'BAKIR');
  assert.deepEqual([stok.kalan_saf, stok.ortalama_maliyet, stok.fiyat_birimi], [2500, 380, 'KG']);
  const dash = (await c.call('GET', '/api/dashboard')).body.data;
  assert.equal(dash.toplam_normal_alis_has, 0);
  assert.equal((await c.call('GET', '/api/cari')).body.data.kisiler.length, 0);
  assert.equal((await c.call('POST', '/api/metal', { islem_turu: 'ALIS', metal: 'PLATIN', kisi: 'X', gram: '1' })).status, 422);
  assert.equal((await c.call('POST', '/api/metal', { islem_turu: 'ALIS', metal: 'GUMUS', kisi: 'X', gram: '1', milyem: '1200' })).status, 422);
});

test('metal fiyatları: elle girilen fiyat canlı gümüş fiyatından önce gelir', async () => {
  const c = await client();
  assert.deepEqual(parseLiveSilver({ GUMUS: { Buying: '48,10', Selling: '49,25' } }), { alis: 48.1, satis: 49.25 });
  assert.equal(parseLiveSilver({ USD: { Buying: '1' } }), null);
  assert.equal((await c.call('PUT', '/api/altin-fiyati/metal', { GUMUS: { alis: '0' } })).status, 422);
  await c.call('PUT', '/api/altin-fiyati/metal', { GUMUS: { alis: '45', satis: '52' }, BAKIR: { alis: '350' } });
  const data = (await c.call('GET', '/api/altin-fiyati?kaynak=manuel')).body.data;
  assert.deepEqual(data.metaller.GUMUS, { alis: 45, satis: 52, kaynak: 'manuel' });
  assert.deepEqual(data.metaller.BAKIR, { alis: 350, satis: 350, kaynak: 'manuel' });
});

test('atölye: aşamalar, dönüşte fire, sipariş durumu ve gecikme uyarısı', async () => {
  const c = await client();
  const sp = (await c.call('POST', '/api/siparis', { tarih: TODAY, musteri: 'Ayşe', urun: 'Tektaş yüzük', cinsi: 'YÜZÜK', ayar: '14' })).body.data;
  assert.equal((await c.call('POST', '/api/atolye', { atolye: '', is_tanimi: 'x' })).status, 422);
  assert.equal((await c.call('POST', '/api/atolye', { tarih: TODAY, atolye: 'Usta', is_tanimi: 'x', soz_tarihi: shift(-1) })).status, 422);
  // 14 ayar (585) 10 gr verildi: 5,85 has.
  const res = await c.call('POST', '/api/atolye', {
    tarih: shift(-5), atolye: 'Usta Atölye', tur: 'IMALAT', is_tanimi: 'Tektaş yüzük dökümü', siparis_id: sp.id, verilen_gram: '10', verilen_milyem: '585', soz_tarihi: shift(-1),
  });
  assert.equal(res.status, 201);
  const id = res.body.data.id;
  assert.equal(res.body.data.verilen_has, 5.85);
  let siparis = (await c.call('GET', '/api/siparis')).body.data.kayitlar[0];
  assert.deepEqual([siparis.durum, siparis.atolye], ['ATOLYEDE', 'USTA ATÖLYE']);
  assert.equal((await c.call('POST', `/api/atolye/${id}/asama`, { asama: 'UCUS' })).status, 422);
  await c.call('POST', `/api/atolye/${id}/asama`, { asama: 'DOKUM' });
  await c.call('POST', `/api/atolye/${id}/asama`, { asama: 'MIHLAMA', notlar: 'Taş müşteriden' });
  let data = (await c.call('GET', '/api/atolye')).body.data;
  let job = data.kayitlar[0];
  assert.deepEqual(job.asamalar.map((s) => s.asama), ['VERILDI', 'DOKUM', 'MIHLAMA']);
  assert.deepEqual([job.asama_adi, job.gecikme_gun, data.ozet.acik, data.ozet.geciken, data.ozet.atolyedeki_has], ['Mıhlama (taş)', 1, 1, 1, 5.85]);
  const u = (await c.call('GET', '/api/uyarilar')).body.data;
  assert.deepEqual(u.atolye.map((a) => [a.atolye, a.gecikme_gun]), [['USTA ATÖLYE', 1]]);
  // Dönüş: 9,7 gr 585 = 5,6745 -> 5,675 has; fire 0,175 has; sipariş hazır.
  const donus = await c.call('POST', `/api/atolye/${id}/donus`, { tarih: TODAY, gelen_gram: '9,7', iscilik_tl: '1500' });
  assert.equal(donus.status, 200);
  assert.deepEqual([donus.body.data.gelen_has, donus.body.data.fire_has], [5.675, 0.175]);
  assert.equal((await c.call('POST', `/api/atolye/${id}/asama`, { asama: 'CILA' })).status, 422);
  siparis = (await c.call('GET', '/api/siparis')).body.data.kayitlar[0];
  assert.equal(siparis.durum, 'HAZIR');
  data = (await c.call('GET', '/api/atolye')).body.data;
  job = data.kayitlar[0];
  assert.deepEqual([job.durum, job.fire_orani, job.iscilik_tl, data.ozet.acik, data.ozet.atolyedeki_has], ['DONDU', 2.99, 1500, 0, 0]);
  assert.deepEqual(data.atolyeler.map((a) => [a.atolye, a.biten_is, a.toplam_fire_has, a.iscilik_tl]), [['USTA ATÖLYE', 1, 0.175, 1500]]);
  // Geri alınınca yeniden atölyede, sipariş de atölyede.
  await c.call('POST', `/api/atolye/${id}/geri-al`, {});
  assert.equal((await c.call('GET', '/api/siparis')).body.data.kayitlar[0].durum, 'ATOLYEDE');
  // Sipariş silinince iş kalır, bağlantı kopar.
  await c.call('DELETE', `/api/siparis/${sp.id}`);
  assert.equal((await c.call('GET', '/api/atolye')).body.data.kayitlar[0].siparis_id, null);
  assert.equal((await c.call('DELETE', `/api/atolye/${id}`)).status, 200);
  assert.equal(c.env.DB.db.prepare('SELECT COUNT(*) AS n FROM atolye_asamalari').get().n, 0);
});

test('yedek ve sıfırlama yeni tabloları da kapsar', async () => {
  const c = await client();
  await c.call('POST', '/api/metal', { islem_turu: 'ALIS', metal: 'GUMUS', kisi: 'Ali', ayar: '999', gram: '10', birim_fiyat: '45' });
  await c.call('POST', '/api/atolye', { atolye: 'Usta', is_tanimi: 'Bilezik kaynak', tur: 'TAMIR' });
  const exp = (await c.call('GET', '/api/export')).body.data;
  assert.equal(exp.metal_islemleri.length, 1);
  assert.equal(exp.atolye_isleri.length, 1);
  assert.equal(exp.atolye_asamalari.length, 1);
  await c.call('POST', '/api/verileri-sifirla', { parola: 'gizli-parola' });
  assert.equal((await c.call('GET', '/api/metal')).body.data.kayitlar.length, 0);
  assert.equal((await c.call('GET', '/api/atolye')).body.data.kayitlar.length, 0);
  await c.call('POST', '/api/restore-latest', {});
  assert.equal((await c.call('GET', '/api/metal')).body.data.kayitlar.length, 1);
  assert.equal((await c.call('GET', '/api/atolye')).body.data.kayitlar[0].asamalar.length, 1);
});
