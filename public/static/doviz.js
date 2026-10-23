/*
 * Döviz alış / satış. Kasa tek kaynaktır: alınan / verilen döviz Nakit Dolar /
 * Nakit Euro hesabına, karşılığı TL nakit, POS veya bankaya yazılır. Ödenmeyen
 * kısım cariye döviz olarak geçer (kur değişse de aynı miktar). Kâr yalnızca
 * döviz satışında, ortalama maliyete göre ayrıca gösterilir.
 * modules.js (kasa satırları, fiş) ve app.js (canlı fiyat) yardımcılarını kullanır.
 */

Object.assign(views, { doviz: { title: "Döviz Al / Sat", subtitle: "Döviz alış-satış, kasa, cari ve kâr" } });
Object.assign(KASA_CATEGORY_LABEL, { DOVIZ_ALIS: "Döviz alış", DOVIZ_SATIS: "Döviz satış", DOVIZ_TAHSILAT: "Döviz tahsilat", DOVIZ_ODEME: "Döviz ödeme", DOVIZ_IPTAL: "Döviz iptal (ters kayıt)" });
Object.assign(labels, { doviz_text: "Döviz bakiye" });
["kisiCari", "musteriCari", "tedarikciCari"].forEach((type) => { const cols = columns[type]; if (!cols.includes("doviz_text")) cols.splice(2, 0, "doviz_text"); });

const DOVIZ_ISLEM = { AL: "Alış", SAT: "Satış", TAHSILAT: "Tahsilat", ODEME: "Ödeme" };
const DOVIZ_ISLEM_TAB = [["AL", "Döviz alıyoruz"], ["SAT", "Döviz satıyoruz"], ["TAHSILAT", "Döviz borcu tahsilatı"], ["ODEME", "Döviz borcumuzu öde"]];
state.dovizFilter = "ALL";
state.dovizPreset = null;
state.dovizCari = [];

const dovizCurrencies = () => ["USD", "EUR", "GBP"].filter((cur) => state.kasaHesaplar.some((a) => a.aktif && a.para_birimi === cur));
const fmtDoviz = (value, cur) => fmtMoney(value, cur);
/** Cari döviz bakiyesi metni: "+500 € · −200 $" (+ bize borçlu). */
function dovizBalanceText(bakiye) {
  return Object.entries(bakiye || {}).map(([cur, v]) => `${v > 0 ? "+" : "−"}${fmtMoney(Math.abs(v), cur)}`).join(" · ");
}
const dovizBalanceOf = (isim) => state.dovizCari.find((p) => normalize(p.isim) === normalize(isim))?.bakiye || {};

/* Cari listesinde döviz bakiyesi sütunu. */
const decorateCariBase = decorateCari;
decorateCari = function (data) {
  decorateCariBase(data);
  state.dovizCari = data.doviz || [];
  const text = (row) => ({ ...row, doviz_text: dovizBalanceText(row.doviz_bakiye || dovizBalanceOf(row.isim)) });
  ["kisiler", "musteriler", "tedarikciler", "atolyeler"].forEach((key) => { data[key] = (data[key] || []).map(text); });
  return data;
};

/* Cari işlemleri menüsüne döviz tahsilat / ödeme. */
const openCariActionsBase = openCariActions;
openCariActions = function (row, data) {
  openCariActionsBase(row, data);
  const list = document.querySelector(".cari-actions-modal .cari-action-list");
  if (!list || currentUser?.role === "viewer") return;
  const bakiye = row.doviz_bakiye || dovizBalanceOf(row.isim);
  const [cur, value] = Object.entries(bakiye)[0] || ["USD", 0];
  const btn = h("button", { type: "button", class: "cari-action-btn", text: `Döviz tahsilat / ödeme${value ? ` (${dovizBalanceText(bakiye)})` : ""}`, onclick: () => {
    btn.closest(".modal")?.remove();
    state.dovizPreset = { islem: value < 0 ? "ODEME" : "TAHSILAT", kisi: row.isim, doviz: cur };
    goView("doviz");
  } });
  list.insertBefore(btn, list.children[2] || null);
};

