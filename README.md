# Dünyatek Kuyumcu Portalı

Dünyatek Bilişim kuyumcu takip portalı: alış, satış, hurda, stok (FIFO), cari,
gider ve milyem kârı takibi. [esmanurakbas/kuyumcu](https://github.com/esmanurakbas/kuyumcu)
(AKBAŞ Kuyumcu Takip) projesi temel alınmıştır.

| Katman | Teknoloji |
| --- | --- |
| Arayüz | Vanilla JavaScript SPA + CSS (`public/static`, `src/pages`) |
| Uygulama | TypeScript + Hono (`src/`) |
| Derleme | Vite |
| Çalışma ortamı | Cloudflare Pages + Workers |
| Veritabanı | Cloudflare D1 (SQLite) |
| Canlı alan adı | https://kuyumcu.dunyatek.com |

Altyapı DunyaOne (cari.dunyatek.com) ile aynıdır.

## Klasörler

```text
src/index.tsx        uygulama girişi, oturum kontrolü, sayfalar
src/api/kuyumcu.ts   alış, satış, hurda, stok, cari, gider, özet, yedek uçları
src/api/auth.ts      giriş, ilk kurulum, kullanıcılar, parola
src/lib/ledger.ts    hesap motoru (FIFO stok, milyem kârı, cari bakiye)
src/lib/decimal.ts   Python Decimal ile birebir aynı kesin ondalık sayı
migrations/          D1 şeması
public/static/       arayüz (app.js, styles.css, logo)
tests/               bulut sürümü testleri
legacy-python/       eski masaüstü sürümü (karşılaştırma için referans)
```

## Yerelde çalıştırma

```bash
npm install
npm run db:migrate:local
npm run build
npm run preview          # http://localhost:8788
```

İlk açılışta giriş ekranı yönetici hesabı oluşturmayı ister. Sonraki
kullanıcıları yönetici, üç nokta menüsündeki **Hesap ve kullanıcılar**
bölümünden ekler. Roller: yönetici, personel, izleyici (yalnızca okur).

## Kullanım kılavuzu

Müşteriler için resimli kılavuz `public/static/kilavuz/` altında: uygulamada
dişli menüdeki **KULLANIM KILAVUZU** açar, PDF'i aynı klasörde
(`Dunyatek_Kuyumcu_Portal_Kullanim_Kilavuzu.pdf`). Kurulumlu sürümde Başlat
menüsünde de kısayolu vardır.

## Bilgisayara kurulan sürüm (Windows)

`npm run kurulum` tek dosyalık kurulum programını üretir:
`desktop/cikti/Dunyatek_Kuyumcu_Portal_Kurulum_<sürüm>.exe` (NSIS 3 gerekir;
Linux'ta `apt install nsis`, Windows'ta nsis.sourceforge.io). Her PR'da GitHub
"Windows kurulumu" işi dosyayı derler, gerçek Windows'ta kurup dener ve
indirilebilir olarak ekler.

Kurulum ne yapar:
- Programı `C:\Dunyatek_Kuyumcu_Portal` klasörüne kurar, masaüstüne ve Başlat
  menüsüne logolu **Dunyatek_Kuyumcu_Portal** simgesi koyar.
- Simge, programın yerel sunucusunu (`DunyatekSunucu.exe`, gömülü Node.js)
  pencere göstermeden başlatır ve portalı Edge'de ayrı pencere olarak açar
  (`http://localhost:47800`, yalnızca bu bilgisayardan erişilir). İnternet gerekmez.
- Kayıtlar `C:\Dunyatek_Kuyumcu_Portal\Veri\kuyumcu.sqlite` dosyasındadır.
- Her yedek (günlük otomatik, elle, geri yükleme ve sıfırlama öncesi) ayrıca
  `C:\DUNYATEK_BACKUP` klasörüne `.json` olarak yazılır; Yedekler ekranında
  bu dosyalar listelenir ve geri yüklenir. 90 günden eski dosyalar silinir, en
  yeni 30 dosyaya dokunulmaz.
- **Lisans:** program ilk açılıştan itibaren 15 gün deneme çalışır. Lisans
  penceresi (dişli menü → LİSANS) bilgisayarın makine kodunu gösterir; Dünyatek
  bu koda özel anahtarı `desktop/lisans-uretici.html` ile üretir (Edge/Chrome'da
  açılır, özel anahtar dosyası `dunyatek-lisans-ozel-anahtar.json` gerekir;
  bu dosya depoda yoktur ve paylaşılmamalıdır). Anahtar Ed25519 ile imzalıdır,
  başka bilgisayarda çalışmaz. Deneme ya da lisans bitince program yalnızca
  görüntüleme modunda çalışır (giriş, yedek ve lisans girişi açık), veriler silinmez.
- **Unutulan parola:** personelin parolasını yönetici Kullanıcılar listesindeki
  "Parola" düğmesiyle yeniler. Yönetici parolası için giriş ekranındaki
  "Parolamı unuttum" makine kodunu ve tek kullanımlık bir istek kodunu
  (24 saat geçerli) gösterir. Dünyatek aynı `lisans-uretici.html` sayfasının
  "Parola sıfırlama kodu" bölümünde bu iki koddan imzalı bir `DP1-` kodu üretir;
  kod yalnızca o bilgisayarda ve o istek için bir kez çalışır. Kod girilince
  yazılan e-postanın parolası yenilenir, oturumları kapanır, işlem günlüğe yazılır.
- Yeni sürüm aynı kurulumla üzerine kurulur; kayıtlar ve yedekler korunur.
  Kaldırma da bu iki klasörü silmez.

## Cloudflare'de yayına alma (kuyumcu.dunyatek.com)

1. Cloudflare hesabına giriş: `npx wrangler login`
2. Veritabanını oluştur: `npx wrangler d1 create kuyumcu-production`
   Çıktıdaki `database_id` değerini `wrangler.jsonc` içine yaz.
3. Şemayı kur: `npm run db:migrate:remote`
4. Pages projesini oluştur ve yayınla:
   `npx wrangler pages project create kuyumcu --production-branch main`
   `npm run deploy`
5. Cloudflare panelinde **Workers & Pages → kuyumcu → Custom domains** altından
   `kuyumcu.dunyatek.com` ekle (dunyatek.com Cloudflare'de olduğu için DNS
   kaydı otomatik açılır).
6. https://kuyumcu.dunyatek.com adresini aç ve yönetici hesabını oluştur.

GitHub bağlantısıyla otomatik yayın istenirse Pages projesinde derleme komutu
`npm run build`, çıktı klasörü `dist` olarak ayarlanır.

## Eski masaüstü verisini aktarma

Masaüstü programdaki kayıtlar tek komutla D1'e taşınır (eski program en az bir
kez açılmış olmalı):

