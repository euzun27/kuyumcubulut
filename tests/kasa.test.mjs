// Kasa, döviz, gün sonu, emanet ve firma bilgileri (bulut sürümünün ek modülleri).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1, parseLiveRates } from './.build/harness.mjs';

// Bu testler kasayı bilerek eksiye düşürür; TL eksi bakiye onayı kasa.test.mjs'de ayrıca denenir.
const onay = (b) => (b && typeof b === 'object' && !Array.isArray(b) && !('eksi_onay' in b) ? { ...b, eksi_onay: true } : b);

async function client(role = 'admin') {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul' };
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(onay(body)),
      }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/register', { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' });
  if (role !== 'admin') {
    await call('POST', '/api/auth/users', { name: 'P', email: 'p@d.com', password: 'gizli-parola', role });
    await call('POST', '/api/auth/login', { email: 'p@d.com', password: 'gizli-parola' });
  }
  return { env, call };
}

const DAY = '2026-03-10';
const hesap = (data, ad) => data.hesaplar.find((h) => h.ad === ad);

test('varsayılan kasa hesapları ve elle gelir/gider', async () => {
  const c = await client();
  const kasa = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.deepEqual(kasa.hesaplar.map((h) => [h.ad, h.para_birimi]), [['Nakit TL', 'TRY'], ['Nakit Dolar', 'USD'], ['Nakit Euro', 'EUR'], ['POS', 'TRY'], ['Banka', 'TRY']]);
  assert.equal((await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'DEVIR', yon: 'GIRIS', tutar: '10000' })).status, 201);
  assert.equal((await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'GIDER', tutar: '1250,50', aciklama: 'Kira' })).status, 201);
  assert.equal((await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'GIDER', tutar: '-5' })).status, 422);
  assert.equal((await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'SATIS', tutar: '5' })).status, 422);
  const after = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.equal(hesap(after, 'Nakit TL').bakiye, 8749.5);
  assert.equal(after.toplamlar.TRY.giris, 10000);
  assert.equal(after.toplamlar.TRY.cikis, 1250.5);
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${DAY}&bitis=${DAY}`)).body.data;
  assert.equal(moves.length, 2);
  assert.equal(moves[0].net, -1250.5);
  assert.equal(moves[0].duzenlenebilir, true);
  assert.equal((await c.call('DELETE', `/api/kasa/hareket/${moves[0].id}`)).status, 200);
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data, 'Nakit TL').bakiye, 10000);
});

test('satışla alınan nakit ve POS kasaya bağlı yazılır, satış silinince kalkar', async () => {
  const c = await client();
  await c.call('PUT', '/api/kasa/hesaplar/4', { komisyon_orani: '2,5' });
  await c.call('POST', '/api/alis', { tarih: DAY, tedarikci: 'Toptancı', cinsi: 'BILEZIK', ayar: '22', gram: '20', milyem: '916', has_fiyati: '3000', kasa: [{ hesap_id: 5, tutar: '54960' }] });
  const sale = await c.call('POST', '/api/satis', {
    tarih: DAY, musteri: 'Ayşe', cinsi: 'BILEZIK', ayar: '22', gram: '10', satis_milyem: '950', stoktan: true, has_fiyati: '3100',
    odeme_tipi: 'TAM_KAPAT', kasa: [{ hesap_id: 1, tutar: '20000' }, { hesap_id: 4, tutar: '9450' }],
  });
  assert.equal(sale.body.status, 'ok');
  const id = sale.body.data.id;
  let kasa = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.equal(hesap(kasa, 'Nakit TL').bakiye, 20000);
  assert.equal(hesap(kasa, 'POS').bakiye, 9213.75); // %2,5 komisyon: 236,25
  assert.equal(hesap(kasa, 'POS').komisyon, 236.25);
  assert.equal(hesap(kasa, 'Banka').bakiye, -54960);
  const list = (await c.call('GET', '/api/satis')).body.data;
  assert.deepEqual(list[0].kasa_odemeleri.map((k) => [k.hesap, k.tutar]), [['Nakit TL', 20000], ['POS', 9450]]);
  // Has cari: tam kapatıldı.
  assert.equal((await c.call('GET', '/api/cari')).body.data.kisiler.find((k) => k.isim === 'AYŞE').kalan_has, 0); // adlar büyük harfle saklanır
  // Bağlı hareket kasadan silinemez.
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${DAY}&bitis=${DAY}`)).body.data;
  const linked = moves.find((m) => m.bagli_tur === 'satis');
  assert.equal(linked.kaynak, 'Satış');
  assert.equal((await c.call('DELETE', `/api/kasa/hareket/${linked.id}`)).status, 400);
  // Düzenlemede kasa alanı yoksa hareketler korunur ve tarih taşınır.
  const edit = { tarih: '2026-03-11', musteri: 'Ayşe', cinsi: 'BILEZIK', ayar: '22', gram: '10', satis_milyem: '950', stoktan: true, has_fiyati: '3100', odeme_tipi: 'TAM_KAPAT' };
  assert.equal((await c.call('PUT', `/api/satis/${id}`, edit)).body.status, 'ok');
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=2026-03-11`)).body.data, 'Nakit TL').giris, 20000);
  // Kasa alanı gelirse yeniden yazılır.
  await c.call('PUT', `/api/satis/${id}`, { ...edit, kasa: [{ hesap_id: 1, tutar: '29450' }] });
  kasa = (await c.call('GET', `/api/kasa?tarih=2026-03-11`)).body.data;
  assert.equal(hesap(kasa, 'Nakit TL').bakiye, 29450);
  assert.equal(hesap(kasa, 'POS').bakiye, 0);
  await c.call('DELETE', `/api/satis/${id}`);
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=2026-03-11`)).body.data, 'Nakit TL').bakiye, 0);
  // Pasif hesap kullanılamaz.
  await c.call('PUT', '/api/kasa/hesaplar/2', { aktif: false });
  const bad = await c.call('POST', '/api/satis', { ...edit, kasa: [{ hesap_id: 2, tutar: '100', kur: '38' }] });
  assert.equal(bad.status, 422);
});