/* Cari detayında döviz hareketleri. */
const openCariDetailBase = openCariDetail;
openCariDetail = async function (name) {
  await openCariDetailBase(name);
  const body = document.querySelector(".cari-detail-modal .cari-detail-body");
  if (!body) return;
  let data;
  try { data = await api("/api/doviz"); } catch { return; }
  const rows = data.kayitlar.filter((r) => normalize(r.kisi) === normalize(name));
  if (!rows.length || !body.isConnected) return;
  const bakiye = (data.cari.find((p) => normalize(p.isim) === normalize(name)) || {}).bakiye || {};
  const table = h("table", { class: "doviz-cari-table" }, h("thead", {}, h("tr", {}, ...["Tarih", "İşlem", "Miktar", "Kur", "TL", "Cariye kalan"].map((t) => h("th", { text: t })))),
    h("tbody", {}, ...rows.map((r) => h("tr", {},
      h("td", { text: trDate(r.tarih) }), h("td", { text: DOVIZ_ISLEM[r.islem] }), h("td", { class: "num", text: fmtDoviz(r.miktar, r.doviz) }),
      h("td", { class: "num", text: formatTurkishNumber(r.kur, 2, 4) }), h("td", { class: "num", text: fmtMoney(r.tutar_tl) }),
      h("td", { class: "num", text: r.kalan ? fmtDoviz(r.kalan, r.doviz) : "" })))));
  body.append(h("section", { class: "doviz-cari-section" },
    h("h3", { text: `Döviz hesabı${Object.keys(bakiye).length ? `: ${dovizBalanceText(bakiye)}` : " kapalı"}` }),
    h("p", { class: "hint", text: "+ bize borçlu, − bizim borcumuz. Döviz borcu kur değişse de aynı miktardır." }),
    h("div", { class: "table-wrap" }, table)));
};

/* ------------------------------------------------------------------ */
/* Ekran                                                               */
/* ------------------------------------------------------------------ */