```bash
node scripts/sqlite-to-d1.mjs "C:\cloude_free\Dunya_altin\data\kuyumcu.db" aktarim.sql
npx wrangler d1 execute kuyumcu-production --remote --file aktarim.sql
```

Aktarım iş tablolarını değiştirir; kullanıcılar ve yedekler korunur.

## Yedekleme

- Her gün ilk istekte otomatik yedek alınır, son 14 gün saklanır.
- Ayarlarda "Her açılışta" seçilirse her girişte ayrıca yedek alınır.
- Menüdeki **YEDEK AL** elle yedek alır. **YEDEKLER VE GERİ YÜKLEME** tüm
  yedekleri listeler; geri yükleme yalnızca yönetici yapabilir ve önce mevcut
  durumu "Geri yükleme öncesi" olarak yedekler.
- **Bilgisayardaki yedek klasörü:** Yedekler ve geri yükleme ekranında
  "Klasör seç" ile Belgeler seçilir, içinde `DUNYATEK_BACKUP` klasörü açılır.
  Bundan sonra her yedek (elle ve günlük otomatik) oraya `.json` dosyası olarak
  da yazılır ve oradaki dosyalardan geri yüklenebilir. Chrome veya Edge gerekir;
  diğer tarayıcılarda dosya İndirilenler'e iner. Tarayıcı yeniden açılınca izin
  isterse üst çubukta "Yedek klasörü: izin ver" düğmesi çıkar.