test('cari tahsilatı TL ile kasaya girer; cari silinince kasa hareketi de silinir', async () => {
  const c = await client();
  await c.call('POST', '/api/alis', { tarih: DAY, tedarikci: 'T', cinsi: 'BILEZIK', ayar: '22', gram: '20', milyem: '916' });
  await c.call('POST', '/api/satis', { tarih: DAY, musteri: 'Veli', cinsi: 'BILEZIK', ayar: '22', gram: '10', satis_milyem: '950', stoktan: true });
  const pay = await c.call('POST', '/api/cari/odeme', { tarih: DAY, isim: 'Veli', yon: 'OTOMATIK', odeme_tipi: 'HAS', odenen_has: '3', kasa: [{ hesap_id: 1, tutar: '9300' }] });
  assert.equal(pay.body.status, 'ok');
  assert.equal(pay.body.data.yon, 'TAHSILAT');
  const cari = (await c.call('GET', '/api/cari')).body.data;
  assert.equal(cari.odemeler[0].kasa_odemeleri[0].tutar, 9300);
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data, 'Nakit TL').bakiye, 9300);
  await c.call('PUT', '/api/cari/kisi', { eski_isim: 'Veli', yeni_isim: 'Veli Can' });
  assert.equal((await c.call('GET', `/api/kasa/hareketler?baslangic=${DAY}&bitis=${DAY}`)).body.data[0].cari, 'VELİ CAN');
  await c.call('POST', '/api/cari/kisi/sil', { isim: 'Veli Can' });
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data, 'Nakit TL').bakiye, 0);
});