extraViews.doviz = async () => {
  const [data] = await Promise.all([api("/api/doviz"), loadKasaAccounts()]);
  state.dovizCari = data.cari || [];
  const root = h("div", { class: "emanet-root doviz-root" });
  const tile = (label, value, tone = "", sub = null) => h("article", { class: `kasa-total ${tone}` }, h("span", { text: label }), h("strong", { text: value }), sub ? h("small", {}, sub) : null);
  const tiles = h("div", { class: "kasa-totals" });
  data.stok.forEach((s) => {
    const rate = state.kurlar?.[s.doviz];
    tiles.append(tile(`Kasadaki ${s.ad.toLocaleLowerCase("tr-TR")} (${s.hesaplar.filter((a) => a.tur === "NAKIT").map((a) => a.ad).join(", ") || "nakit"})`, fmtDoviz(s.nakit, s.doviz), "",
      `Ort. maliyet ${s.ortalama_maliyet ? formatTurkishNumber(s.ortalama_maliyet, 2, 4) : "-"}${rate ? ` · Kur ${formatTurkishNumber(rate.alis, 2, 4)} / ${formatTurkishNumber(rate.satis, 2, 4)}` : ""}`));
  });
  const alacak = {}, borc = {};
  data.cari.forEach((p) => Object.entries(p.bakiye).forEach(([cur, v]) => { const t = v > 0 ? alacak : borc; t[cur] = (t[cur] || 0) + Math.abs(v); }));
  const sumText = (t) => Object.entries(t).map(([cur, v]) => fmtMoney(v, cur)).join(" · ") || "Yok";
  tiles.append(
    tile("Döviz kârı (bugün)", fmtMoney(data.ozet.bugun_kar_tl), data.ozet.bugun_kar_tl < 0 ? "tone-red" : "tone-green", `Toplam: ${fmtMoney(data.ozet.toplam_kar_tl)} · Bugün ${data.ozet.bugun_islem} işlem`),
    tile("Döviz alacağımız (cari)", sumText(alacak), Object.keys(alacak).length ? "tone-red" : "", `Borcumuz: ${sumText(borc)}`));
  root.append(tiles);
  if (currentUser?.role !== "viewer") root.append(renderDovizForm(data));
  root.append(renderTabs([["ALL", "TÜMÜ"], ["AL", "ALIŞ"], ["SAT", "SATIŞ"], ["CARI", "TAHSİLAT / ÖDEME"], ["VERESIYE", "KALANI OLANLAR"], ["IPTAL", "İPTAL EDİLENLER"]], state.dovizFilter, (value) => { state.dovizFilter = value; render(); }));
  const match = { ALL: () => true, AL: (r) => r.islem === "AL", SAT: (r) => r.islem === "SAT", CARI: (r) => ["TAHSILAT", "ODEME"].includes(r.islem), VERESIYE: (r) => r.kalan > 0 && r.durum === "AKTIF", IPTAL: (r) => r.durum === "IPTAL" }[state.dovizFilter] || (() => true);
  const rows = filteredRows(data.kayitlar.filter(match).map((r) => ({ ...r, islem_text: DOVIZ_ISLEM[r.islem] })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Döviz Kayıtları" });
  if (rows.length) title.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("doviz", [["Tarih", "tarih"], ["İşlem", "islem_text"], ["Döviz", "doviz"], ["Miktar", "miktar"], ["Kur", "kur"], ["TL tutar", "tutar_tl"], ["Ödenen TL", "odenen_tl"], ["Cariye kalan", "kalan"], ["Kâr", "kar_tl"], ["Kişi", "kisi"], ["Telefon", "telefon"], ["Kimlik no", "kimlik_no"], ["Not", "notlar"], ["Personel", "kullanici"], ["Kayıt zamanı", "created_at"], ["Durum", "durum"], ["İptal gerekçesi", "iptal_gerekce"], ["İptal eden", "iptal_eden"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Kayıt yok." }));
  else {
    const writable = currentUser?.role !== "viewer";
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Tarih", "İşlem", "Kişi", "Miktar", "Kur", "TL tutar", "Ödeme", "Cariye kalan", "Kâr", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((r) => body.append(h("tr", { class: r.durum === "IPTAL" ? "doviz-iptal" : "" },
      h("td", { dataset: { label: "Tarih" }, text: trDate(r.tarih) }),
      h("td", { dataset: { label: "İşlem" } }, h("span", { class: `status-pill ${r.islem === "AL" || r.islem === "TAHSILAT" ? "open" : "closed"}`, text: r.islem_text }),
        r.durum === "IPTAL" ? h("small", { class: "cell-sub warn-text", title: r.iptal_gerekce, text: `İptal: ${r.iptal_gerekce}` }) : null),
      h("td", { dataset: { label: "Kişi" }, text: r.kisi || "-" }, r.kullanici ? h("small", { class: "cell-sub", text: r.kullanici }) : null),
      h("td", { class: "num strong", dataset: { label: "Miktar" }, text: fmtDoviz(r.miktar, r.doviz) }),
      h("td", { class: "num", dataset: { label: "Kur" }, text: formatTurkishNumber(r.kur, 2, 4) }),
      h("td", { class: "num", dataset: { label: "TL tutar" }, text: fmtMoney(r.tutar_tl) }),
      h("td", { dataset: { label: "Ödeme" }, text: (r.kasa_odemeleri || []).map((k) => `${k.hesap} ${fmtMoney(k.tutar, k.para_birimi)}`).join(" + ") }),
      h("td", { class: "num", dataset: { label: "Cariye kalan" }, text: r.kalan ? fmtDoviz(r.kalan, r.doviz) : "" }),
      h("td", { class: `num ${r.kar_tl < 0 ? "neg" : r.kar_tl > 0 ? "pos" : ""}`, dataset: { label: "Kâr" }, text: r.kar_tl === null ? "" : fmtMoney(r.kar_tl) }),
      h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
        h("button", { type: "button", class: "icon-btn icon-print", title: "Fiş yazdır", "aria-label": "Fiş yazdır", html: printIcon(), onclick: () => printDovizReceipt(r) }),
        r.notlar ? h("button", { type: "button", class: "icon-btn", title: "Not", "aria-label": "Not", html: iconSvg("view"), onclick: () => openNote(r.notlar) }) : null,
        writable ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Telefon, kimlik, not", "aria-label": "Telefon, kimlik, not düzelt", html: iconSvg("edit"), onclick: () => openDovizInfo(r) }) : null,
        writable && r.durum === "AKTIF" ? h("button", { type: "button", class: "icon-btn icon-delete", title: "İptal et", "aria-label": "İşlemi iptal et", html: iconSvg("delete"), onclick: () => openDovizCancel(r) }) : null))));
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  return root;
};

function renderDovizForm(data) {
  // `preset`: cari menüsünden tahsilat / ödeme ya da iptal edilen işlemin yeniden girişi.
  const preset = state.dovizPreset || {}; state.dovizPreset = null;
  const currencies = dovizCurrencies();
  if (!currencies.length) return h("section", { class: "panel form-panel" }, h("p", { class: "hint", text: "Aktif döviz kasası yok. Kasa > Hesaplar bölümünden Nakit Dolar / Nakit Euro hesabını açın." }));
  const panel = h("section", { class: "panel form-panel emanet-form-panel doviz-form-panel" });
  const form = h("form", { class: "entry-form emanet-form doviz-form" });
  // Aynı formun ikinci kez gönderilmesi (çift tıklama, bağlantı tekrarı) sunucuda tek kayıt olur.
  let islemAnahtari = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let islem = preset.islem || "AL";
  let cur = currencies.includes(preset.doviz) ? preset.doviz : currencies[0];
  const trade = () => islem === "AL" || islem === "SAT";
  const islemTabs = h("div", { class: "payment-type-tabs emanet-tabs doviz-islem-tabs" });
  DOVIZ_ISLEM_TAB.forEach(([value, text]) => islemTabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => { islem = value; resetRate(); sync(); } })));
  const curTabs = h("div", { class: "payment-type-tabs emanet-tabs doviz-cur-tabs" });
  currencies.forEach((value) => curTabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text: `${CUR_SYMBOL[value]} ${CUR_NAME[value]}`, onclick: () => { cur = value; resetRate(); sync(); } })));
  const tarih = h("input", { type: "date", name: "tarih", value: preset.tarih || today() });
  const miktar = decimalInput("miktar"); const kur = decimalInput("kur");
  const kisi = h("input", { name: "kisi", autocomplete: "off", maxlength: 120 });
  const telefon = h("input", { name: "telefon", autocomplete: "off", maxlength: 40, inputmode: "tel" });
  const kimlik = h("input", { name: "kimlik_no", autocomplete: "off", maxlength: 40, inputmode: "numeric" });
  const notlar = h("textarea", { name: "notlar", rows: 1, maxlength: 500 });
  const hesap = h("select", { "aria-label": "Döviz kasası" });
  const hesapLabel = labeled("Döviz kasası", hesap);
  const kisiLabel = labeled("Kişi / Firma", kisi);
  const miktarLabel = labeled("Miktar", miktar);
  const quick = h("div", { class: "sarrafiye-chips doviz-chips" }, h("span", { class: "sarrafiye-label", text: "Hızlı:" }),
    ...[100, 200, 500, 1000, 5000].map((n) => h("button", { type: "button", class: "sarrafiye-chip", text: String(n), onclick: () => { miktar.value = String(n); update(); } })));
  const tlOut = h("b", { text: fmtMoney(0) }); const kalanOut = h("span"); const balanceOut = h("span");
  const summary = h("div", { class: "metal-summary doviz-summary" }, h("span", { class: "metal-summary-total" }, "TL karşılığı", tlOut), kalanOut, balanceOut);
  let paymentAuto = true;
  let filling = false;
  const kasa = kasaRowsEditor([{}], "GIRIS", () => { if (!filling) paymentAuto = false; update(false); });
  const fillRow = (account, amount, rate = null) => {
    filling = true;
    kasa.rows().slice(1).forEach((r) => r.line.querySelector(".icon-delete").click());
    const row = kasa.rows()[0] || kasa.addRow();
    if (account) { row.select.value = String(account.id); row.select.dispatchEvent(new Event("change")); }
    if (rate) row.kur.value = amountText(rate);
    row.tutar.value = amountText(amount); row.tutar.dispatchEvent(new Event("input"));
    filling = false;
  };
  const pick = (type, c) => state.kasaHesaplar.find((a) => a.aktif && a.tur === type && a.para_birimi === c);
  const total = () => Math.round(readAmount(miktar.value) * readAmount(kur.value) * 100) / 100;
  const payDefault = () => {
    if (trade()) fillRow(pick("NAKIT", "TRY"), total());
    else fillRow(accountById(hesap.value) || pick("NAKIT", cur), readAmount(miktar.value), readAmount(kur.value));
  };
  const quickPay = h("div", { class: "kasa-quick" }, h("span", { class: "siparis-kapora-title" }),
    h("button", { type: "button", class: "kasa-quick-btn", text: "Nakit TL", onclick: () => { paymentAuto = false; fillRow(pick("NAKIT", "TRY"), total()); } }),
    h("button", { type: "button", class: "kasa-quick-btn", text: "Kart (POS)", onclick: () => { paymentAuto = false; fillRow(pick("POS", "TRY"), total()); } }),
    h("button", { type: "button", class: "kasa-quick-btn", text: "Havale / EFT", onclick: () => { paymentAuto = false; fillRow(pick("BANKA", "TRY"), total()); } }),
    h("button", { type: "button", class: "kasa-quick-btn doviz-only", text: "Döviz olarak", onclick: () => { paymentAuto = false; fillRow(accountById(hesap.value) || pick("NAKIT", cur), readAmount(miktar.value), readAmount(kur.value)); } }),
    h("button", { type: "button", class: "kasa-quick-btn trade-only", text: "Veresiye (cariye)", onclick: () => { paymentAuto = false; filling = true; kasa.rows().forEach((r) => { r.tutar.value = ""; r.tutar.dispatchEvent(new Event("input")); }); filling = false; update(false); } }));
  const kasaHint = h("p", { class: "hint" });
  const kasaBox = h("div", { class: "siparis-kapora" }, quickPay, kasa.element, kasaHint);
  form.append(h("div", { class: "metal-tabs-row" }, islemTabs, curTabs), quick, labeled("Tarih", tarih), miktarLabel, labeled("Kur (1 birim = ? TL)", kur), hesapLabel, kisiLabel,
    labeled("Telefon", telefon), labeled("T.C. / pasaport no", kimlik), labeled("Not", notlar), summary, kasaBox);
  attachAutocomplete(kisi, "people");
  // Kur canlı kuru izler (alışta alış, satışta satış kuru); elle yazılırsa o kalır. Kayıtta onaylanan kur saklanır.
  const side = () => (islem === "AL" || islem === "ODEME" ? "alis" : "satis");
  followLivePrice(kur, "alis", () => {
    const rate = state.kurlar?.[cur];
    if (!rate) return { value: 0, note: "Canlı kur alınamadı; kuru elle yazın." };
    const source = rate.kaynak === "manuel" ? "elle girilen kur" : `canlı ${side() === "alis" ? "alış" : "satış"} kuru${state.price?.saglayici ? ` · ${state.price.saglayici}` : ""}${state.price?.guncelleme ? ` · ${state.price.guncelleme}` : ""}`;
    return { value: Math.round(rate[side()] * 10000) / 10000, note: source.charAt(0).toUpperCase() + source.slice(1) };
  });
  const resetRate = () => { delete kur.dataset.elle; kur.value = ""; };
  function update(auto = true) {
    tlOut.textContent = fmtMoney(total());
    if (auto && paymentAuto) payDefault();
    const amount = readAmount(miktar.value); const rate = readAmount(kur.value);
    const paid = kasa.items().reduce((t, r) => { const a = accountById(r.hesap_id); return t + (a?.para_birimi === cur ? r.tutar : r.tutar * (r.kur || 1) / (rate || 1)); }, 0);
    const kalan = Math.round((amount - paid) * 100) / 100;
    kalanOut.textContent = trade() && amount && rate && kalan > 0.004 ? `Cariye kalan: ${fmtDoviz(kalan, cur)}${kisi.value.trim() ? "" : " (kişi adı girin)"}` : "";
    kalanOut.className = kalan > 0.004 ? "warn-text" : "";
    const bal = kisi.value.trim() ? dovizBalanceOf(kisi.value)[cur] : 0;
    const stock = data.stok.find((s) => s.doviz === cur);
    balanceOut.textContent = [islem === "SAT" && stock ? `Kasada: ${fmtDoviz(stock.nakit, cur)}` : "", bal ? `Cari döviz: ${bal > 0 ? "bize borçlu" : "borcumuz"} ${fmtDoviz(Math.abs(bal), cur)}` : ""].filter(Boolean).join(" · ");
  }
  function sync() {
    islemTabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === islem));
    curTabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === cur));
    accountOptions(hesap, (a) => a.para_birimi === cur, pick("NAKIT", cur)?.id);
    hesapLabel.hidden = hesap.options.length < 2;
    kisi.required = !trade();
    kisiLabel.firstChild.textContent = trade() ? "Kişi / Firma (veresiyede zorunlu)" : "Cari (kişi / firma)";
    miktarLabel.firstChild.textContent = trade() ? `Miktar (${CUR_NAME[cur]})` : `Kapatılan döviz borcu (${CUR_NAME[cur]})`;
    quick.hidden = !trade();
    quickPay.firstChild.textContent = islem === "AL" || islem === "ODEME" ? "Müşteriye ödenen" : "Müşteriden alınan";
    quickPay.querySelectorAll(".doviz-only").forEach((b) => { b.hidden = trade(); });
    quickPay.querySelectorAll(".trade-only").forEach((b) => { b.hidden = !trade(); });
    kasaHint.textContent = trade()
      ? `${CUR_NAME[cur]} seçilen döviz kasasına ${islem === "AL" ? "girer" : "kasadan çıkar"}; burada karşılığı olan TL'nin hangi kasaya ${islem === "AL" ? "çıktığını" : "girdiğini"} seçin. Eksik kalan kısım cariye ${CUR_NAME[cur].toLocaleLowerCase("tr-TR")} olarak yazılır.`
      : `Döviz olarak veya TL karşılığı (kur x miktar) olarak ${islem === "TAHSILAT" ? "alınabilir" : "ödenebilir"}.`;
    paymentAuto = true;
    setLivePrice(kur);
    update();
  }
  miktar.addEventListener("input", () => update());
  kur.addEventListener("input", () => update());
  kisi.addEventListener("input", () => update(false));
  kisi.addEventListener("change", () => {
    if (trade() || readAmount(miktar.value)) return update(false);
    const bal = dovizBalanceOf(kisi.value)[cur];
    if (bal) { miktar.value = amountText(Math.abs(bal)); update(); }
  });
  kisi.value = preset.kisi || ""; telefon.value = preset.telefon || ""; kimlik.value = preset.kimlik_no || ""; notlar.value = preset.notlar || "";
  if (preset.miktar) miktar.value = amountText(preset.miktar);
  else if (preset.kisi && !["AL", "SAT"].includes(islem)) { const bal = dovizBalanceOf(preset.kisi)[cur]; if (bal) miktar.value = amountText(Math.abs(bal)); }
  sync();
  if (preset.kur) { kur.value = amountText(preset.kur); kur.dataset.elle = "1"; update(); }
  if (preset.kasa) {
    // İptal edilen işlemin ödemeleri: düzeltip yeniden girmek için aynen gelir.
    paymentAuto = false; filling = true;
    kasa.rows().slice().forEach((r) => r.line.querySelector(".icon-delete").click());
    preset.kasa.forEach((k) => kasa.addRow(k));
    if (!preset.kasa.length) kasa.addRow();
    filling = false; update(false);
  }
  const save = h("button", { type: "submit", text: "Kaydet" });
  const savePrint = h("button", { type: "submit", class: "secondary", text: "Kaydet ve fiş yazdır", dataset: { print: "1" } });
  form.append(h("div", { class: "form-bottom-actions" }, save, savePrint));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const print = event.submitter?.dataset.print === "1";
    try {
      const items = kasa.items();
      if (items.length) kasa.validate();
      if (!trade() && !items.length) throw new Error("Tahsilat / ödemenin hangi kasaya girdiğini seçin.");
      const amount = readAmount(miktar.value); const rate = readAmount(kur.value);
      if (!(amount > 0) || !(rate > 0)) throw new Error("Miktar ve kuru girin.");
      // Onaydan önce işlemin tamamı gösterilir.
      const yon = { AL: `Müşteriden ${fmtDoviz(amount, cur)} alınıyor, karşılığı ödeniyor`, SAT: `Müşteriye ${fmtDoviz(amount, cur)} veriliyor, karşılığı alınıyor`,
        TAHSILAT: `${esc(kisi.value)} carisinden ${fmtDoviz(amount, cur)} borç tahsil ediliyor`, ODEME: `${esc(kisi.value)} carisine ${fmtDoviz(amount, cur)} borcumuz ödeniyor` }[islem];
      const odeme = items.length ? esc(kasaSummaryText(items)) : "Ödeme yok (tamamı cariye)";
      if (!(await showConfirm(`${yon}. Kur ${formatTurkishNumber(rate, 2, 4)}, TL karşılığı ${fmtMoney(total())}. Ödeme: ${odeme}${kalanOut.textContent ? `. ${kalanOut.textContent}` : ""}. Onaylıyor musunuz`, "Onayla", "Vazgeç"))) return;
      save.disabled = savePrint.disabled = true;
      const payload = { tarih: tarih.value, islem, doviz: cur, miktar: String(amount), kur: String(rate), doviz_hesap_id: Number(hesap.value) || null,
        kisi: kisi.value, telefon: telefon.value, kimlik_no: kimlik.value, notlar: notlar.value, kasa: items, islem_anahtari: islemAnahtari };
      const saved = await api("/api/doviz", { method: "POST", body: JSON.stringify(payload) });
      showMessage(`Döviz ${DOVIZ_ISLEM[islem].toLocaleLowerCase("tr-TR")} kaydedildi.`);
      await refreshSuggestions(); await render();
      if (print) {
        const row = (await api("/api/doviz")).kayitlar.find((r) => r.id === saved.id);
        if (row) printDovizReceipt(row);
      }
    } catch (error) { showMessage(error.message, true); save.disabled = savePrint.disabled = false; }
  };
  panel.append(form);
  return panel;
}