- Cloudflare D1 ayrıca son 30 güne dakika hassasiyetinde geri dönüş sunar
  (`npx wrangler d1 time-travel restore kuyumcu-production --timestamp ...`).
- **TÜM VERİLERİ DIŞA AKTAR** okunabilir JSON indirir; dosya aynı zamanda tam yedektir ve başka bir bilgisayarda Yedekler penceresinden geri yüklenebilir.

## Altın fiyatı ve TL

Alış, satış ve hurda formlarında has fiyatı (TL/gr) ve işçilik (TL) girilir;
tutar = has × has fiyatı + işçilik. Satış kârı TL olarak (tutar − stoktan düşen
alış maliyeti) ve has olarak (gram × milyem farkı / 1000) ayrı gösterilir.

Üst çubuktaki **HAS** düğmesi günün has fiyatını gösterir. Fiyat önce canlı
kaynaktan okunur: masaüstü sürümde önce Harem Altın'ın canlı akışı
(`wss://hrmsocketonly.haremaltin.com`, socket.io `price_changed`; `src/lib/harem.ts`,
2 dakika veri gelmezse kullanılmaz), sonra yönetici has fiyatı penceresinde bir AltınAPI anahtarı
(altinapi.com, Harem Altın ile aynı piyasa kodları: `ALTIN`, `USDTRY`, `CEYREK_YENI`…)
girdiyse oradan, yoksa veya okunamazsa Truncgil Finans'tan. Anahtar `app_meta`
'fiyat_api_anahtari' altında durur, ekranda yalnızca son 4 hanesi görünür. Truncgil ve AltınAPI 30 saniye önbellekte tutulur (Harem akışı anlıktır); üst çubuk ve pano 5 saniyede
bir yeniler; düğmenin ipucunda kaynağın adı yazar. Okunamazsa düğmeden elle
girilen fiyat kullanılır. Fiyat yeni kayıtlarda forma öneri olarak gelir
(alışta alış, satışta satış fiyatı) ve her kayıtta değiştirilebilir.
USD ve EUR kurları aynı kaynaktan okunur, okunamazsa aynı pencereden elle girilir.

## Kasa, döviz ve gün sonu

**Kasa** ekranı (F4) nakit TL, dolar, euro, POS ve banka hesaplarının bakiyesini
gösterir. Hesaplar yönetici tarafından eklenir veya pasif yapılır (sonradan eklenen, hiç hareketi olmayan hesap silinebilir); POS hesabına
komisyon oranı girilirse kart tahsilatlarından düşülür.

- Satış, alış ve hurda formundaki **Nakit al / Kart (POS) / Havale** düğmeleri
  tutarın tamamını o hesaba yazar ve has borcunu kapatır. **Ödeme Ekle /
  Düzenle > Nakit / Kart / Havale** ile birden çok hesaba ve dövizle bölünmüş
  ödeme girilir; eksik ödemede ödenen TL has fiyatıyla has'a çevrilir.
- Cari ödemesinde **TL / Döviz ile** sekmesi tahsilatı kasaya yazar.
- Kayda bağlı kasa hareketi o kayıtla birlikte düzenlenir ve silinir.
- **Gelir / Gider**, **Transfer** ve **Döviz Al / Sat** elle girilen hareketlerdir.
- **Gün Sonu** her hesabın devir, giriş, çıkış ve beklenen bakiyesini gösterir;
  sayılan tutar girilir, fark kaydedilir ve rapor yazdırılır. Kapanıştan sonra o
  güne hareket girilirse uyarı çıkar.