test('transfer ve döviz bozdurma, gün sonu sayımı', async () => {
  const c = await client();
  await c.call('POST', '/api/kasa/hareket', { tarih: '2026-03-09', hesap_id: 1, kategori: 'DEVIR', yon: 'GIRIS', tutar: '50000' });
  assert.equal((await c.call('POST', '/api/kasa/transfer', { tarih: DAY, kaynak_id: 1, hedef_id: 1, tutar: '5' })).status, 422);
  assert.equal((await c.call('POST', '/api/kasa/transfer', { tarih: DAY, kaynak_id: 1, hedef_id: 2, tutar: '3850' })).status, 422); // karşılık yok
  const fx = await c.call('POST', '/api/kasa/transfer', { tarih: DAY, kaynak_id: 1, hedef_id: 2, tutar: '3850', hedef_tutar: '100', cari: 'Müşteri' });
  assert.equal(fx.status, 201);
  assert.equal(fx.body.data.kur, 38.5);
  await c.call('POST', '/api/kasa/transfer', { tarih: DAY, kaynak_id: 1, hedef_id: 5, tutar: '10000' });
  let kasa = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.deepEqual([hesap(kasa, 'Nakit TL').bakiye, hesap(kasa, 'Nakit Dolar').bakiye, hesap(kasa, 'Banka').bakiye], [36150, 100, 10000]);
  const moves = (await c.call('GET', `/api/kasa/hareketler?baslangic=${DAY}&bitis=${DAY}`)).body.data;
  assert.equal(moves.filter((m) => m.kategori === 'DOVIZ').length, 2);
  // Transferin bir bacağı silinince iki bacak da silinir.
  const tr = moves.find((m) => m.kategori === 'TRANSFER');
  assert.equal((await c.call('DELETE', `/api/kasa/hareket/${tr.id}`)).status, 200);
  kasa = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.equal(hesap(kasa, 'Banka').bakiye, 0);

  let end = (await c.call('GET', `/api/kasa/gun-sonu?tarih=${DAY}`)).body.data;
  assert.equal(end.kapali, false);
  const tl = end.hesaplar.find((h) => h.ad === 'Nakit TL');
  assert.deepEqual([tl.devir, tl.giris, tl.cikis, tl.beklenen], [50000, 0, 3850, 46150]);
  end = (await c.call('POST', '/api/kasa/gun-sonu', { tarih: DAY, sayimlar: [{ hesap_id: 1, sayilan: '46100' }, { hesap_id: 2, sayilan: '100' }], notlar: 'Akşam sayımı' })).body.data;
  assert.equal(end.kapali, true);
  assert.equal(end.hesaplar.find((h) => h.ad === 'Nakit TL').fark, -50);
  assert.equal(end.hesaplar.find((h) => h.ad === 'Nakit Dolar').fark, 0);
  // Kapanıştan sonra o güne hareket girilirse uyarı.
  await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'GELIR', tutar: '50' });
  end = (await c.call('GET', `/api/kasa/gun-sonu?tarih=${DAY}`)).body.data;
  assert.equal(end.hesaplar.find((h) => h.ad === 'Nakit TL').degisti, true);
  assert.equal((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data.gun_sonu_kapali, true);
});

test('hesap yönetimi yöneticiye açık; personel hareket girebilir, izleyici giremez', async () => {
  const staff = await client('staff');
  assert.equal((await staff.call('POST', '/api/kasa/hesaplar', { ad: 'Kasa 2', tur: 'NAKIT', para_birimi: 'TRY' })).status, 403);
  assert.equal((await staff.call('POST', '/api/kasa/hareket', { hesap_id: 1, kategori: 'GELIR', tutar: '10' })).status, 201);
  const viewer = await client('viewer');
  assert.equal((await viewer.call('POST', '/api/kasa/hareket', { hesap_id: 1, kategori: 'GELIR', tutar: '10' })).status, 403);
  assert.equal((await viewer.call('GET', '/api/kasa')).status, 200);
  const admin = await client();
  const created = await admin.call('POST', '/api/kasa/hesaplar', { ad: 'Ziraat POS', tur: 'POS', para_birimi: 'TRY', komisyon_orani: '1,8' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.komisyon_orani, 1.8);
  assert.equal((await admin.call('POST', '/api/kasa/hesaplar', { ad: 'ziraat pos', tur: 'POS', para_birimi: 'TRY' })).status, 422);
  assert.equal((await admin.call('POST', '/api/kasa/hesaplar', { ad: 'X', tur: 'KASA', para_birimi: 'TRY' })).status, 422);
});

test('emanet: altın ve para emaneti, teslim ve özet', async () => {
  const c = await client();
  const gold = await c.call('POST', '/api/emanet', { tarih: DAY, kisi: 'Zeynep', telefon: '0555', tur: 'ALTIN', cinsi: 'ÇEYREK', ayar: '22', adet: '3', gram: '5,25', milyem: '916' });
  assert.equal(gold.status, 201);
  assert.equal(gold.body.data.has, 4.809);
  await c.call('POST', '/api/emanet', { tarih: DAY, kisi: 'Ali', tur: 'PARA', tutar: '15000', para_birimi: 'TRY' });
  assert.equal((await c.call('POST', '/api/emanet', { kisi: 'X', tur: 'ALTIN', cinsi: 'YÜZÜK' })).status, 422);
  assert.equal((await c.call('POST', '/api/emanet', { kisi: '', tur: 'PARA', tutar: '5' })).status, 422);
  let data = (await c.call('GET', '/api/emanet')).body.data;
  assert.deepEqual([data.ozet.acik_sayisi, data.ozet.alinan_has, data.ozet.alinan_para.TRY], [2, 4.809, 15000]);
  assert.equal((await c.call('POST', `/api/emanet/${gold.body.data.id}/iade`, { tarih: '2026-03-12' })).body.data.durum, 'IADE');
  data = (await c.call('GET', '/api/emanet')).body.data;
  assert.equal(data.ozet.acik_sayisi, 1);
  assert.equal(data.kayitlar.at(-1).iade_tarihi, '2026-03-12'); // teslim edilenler sonda
  await c.call('POST', `/api/emanet/${gold.body.data.id}/iade`, { iade: false });
  assert.equal((await c.call('GET', '/api/emanet')).body.data.ozet.acik_sayisi, 2);
  assert.equal((await c.call('DELETE', `/api/emanet/${gold.body.data.id}`)).status, 200);
});

test('sarrafiye adedi saklanır', async () => {
  const c = await client();
  const res = await c.call('POST', '/api/alis', { tarih: DAY, tedarikci: 'T', cinsi: 'ÇEYREK', ayar: '22', adet: '4', gram: '7', milyem: '916' });
  assert.equal(res.body.data.adet, 4);
});

test('yedek kasa tablolarını da içerir; eski yedek kasa kayıtlarını silmez', async () => {
  const c = await client();
  await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'GELIR', tutar: '100' });
  await c.call('POST', '/api/emanet', { tarih: DAY, kisi: 'Ali', tur: 'PARA', tutar: '50' });
  await c.call('POST', '/api/backup');
  await c.call('POST', '/api/kasa/hareket', { tarih: DAY, hesap_id: 1, kategori: 'GELIR', tutar: '900' });
  assert.equal((await c.call('POST', '/api/restore-latest')).body.status, 'ok');
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data, 'Nakit TL').bakiye, 100);
  assert.equal((await c.call('GET', '/api/emanet')).body.data.kayitlar.length, 1);
  const exp = (await c.call('GET', '/api/export')).body.data;
  assert.equal(exp.kasa_hareketleri.length, 1);
  assert.equal(exp.kasa_hesaplari.length, 5);

  // Kasa tabloları olmayan (eski sürüm) yedek: kasa kayıtlarına dokunulmaz.
  const old = JSON.stringify({ version: 1, tables: { alis: [], satis: [], hurda: [], cari_odeme: [], giderler: [], sale_allocations: [] } });
  c.env.DB.db.exec(`DELETE FROM yedek_parcalari; DELETE FROM yedekler;`);
  c.env.DB.db.prepare(`INSERT INTO yedekler (id, reason, name, size, parts, created_at) VALUES (1, 'manual', 'eski', ?, 1, '2030-01-01T00:00:00Z')`).run(old.length);
  c.env.DB.db.prepare(`INSERT INTO yedek_parcalari (yedek_id, part, payload) VALUES (1, 0, ?)`).run(old);
  assert.equal((await c.call('POST', '/api/restore-latest')).body.status, 'ok');
  assert.equal(hesap((await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data, 'Nakit TL').bakiye, 100);
});