/** Tamamlanan işlemde yalnızca telefon, kimlik ve not düzeltilir. */
function openDovizInfo(row) {
  const { box, close } = openModal(`Döviz işlemi D-${row.id} · bilgiler`, "kasa-modal");
  const form = h("form", { class: "settings-form" });
  const telefon = h("input", { value: row.telefon || "", maxlength: 40 }); const kimlik = h("input", { value: row.kimlik_no || "", maxlength: 40 });
  const notlar = h("textarea", { rows: 2, maxlength: 500 }); notlar.value = row.notlar || "";
  const save = h("button", { type: "submit", text: "Kaydet" });
  form.append(h("p", { class: "hint", text: "Tutar, kur, döviz, kişi ve ödeme değiştirilemez; yanlış işlem iptal edilip yeniden girilir." }),
    labeled("Telefon", telefon), labeled("T.C. / pasaport no", kimlik), labeled("Not", notlar),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try { await api(`/api/doviz/${row.id}`, { method: "PUT", body: JSON.stringify({ telefon: telefon.value, kimlik_no: kimlik.value, notlar: notlar.value }) }); close(); showMessage("Kayıt güncellendi."); render(); }
    catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); telefon.focus();
}

/** İptal: gerekçe zorunlu; kasa ters kayıtla geri alınır, kayıt "iptal" olarak kalır. İstenirse form aynı bilgilerle doldurulur. */
function openDovizCancel(row) {
  const { box, close } = openModal(`Döviz işlemini iptal et · D-${row.id}`, "kasa-modal");
  const form = h("form", { class: "settings-form" });
  const gerekce = h("input", { required: true, maxlength: 300, placeholder: "Örn. yanlış kur girildi" });
  const again = h("input", { type: "checkbox", checked: true });
  const save = h("button", { type: "submit", class: "danger-button", text: "İptal et" });
  form.append(h("p", { class: "hint", text: `${DOVIZ_ISLEM[row.islem]} · ${fmtDoviz(row.miktar, row.doviz)} × ${formatTurkishNumber(row.kur, 2, 4)} = ${fmtMoney(row.tutar_tl)}${row.kisi ? ` · ${row.kisi}` : ""}. Kasaya işlenen hareketlerin tersi bugünün tarihiyle yazılır; cari ve kâr bu işlemi saymaz. Kayıt silinmez.` }),
    labeled("İptal gerekçesi", gerekce), h("label", { class: "check-field" }, again, " İptalden sonra formu bu bilgilerle doldur (düzeltip yeniden girmek için)"),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      await api(`/api/doviz/${row.id}/iptal`, { method: "POST", body: JSON.stringify({ gerekce: gerekce.value }) });
      close(); showMessage("İşlem iptal edildi; kasa ters kayıtla geri alındı.");
      if (again.checked) state.dovizPreset = { islem: row.islem, doviz: row.doviz, miktar: row.miktar, kur: row.kur, kisi: row.kisi, telefon: row.telefon, kimlik_no: row.kimlik_no, notlar: row.notlar, kasa: row.kasa_odemeleri || [] };
      render(); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); gerekce.focus();
}