Has esaslı cari, stok ve kâr hesapları kasadan etkilenmez.

## Emanet, sarrafiye ve fiş

- **Emanet** (F8): müşterinin bıraktığı veya bizim bıraktığımız altın ya da para;
  stoku ve cariyi etkilemez, teslim edilince kapatılır.
- **Sarrafiye**: alış ve emanet formundaki çeyrek, yarım, tam, ata, gremse,
  beşli ve gram altın düğmeleri cinsi, ayar ve milyemi doldurur; adet
  girilince gram hesaplanır. Stokta sarrafiyenin yaklaşık adedi görünür.
- **Fiş**: kayıt satırındaki yazıcı simgesi 80 mm fiş/makbuz basar. Firma adı,
  adres ve fiş notu menüdeki **Firma ve fiş bilgileri**nden girilir.
- Her tablo **CSV** düğmesiyle Excel'e aktarılır.
- Kısayollar: F2 satış, F3 alış, F4 kasa, F6 cari, F7 stok, F8 emanet,
  F9 dashboard, `/` arama, `?` yardım.

## Sipariş, tamir, atölye ve vade uyarıları

- **Sipariş / Tamir**: müşteri, ürün veya yapılacak iş, fiyat ve söz verilen
  teslim günü girilir. Kapora kasaya bağlı yazılır. Durum *Alındı → Atölyede →
  Hazır → Teslim* olarak ilerler; teslimde alınan para da kasaya işlenir.
  Müşteriye SP-numaralı fiş basılır. Silinen kaydın kasa hareketleri de silinir.
- **Cari kartı**: carinin menüsündeki **Cari kartı** ile tür (müşteri,
  toptancı, atölye), telefon, adres, vade günü ve has limiti girilir.
  Cari ekranındaki **Atölye / Toptancı** sekmesi bunları ayrı listeler.
  Kartı açılmış, henüz işlemi olmayan atölyeye has ödemesi (altın verme)
  yapılabilir; atölyedeki altın cari bakiyesinde görünür.
- **Cari ekleme ve düzeltme**: Cari ekranındaki **+ Yeni cari** ve her satırdaki
  kart simgesi; şahıs/şirket ayrımı, TC kimlik veya vergi no, vergi dairesi,
  yetkili kişi, telefon, e-posta ve adres. İsim düzeltilirse tüm kayıtlar yeni
  isme taşınır.
- **Mükerrer cari önleme**: isim yazarken tüm eşleşen cariler listelenir
  (başı uyanlar önce). Büyük/küçük harf ve boşluk farkı aynı cariye bağlanır;
  "Erdal Uzn" veya yalnızca "Erdal" gibi benzer bir isim yazılırsa kaydetmeden
  önce kayıtlı cariyi mi kullanmak, yeni mi açmak istediğiniz sorulur.
- **Uyarılar** (dashboard): teslim günü gelen veya geçen siparişler, bakiyesi
  açıkken son işleminden bu yana vade günü geçen cariler (genel vade 30 gün,
  yönetici **Vade ayarı**ndan değiştirir; kartta 0 = uyarı yok) ve has limitini
  aşan müşteriler.
- Bu sürüm `0003_cari_kart_siparis.sql` migration'ını getirir; yayına almadan
  önce `npm run db:migrate:remote` çalıştırın.

## Etiket, barkod, pırlanta ve raporlar