test('firma bilgileri ve döviz kurları', async () => {
  const c = await client();
  assert.equal((await c.call('GET', '/api/firma')).body.data.ad, 'Dünyatek Kuyumcu');
  const saved = await c.call('PUT', '/api/firma', { ad: 'Altın Sarayı', adres: 'Kapalıçarşı No:1', telefon: '0212', vergi: 'Fatih VD 123', fis_notu: 'Teşekkürler' });
  assert.equal(saved.body.data.ad, 'Altın Sarayı');
  const price = await c.call('PUT', '/api/altin-fiyati', { alis: '3000', satis: '3050', kurlar: { USD: { alis: '38,40', satis: '38,60' }, EUR: { alis: '' } } });
  assert.equal(price.status, 200);
  const data = (await c.call('GET', '/api/altin-fiyati?kaynak=manuel')).body.data;
  assert.deepEqual(data.kurlar.USD, { alis: 38.4, satis: 38.6, kaynak: 'manuel' });
  assert.equal(data.kurlar.EUR, undefined);
  assert.deepEqual(parseLiveRates({ USD: { Buying: '38,4', Selling: 38.6 }, EUR: { 'Alış': '41,10', 'Satış': '41,30' }, GBP: {} }), { USD: { alis: 38.4, satis: 38.6 }, EUR: { alis: 41.1, satis: 41.3 } });
});

test('dashboard son 7 günün TL özetini verir', async () => {
  const c = await client();
  const dash = (await c.call('GET', '/api/dashboard')).body.data;
  assert.equal(dash.son_7_gun.length, 7);
  assert.ok(dash.son_7_gun.every((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.tarih)));
});