/* ------------------------------------------------------------------ */
/* Fiş                                                                 */
/* ------------------------------------------------------------------ */

async function printDovizReceipt(row) {
  const firma = await loadFirma();
  const line = (label, value) => value === "" || value === null || value === undefined ? "" : `<tr><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const title = { AL: "DÖVİZ ALIŞ BORDROSU", SAT: "DÖVİZ SATIŞ FİŞİ", TAHSILAT: "DÖVİZ TAHSİLAT MAKBUZU", ODEME: "DÖVİZ ÖDEME MAKBUZU" }[row.islem];
  const payments = row.kasa_odemeleri || [];
  const trade = row.islem === "AL" || row.islem === "SAT";
  const inner = receiptHeader(firma, title, `D-${row.id}`, row.tarih)
    + `<table>${line(row.islem === "AL" ? "Satan" : "Müşteri", row.kisi || "-")}${line("Telefon", row.telefon)}${line("T.C. / pasaport", row.kimlik_no)}</table><hr><table>
      ${line("Döviz", `${CUR_NAME[row.doviz] || row.doviz} (${row.doviz})`)}${line("Miktar", fmtMoney(row.miktar, row.doviz))}${line("Kur", formatTurkishNumber(row.kur, 2, 4))}
      <tr class="total"><td>${trade ? "TL KARŞILIĞI" : "TL DEĞERİ"}</td><td class="r">${esc(fmtMoney(row.tutar_tl))}</td></tr></table>
      ${payments.length ? `<hr><table>${payments.map((k) => line(k.hesap, fmtMoney(k.tutar, k.para_birimi))).join("")}</table>` : ""}
      ${row.kalan > 0 ? `<hr><table>${line(row.islem === "SAT" ? "Kalan borç" : "Kalan alacak", fmtMoney(row.kalan, row.doviz))}</table>` : ""}
      ${row.notlar ? `<div class="muted">Not: ${esc(row.notlar)}</div>` : ""}${row.kullanici ? `<div class="muted">İşlemi yapan: ${esc(row.kullanici)}</div>` : ""}` + receiptFooter(firma);
  printHtml("Döviz fişi", inner);
}

/* ------------------------------------------------------------------ */
/* Stok ekranında döviz (kasadaki nakit döviz)                          */
/* ------------------------------------------------------------------ */

async function renderDovizStock() {
  const data = await api("/api/doviz/ozet");
  const section = h("section", { class: "table-section" }, h("h2", { text: "Döviz Stoku (kasadaki döviz)" }),
    h("p", { class: "hint", text: "Döviz stoku kasadaki döviz hesaplarının bakiyesidir; döviz alış-satışı, dövizle alınan ödemeler ve kasa girişleri buraya yansır." }));
  const wrap = h("div", { class: "table-wrap" });
  if (!data.stok.length) wrap.append(h("div", { class: "empty", text: "Döviz kasası yok." }));
  else wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ...["Döviz", "Hesap", "Bakiye", "Ort. maliyet (TL)", "Maliyet değeri", "Güncel değer (alış kuru)"].map((t) => h("th", { text: t })))),
    h("tbody", {}, ...data.stok.flatMap((s) => s.hesaplar.map((a) => {
      const rate = state.kurlar?.[s.doviz]?.alis;
      return h("tr", {}, h("td", { text: CUR_NAME[s.doviz] }), h("td", { text: a.ad }), h("td", { class: "num strong", text: fmtMoney(a.bakiye, s.doviz) }),
        h("td", { class: "num", text: s.ortalama_maliyet ? formatTurkishNumber(s.ortalama_maliyet, 2, 4) : "-" }),
        h("td", { class: "num", text: s.ortalama_maliyet ? fmtMoney(a.bakiye * s.ortalama_maliyet) : "-" }),
        h("td", { class: "num", text: rate ? fmtMoney(a.bakiye * rate) : "-" }));
    })))));
  section.append(wrap);
  return section;
}