- **Etiket / Barkod** ekranında her parça için etiket oluşturulur: cinsi, ayar, model, gram, milyem, işçilik, etiket fiyatı ve taş bilgisi (pırlanta, renkli taş, zirkon, inci; adet, karat, renk, berraklık, kesim, sertifika no). Barkod otomatik verilir (`DT000123`, Code128).
- Etiketler üç biçimde yazdırılır: kelebek kuyumcu etiketi (72×12 mm), geniş etiket (50×25 mm) ve A4 sayfa (3×8). Seçilen biçim tarayıcıda hatırlanır.
- **Satış** formunun üstündeki barkod kutusuna okuyucuyla okutulunca ürün stoktan seçilir, gram ve taş bilgisi doldurulur. Satış kaydedilince etiket "Satıldı" olur; satış silinirse etiket stoğa döner. Aynı etiket ikinci kez satılamaz.
- **Raporlar** ekranı seçilen aralık için (bugün, dün, bu hafta, bu ay, geçen ay, son 30 gün, bu yıl veya özel tarih) ciro, brüt kâr, milyem kârı, satılan/alınan gram ve has, giderler, günlük grafik, ürün/müşteri/tedarikçi/personel kırılımı, kasa hareketleri, cari yaşlandırma (0-30/31-60/61-90/90+ gün) ve stok değerini gösterir. Her tablo CSV indirilebilir, sayfa yazdırılabilir.
- **Dashboard performans bölümü:** 7/30/90 gün, bu ay veya bu yıl için ciro, brüt kâr, satılan gram, alış ve gider; her biri önceki aynı uzunluktaki döneme göre yüzde değişim ve mini eğriyle. Günlük (90 günden uzunsa haftalık) satış/alış/kâr grafiği imleçle gezilir, seriler göstergeye tıklanarak gizlenir. TL ve has arasında geçiş yapılır; en çok satan ürünler, stok dağılımı ve en iyi müşteriler çubuk grafikle gösterilir.
- Yeni tablo `migrations/0004_etiket.sql` ile gelir: yayına almadan önce `npm run db:migrate:remote` çalıştırın.

## Gümüş / bakır, atölye takibi ve tarih biçimi

- **Gümüş / Bakır** ekranı altının has stoku ve carisinden ayrıdır. Gümüş saf gram üzerinden hesaplanır: saf gram = gram × milyem / 1000 (925 ayar takı, 999 külçe/granül, 900, 800), tutar = saf gram × saf gram fiyatı (TL/gr) + işçilik. Bakır kilo fiyatıyla (TL/kg) hesaplanır; hurda sınıfı (1. sınıf parlak tel, 2. sınıf) "Ayar / sınıf" alanına yazılır.
- Gram gümüş fiyatı canlı kaynaktan (AltınAPI `GUMTRY` veya Truncgil `GUMUS`) gelir; bakırın canlı TL fiyatı olmadığından kilo fiyatı "Fiyat gir" düğmesiyle elle girilir. Elle girilen fiyat canlıdan önce gelir. Fiyat yalnızca forma öneridir.
- Ödenen / alınan para kasaya bağlı yazılır ("Gümüş / Bakır" kaynağıyla); ödenmeyen kısım kayıtta "Kalan" olarak görünür. Stoktan fazlası satılamaz; satışın kârı o metalin ortalama alış maliyetiyle hesaplanır.
- Alış ve hurda ekranlarındaki sarrafiye düğmelerinin altına **GÜMÜŞ 925 / GÜMÜŞ 999 / BAKIR** kısayolları eklendi; bu ekrana ayarı doldurulmuş olarak geçer.
- **Atölye** ekranı atölyeye verilen işi izler: verilen gram, milyem ve has; işin aşaması (atölyeye verildi › model / mum › döküm › tesviye / montaj › kaynak / lehim › mıhlama › cila / polisaj › rodaj / kaplama › kontrol / damga › hazır; tamirde model ve döküm yoktur); atölyenin söz verdiği gün ve gecikme; dönüşte gelen gram/milyem, **fire** (verilen has − gelen has) ve işçilik (TL veya has). "Atölye özeti" sekmesi atölye bazında fire oranını ve işçiliği gösterir.
- Sipariş ekranında durum "Atölyede" seçilince iş Atölye ekranında siparişe bağlı açılır; iş atölyeden alınınca sipariş kendiliğinden "Hazır" olur. Söz günü geçen atölye işleri dashboard uyarılarına düşer. Has cari bakiyesi ve stok bu ekrandan etkilenmez; atölyeye verilen altın Cari ekranında has ödemesi olarak izlenmeye devam eder.
- Tüm tarih kutuları bilgisayarın dilinden bağımsız **gg.aa.yyyy** gösterir (`public/static/tarih.js`); yalnızca rakam yazılırsa noktalar kendiliğinden gelir, takvim düğmesi ve ok tuşları (±1 gün) çalışır. Sunucuya giden değer yine YYYY-AA-GG'dir.
- Yeni tablolar `migrations/0005_metal_atolye.sql` ile gelir: yayına almadan önce `npm run db:migrate:remote` çalıştırın. Masaüstü sürüm açılışta kendisi uygular.