test('hareketi olmayan hesap silinir, hareketi olan silinmez', async () => {
  const c = await client();
  const yeni = (await c.call('POST', '/api/kasa/hesaplar', { ad: 'Garanti POS', tur: 'POS', para_birimi: 'TRY', komisyon_orani: '3' })).body.data;
  assert.equal(yeni.hareket_sayisi, 0);
  const del = await c.call('DELETE', `/api/kasa/hesaplar/${yeni.id}`);
  assert.equal(del.status, 200, del.body.message);
  assert.equal((await c.call('GET', '/api/kasa/hesaplar')).body.data.some((h) => h.ad === 'Garanti POS'), false);
  const varsayilan = await c.call('DELETE', '/api/kasa/hesaplar/2');
  assert.equal(varsayilan.status, 422);
  assert.match(varsayilan.body.message, /varsayılan/);
  const ikinci = (await c.call('POST', '/api/kasa/hesaplar', { ad: 'Kasa 2', tur: 'NAKIT', para_birimi: 'TRY' })).body.data;
  await c.call('POST', '/api/kasa/hareket', { hesap_id: ikinci.id, kategori: 'GELIR', tutar: '10' });
  const used = await c.call('DELETE', `/api/kasa/hesaplar/${ikinci.id}`);
  assert.equal(used.status, 422);
  assert.match(used.body.message, /hareket var/);
  const staff = await client('staff');
  assert.equal((await staff.call('DELETE', '/api/kasa/hesaplar/2')).status, 403);
});

test('yönetici personelin parolasını yeniler; personel yapamaz', async () => {
  const c = await client();
  const p = (await c.call('POST', '/api/auth/users', { name: 'P', email: 'p@d.com', password: 'gizli-parola', role: 'staff' })).body.data;
  assert.equal((await c.call('POST', `/api/auth/users/${p.id}/parola`, { new_password: 'kisa' })).status, 422);
  const r = await c.call('POST', `/api/auth/users/${p.id}/parola`, { new_password: 'yeni-parola-1' });
  assert.equal(r.status, 200, r.body.message);
  const login = await c.call('POST', '/api/auth/login', { email: 'p@d.com', password: 'yeni-parola-1' });
  assert.equal(login.status, 200);
  assert.equal((await c.call('POST', `/api/auth/users/1/parola`, { new_password: 'baska-parola' })).status, 403);
});

test('TL hesabı eksiye düşecekse kayıt onay ister; onaylanınca yazılır, düzenlemede eski ödeme sayılmaz', async () => {
  const c = await client();
  const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
  await c.call('POST', '/api/kasa/hareket', { tarih: DAY, kategori: 'DEVIR', yon: 'GIRIS', hesap_id: 5, tutar: '50000', eksi_onay: false });
  const alis = { tarih: DAY, tedarikci: 'Toptancı', cinsi: 'BILEZIK', ayar: '22', gram: '20', milyem: '916', has_fiyati: '3000', kasa: [{ hesap_id: 5, tutar: '54960' }], eksi_onay: false };
  const sor = await c.call('POST', '/api/alis', alis);
  assert.equal(sor.status, 409);
  assert.equal(sor.body.kod, 'EKSI_BAKIYE');
  assert.match(sor.body.message, /Banka eksiye düşecek: bakiye 50\.000,00 TL, bu işlemden sonra -4\.960,00 TL/);
  assert.equal((await c.call('GET', '/api/alis')).body.data.length, 0);
  // Transfer ve elle gider de aynı soruyu sorar; döviz kasası (dolar) bu kontrole girmez.
  assert.equal((await c.call('POST', '/api/kasa/transfer', { tarih: DAY, kaynak_id: 1, hedef_id: 5, tutar: '10', eksi_onay: false })).body.kod, 'EKSI_BAKIYE');
  assert.equal((await c.call('POST', '/api/kasa/hareket', { tarih: DAY, kategori: 'GIDER', hesap_id: 1, tutar: '10', eksi_onay: false })).body.kod, 'EKSI_BAKIYE');
  const ok = await c.call('POST', '/api/alis', { ...alis, eksi_onay: true });
  assert.equal(ok.body.status, 'ok');
  const kasa = (await c.call('GET', `/api/kasa?tarih=${DAY}`)).body.data;
  assert.equal(kasa.hesaplar.find((h) => h.ad === 'Banka').bakiye, -4960);
  // Yeterli bakiye varken soru gelmez; düzenlemede kaydın kendi ödemesi bakiyeye geri eklenerek bakılır.
  await c.call('POST', '/api/kasa/hareket', { tarih: DAY, kategori: 'DEVIR', yon: 'GIRIS', hesap_id: 5, tutar: '10000', eksi_onay: false });
  const id = ok.body.data.id;
  assert.equal((await c.call('PUT', `/api/alis/${id}`, { ...alis, notlar: 'düzeltme' })).body.status, 'ok');
});