## TV fiyat panosu ve işyeri logosu

- Üst çubuktaki **TV** düğmesi `/pano` sayfasını ayrı pencerede açar; pencere dükkândaki TV'ye veya ikinci ekrana taşınıp tam ekran yapılır. Pano 5 saniyede bir `/api/pano`'yu okur.
- Her satırın fiyatı: **piyasa** (canlı kaynaktaki ürün fiyatı, bulunamazsa has × çarpan), **has × çarpan** (has alış / satış × satırın alış / satış çarpanı) veya **elle**. Ayarlar dişli menüdeki "FİYAT PANOSU (TV) AYARLARI"ndan yapılır (`app_meta` 'pano').
- İşyeri logosu "FİRMA, LOGO VE FİŞ BİLGİLERİ" penceresinden yüklenir; tarayıcıda en fazla 600 px'e küçültülüp PNG olarak `app_meta` 'firma_logo' altında saklanır (`GET/PUT /api/firma/logo`).
- Tarih kutularının takvimi programın kendi Türkçe takvimidir ve kutunun altında açılır.

## Verileri sıfırlama (test sonrası)

Ayarlar penceresinde (yalnızca yönetici) **Verileri sıfırla** düğmesi vardır. Yönetici parolası ve onay için `SIFIRLA` yazılması istenir. Satış, alış, hurda, cari ödeme ve kartları, gider, kasa hareketleri, gün sonu, emanet, sipariş, etiketler, gümüş/bakır kayıtları ve atölye işleri silinir; kullanıcılar, ayarlar, firma bilgileri, kasa hesap tanımları, yedekler ve işlem günlüğü korunur. Silmeden önce otomatik yedek alınır, "Son yedeği geri yükle" ile geri alınabilir.

## Test

```bash
npm run typecheck
npm test                 # giriş, roller, yedek, dışa aktarma
npm run test:parity      # eski Python sürümüyle karşılaştırma
```

`test:parity`, eski sürümün testlerindeki ve rastgele üretilen senaryolardaki
her API isteğini hem Python hem bulut sürümüne gönderip cevapları alan alan
karşılaştırır (Python ve `legacy-python/requirements-dev.txt` gerekir;
`FUZZ_SEEDS=60 FUZZ_STEPS=150` ile daha uzun çalışır).

## İş kuralları

### Gram stok ve giderler

Stock checks use grams only. Existing purchase/sale forms are unchanged.
Autocomplete uses one custom listbox, with no native datalist; it supports search,
scrolling, pointer selection, keyboard navigation and closing with Escape or blur.

Expenses are usually entered as the TL actually paid (`tl_tutar`) with a has
price (`has_fiyati`, defaulting to the current has buying price). The server
converts them to has (`tutar = tl_tutar / has_fiyati`, three decimals), the same
unit as the milyem profit calculation (grams * purity difference / 1000). An
expense paid in gold can still be entered directly in has. When a TRY account is
chosen, the expense writes a linked kasa movement (source "Gider") that is
updated and deleted with it. Total milyem profit combines normal and scrap
sales; net profit is total milyem profit minus all recorded expenses.

Person names (customer, supplier, cari, workshop, deposit owner) are saved in
Turkish upper case (`personName`, i → İ) so statements show one spelling.
Existing names are upper-cased once at startup (`app_meta` 'isim_buyuk_harf').
Only the expense form shows three compact summary cards on the right
on desktop; only small screens stack the cards below the form. The expense
history stays below the form and summary. The dashboard uses four KPI cards and compact sales/profit, stock, and account
columns with the same existing data, without an added expense summary. Expenses support edit/delete and are
included in SQLite backups and JSON exports.


The Cari page renders one table for the active All/Customers/Suppliers/Payments
filter. Net has balance is highlighted with positive, negative, and zero states.
Each account provides a read-only detail dialog with existing sales, purchases,
transaction payments, and standalone account payments, including scrap activity.
The detail view reads existing APIs without recalculating or changing balances.


Remaining inventory has is based on the unsold grams at the original purchase
purity, independently of sale purity and profit. Fully sold quantities have zero
remaining grams, has, and inventory value. Stock screens omit zero-gram entries
without removing purchase/sale history. Notes accept up to 500 characters in the API and form controls. Existing longer
notes remain stored and viewable. Table notes are truncated visually and open in
a read-only dialog. Transaction note inputs start at one line and resize up to
three; expense notes start at two and resize up to five.

Transaction forms calculate has automatically unless `has_override` is provided.
The override is stored in the existing has column without a schema migration;
list responses include its full value for lossless editing. Clearing the override
returns to automatic calculation. Gram-based stock checks and the existing
milyem profit formula remain unchanged. The recorded has continues to drive the
existing cari and transaction payment calculations. The UI truncates displayed
numbers to at most two decimal places without changing stored values or input
precision. Cari history actions open the underlying transaction or payment form.

### Tema

Sidebar logosu acik/koyu tema dugmesidir. Tema yalnizca renkleri degistirir;
doldurulmus formu, secilen urunu ve finansal hesaplamalari degistirmez.

### Toplam stoktan satis ve mevcut veriler

Normal ve hurda satis ayni cins/ayarin toplam gram stokundan secilir.
Yeni satislar FIFO ile birden fazla alisa dagitilabilir; tek satis kaydi,
dogru gram cikisi ve agirlikli milyem kari korunur. Dagilim miktari ve maliyet
bilgisi SQLite icinde satisla birlikte tek transaction'da saklanir.

Schema 5, mevcut tablolara stoktan satis isareti ve ayri dagilim tablosu ekler.
Schema 4 kayitlari yeniden yazilmaz veya otomatik olarak FIFO'ya cevrilmez.
Guncelleme oncesi veritabani yedeklenir. Kurulum ve guvenli guncelleme icin
legacy-python/GUNCELLEME.txt dosyasini izleyin.


### Minimal application preferences and manual has entry

The three-dot menu opens Settings. Theme uses the existing local theme preference.
Backup frequency is stored in the `app_meta` table:
`daily` preserves the existing first-launch-per-day backup; `startup` adds a
verified backup at every startup. Neither option disables the existing daily
backup or changes retention. Settings show the latest valid backup timestamp and
build version when packaged. The frequency applies at the next application
startup; this is not an unattended timer while the application is running.

Typing manual has derives transaction purity as has / grams * 1000, leaving grams
and source purchase purity unchanged. Zero grams blocks manual has submission.
Editing transaction purity returns to automatic has calculation. The Automatic
button restores the purity from before the current manual entry. Existing rows
are not recalculated when opening or changing settings; old manual entries are
only synchronized when the user changes the has or gram input. Profit continues
to use the existing purity-difference formula, with the entered transaction purity.
