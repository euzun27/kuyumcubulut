/*
 * Gümüş ve bakır alım-satımı. Altının has stoku ve carisinden ayrıdır.
 * Gümüş: saf gram (gram x milyem / 1000) x saf gram fiyatı (TL/gr).
 * Bakır: kilo x kilo fiyatı (TL/kg); hurda bakır sınıfı "Ayar" alanına yazılır.
 * Ödenen / alınan para kasaya bağlı yazılır. modules.js yardımcılarını kullanır.
 */

Object.assign(views, { metal: { title: "Gümüş / Bakır", subtitle: "Gümüş ve bakır alış-satış, stok ve kâr" } });
Object.assign(KASA_CATEGORY_LABEL, { METAL_ALIS: "Gümüş/bakır alış", METAL_SATIS: "Gümüş/bakır satış" });

const METAL_LABEL = { GUMUS: "Gümüş", BAKIR: "Bakır" };
/** Hızlı seçim: [ad, ayar, milyem, cinsi] */
const METAL_PRESETS = {
  GUMUS: [["999 Külçe / granül", "999", 999, "Külçe"], ["925 Takı (sterling)", "925", 925, "Takı"], ["925 Hurda", "925", 925, "Hurda"], ["900", "900", 900, "Hurda"], ["800 Eski eşya", "800", 800, "Eşya"]],
  BAKIR: [["1. sınıf (parlak tel)", "1. SINIF", 1000, "Hurda bakır"], ["2. sınıf", "2. SINIF", 1000, "Hurda bakır"], ["Eşya / takı", "", 1000, "Eşya"]],
};
const METAL_PRODUCTS = ["Hurda", "Külçe", "Granül", "Takı", "Eşya", "Tel", "Levha", "Hurda bakır"];
state.metalFilter = "ALL";
state.metalPreset = null;
state.metalFiyat = {};
let metalEditing = null;

const priceUnitText = (metal) => metal === "BAKIR" ? "TL/kg" : "TL/gr";

async function loadMetalPrices() {
  try { const data = await api("/api/altin-fiyati"); state.metalFiyat = data.metaller || {}; state.metalFiyatManuel = data.manuel_metaller || {}; } catch { /* fiyatsız da çalışır */ }
  return state.metalFiyat;
}

function openMetalPriceDialog() {
  const { box, close } = openModal("Gümüş ve bakır fiyatı", "kasa-modal");
  const form = h("form", { class: "settings-form" });
  const inputs = Object.keys(METAL_LABEL).map((metal) => {
    const own = state.metalFiyatManuel?.[metal];
    const alis = decimalInput(`${metal}_alis`); const satis = decimalInput(`${metal}_satis`);
    alis.value = amountText(own?.alis); satis.value = amountText(own?.satis);
    const live = state.metalFiyat?.[metal]?.kaynak === "canli" ? ` (canlı: ${formatTurkishNumber(state.metalFiyat[metal].alis, 2, 2)} / ${formatTurkishNumber(state.metalFiyat[metal].satis, 2, 2)})` : "";
    form.append(h("p", { class: "hint", text: `${METAL_LABEL[metal]} · ${priceUnitText(metal)}${live}` }), labeled("Alış fiyatı", alis), labeled("Satış fiyatı", satis));
    return [metal, alis, satis];
  });
  const save = h("button", { type: "submit", text: "Kaydet" });
  form.append(
    h("p", { class: "hint", text: "Gümüş fiyatı 1 gram saf (999) gümüşün fiyatıdır; 925 ayarda saf gram kendiliğinden hesaplanır. Bakırın canlı fiyatı olmadığı için kilo fiyatını burada girin. Boş bırakılan metal için canlı fiyat kullanılır." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const payload = Object.fromEntries(inputs.map(([metal, a, s]) => [metal, { alis: a.value.trim() ? String(readAmount(a.value)) : "", satis: s.value.trim() ? String(readAmount(s.value)) : "" }]));
      await api("/api/altin-fiyati/metal", { method: "PUT", body: JSON.stringify(payload) });
      await loadMetalPrices(); close(); showMessage("Metal fiyatları kaydedildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); inputs[0][1].focus();
}

extraViews.metal = async () => {
  const [data] = await Promise.all([api("/api/metal"), loadKasaAccounts(), loadMetalPrices()]);
  const root = h("div", { class: "emanet-root metal-root" });
  const o = data.ozet;
  const stock = Object.fromEntries(data.stok.map((s) => [s.metal, s]));
  const tile = (label, value, tone = "", sub = null, extra = null) => h("article", { class: `kasa-total ${tone}` }, h("span", { text: label }), h("strong", { text: value }), sub ? h("small", {}, sub) : null, extra);
  const stockSub = (s) => s.ayarlar.length ? h("span", { class: "metal-stock-list" }, ...s.ayarlar.map((a) => h("span", { text: `${a.ayar}: ${formatValue("gram", a.gram)} gr` }))) : "Stok yok";
  const g = stock.GUMUS, b = stock.BAKIR;
  const fiyat = state.metalFiyat;
  const priceText = (metal) => fiyat[metal] ? `${formatTurkishNumber(fiyat[metal].alis, 2, 2)} / ${formatTurkishNumber(fiyat[metal].satis, 2, 2)} ${priceUnitText(metal)}` : "Fiyat girilmedi";
  root.append(h("div", { class: "kasa-totals" },
    tile("Gümüş stoku (saf)", `${formatValue("has", g.kalan_saf)} gr`, "tone-silver", stockSub(g)),
    tile("Bakır stoku", `${formatTurkishNumber(b.kalan_saf / 1000, 0, 3)} kg`, "tone-copper", stockSub(b)),
    tile("Gümüş / bakır fiyatı (alış / satış)", priceText("GUMUS"), "", `Bakır: ${priceText("BAKIR")}`,
      currentUser?.role !== "viewer" ? h("button", { type: "button", class: "secondary tile-btn", text: "Fiyat gir", onclick: openMetalPriceDialog }) : null),
    tile("Satış kârı", fmtMoney(o.toplam_kar_tl), o.toplam_kar_tl < 0 ? "tone-red" : "tone-green", `Stok değeri: ${fmtMoney(g.stok_degeri + b.stok_degeri)}`),
    tile("Veresiye", fmtMoney(o.tahsil_edilecek_tl), o.tahsil_edilecek_tl ? "tone-red" : "", `Ödeyeceğimiz: ${fmtMoney(o.odenecek_tl)}`)));
  if (currentUser?.role !== "viewer") root.append(renderMetalForm(stock));
  root.append(renderTabs([["ALL", "TÜMÜ"], ["GUMUS", "GÜMÜŞ"], ["BAKIR", "BAKIR"], ["VERESIYE", "KALANI OLANLAR"]], state.metalFilter, (value) => { state.metalFilter = value; render(); }));
  const match = { ALL: () => true, GUMUS: (r) => r.metal === "GUMUS", BAKIR: (r) => r.metal === "BAKIR", VERESIYE: (r) => r.kalan_tl > 0 }[state.metalFilter] || (() => true);
  const rows = filteredRows(data.kayitlar.filter(match).map((r) => ({ ...r, islem_text: r.islem_turu === "ALIS" ? "Alış" : "Satış", metal_text: METAL_LABEL[r.metal] })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Gümüş ve Bakır Kayıtları" });
  if (rows.length) title.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("gumus-bakir", [["Tarih", "tarih"], ["İşlem", "islem_text"], ["Metal", "metal_text"], ["Kişi", "kisi"], ["Cinsi", "cinsi"], ["Ayar", "ayar"], ["Adet", "adet"], ["Gram", "gram"], ["Milyem", "milyem"], ["Saf gram", "saf_gram"], ["Fiyat", "birim_fiyat"], ["İşçilik", "iscilik"], ["Tutar", "tutar"], ["Ödenen / alınan", "odenen_tl"], ["Kalan", "kalan_tl"], ["Kâr", "kar_tl"], ["Not", "notlar"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Kayıt yok." }));
  else {
    const writable = currentUser?.role !== "viewer";
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Tarih", "İşlem", "Kişi", "Metal / ayar", "Gram", "Saf gr", "Fiyat", "Tutar", "Kalan", "Kâr", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((r) => body.append(h("tr", {},
      h("td", { dataset: { label: "Tarih" }, text: trDate(r.tarih) }),
      h("td", { dataset: { label: "İşlem" } }, h("span", { class: `status-pill ${r.islem_turu === "ALIS" ? "open" : "closed"}`, text: r.islem_text })),
      h("td", { dataset: { label: "Kişi" }, text: r.kisi }),
      h("td", { dataset: { label: "Metal / ayar" } }, `${r.metal_text} ${r.ayar}`.trim(), r.cinsi ? h("small", { class: "cell-sub", text: r.cinsi }) : null),
      h("td", { class: "num", dataset: { label: "Gram" }, text: r.metal === "BAKIR" && r.gram >= 1000 ? `${formatTurkishNumber(r.gram / 1000, 0, 3)} kg` : formatValue("gram", r.gram) }),
      h("td", { class: "num", dataset: { label: "Saf gr" }, text: r.milyem < 1000 ? `${formatValue("has", r.saf_gram)} (${formatTurkishNumber(r.milyem)})` : "" }),
      h("td", { class: "num", dataset: { label: "Fiyat" }, text: `${formatTurkishNumber(r.birim_fiyat, 2, 2)} ${priceUnitText(r.metal)}` }),
      h("td", { class: "num", dataset: { label: "Tutar" }, text: fmtMoney(r.tutar) }),
      h("td", { class: "num", dataset: { label: "Kalan" }, text: r.kalan_tl > 0 ? fmtMoney(r.kalan_tl) : "" }),
      h("td", { class: "num", dataset: { label: "Kâr" }, text: r.kar_tl === null ? "" : fmtMoney(r.kar_tl) }),
      h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
        r.notlar ? h("button", { type: "button", class: "icon-btn", title: "Not", "aria-label": "Not", html: iconSvg("view"), onclick: () => openNote(r.notlar) }) : null,
        writable ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Düzenle", "aria-label": "Düzenle", html: iconSvg("edit"), onclick: () => { metalEditing = r; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }) : null,
        writable ? h("button", {
          type: "button", class: "icon-btn icon-delete", title: "Sil", "aria-label": "Sil", html: iconSvg("delete"),
          onclick: async () => { if (await showConfirm("Bu kayıt ve kasaya işlenen ödemesi silinsin mi", "Sil", "İptal")) { try { await api(`/api/metal/${r.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } },
        }) : null))));
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  return root;
};

function renderMetalForm(stock) {
  const edit = metalEditing;
  const preset = state.metalPreset; state.metalPreset = null;
  const panel = h("section", { class: "panel form-panel emanet-form-panel metal-form-panel" });
  const form = h("form", { class: "entry-form emanet-form metal-form" });
  let metal = edit?.metal || preset?.metal || "GUMUS";
  let islem = edit?.islem_turu || preset?.islem || "ALIS";
  let priceAuto = !edit;
  const metalTabs = h("div", { class: "payment-type-tabs emanet-tabs" });
  Object.entries(METAL_LABEL).forEach(([value, text]) => metalTabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => { metal = value; priceAuto = true; sync(true); } })));
  const islemTabs = h("div", { class: "payment-type-tabs emanet-tabs" });
  [["ALIS", "Alış (müşteriden)"], ["SATIS", "Satış (müşteriye)"]].forEach(([value, text]) => islemTabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => { islem = value; priceAuto = true; sync(true); } })));
  const chips = h("div", { class: "sarrafiye-chips metal-chips" });
  const tarih = h("input", { type: "date", name: "tarih", value: edit?.tarih || today() });
  const kisi = h("input", { name: "kisi", required: true, autocomplete: "off" });
  const cinsi = h("input", { name: "cinsi", autocomplete: "off", maxlength: 80 });
  const ayar = h("input", { name: "ayar", autocomplete: "off", maxlength: 20 });
  const adet = decimalInput("adet"); const gram = decimalInput("gram"); const milyem = decimalInput("milyem");
  const fiyat = decimalInput("birim_fiyat"); const iscilik = decimalInput("iscilik");
  const notlar = h("textarea", { name: "notlar", rows: 1, maxlength: 500 });
  const gramLabel = labeled("Gram", gram); const fiyatLabel = labeled("Fiyat", fiyat); const milyemLabel = labeled("Milyem", milyem);
  const safOut = h("b", { text: "0" }); const tutarOut = h("b", { text: fmtMoney(0) }); const stockOut = h("span");
  const summary = h("div", { class: "metal-summary" }, h("span", {}, "Saf gram", safOut), h("span", { class: "metal-summary-total" }, "Tutar", tutarOut), stockOut);
  const kasa = kasaRowsEditor(edit?.kasa_odemeleri?.length ? edit.kasa_odemeleri : [{}], islem === "ALIS" ? "CIKIS" : "GIRIS");
  const fullPay = h("button", { type: "button", class: "kasa-quick-btn", text: "Tamamı nakit", onclick: () => {
    const nakit = state.kasaHesaplar.find((a) => a.aktif && a.tur === "NAKIT" && a.para_birimi === "TRY");
    const row = kasa.rows()[0] || kasa.addRow();
    if (nakit) { row.select.value = String(nakit.id); row.select.dispatchEvent(new Event("change")); }
    row.tutar.value = amountText(total()); row.tutar.dispatchEvent(new Event("input"));
  } });
  const kasaTitle = h("span", { class: "siparis-kapora-title" });
  const kasaBox = h("div", { class: "siparis-kapora" }, h("div", { class: "kasa-quick" }, kasaTitle, fullPay), kasa.element,
    h("p", { class: "hint", text: "Boş bırakırsanız tutarın tamamı kalan (veresiye) olarak görünür." }));
  form.append(h("div", { class: "metal-tabs-row" }, metalTabs, islemTabs), chips, labeled("Tarih", tarih), labeled("Kişi / Firma", kisi), labeled("Cinsi", cinsi), labeled("Ayar / sınıf", ayar),
    labeled("Adet", adet), gramLabel, milyemLabel, fiyatLabel, labeled("İşçilik (TL)", iscilik), labeled("Not", notlar), summary, kasaBox);
  attachAutocomplete(kisi, "people"); attachAutocomplete(cinsi, METAL_PRODUCTS);
  const safGram = () => readAmount(gram.value) * (readAmount(milyem.value) || 1000) / 1000;
  const total = () => {
    const base = metal === "BAKIR" ? safGram() / 1000 * readAmount(fiyat.value) : safGram() * readAmount(fiyat.value);
    return Math.round((base + readAmount(iscilik.value)) * 100) / 100;
  };
  const update = () => {
    safOut.textContent = metal === "BAKIR" ? `${formatTurkishNumber(safGram() / 1000, 0, 3)} kg` : `${formatValue("has", safGram())} gr`;
    tutarOut.textContent = fmtMoney(total());
    const s = stock?.[metal];
    stockOut.textContent = islem === "SATIS" && s ? `Stokta: ${metal === "BAKIR" ? `${formatTurkishNumber(s.kalan_saf / 1000, 0, 3)} kg` : `${formatValue("has", s.kalan_saf)} gr saf`}` : "";
  };
  const fillPrice = () => {
    const p = state.metalFiyat?.[metal];
    if (!priceAuto || !p) return;
    fiyat.value = amountText(islem === "ALIS" ? p.alis : p.satis);
  };
  const sync = (changed) => {
    metalTabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === metal));
    islemTabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === islem));
    chips.replaceChildren(h("span", { class: "sarrafiye-label", text: `${METAL_LABEL[metal]}:` }), ...METAL_PRESETS[metal].map(([name, a, m, c]) => h("button", {
      type: "button", class: `sarrafiye-chip metal-chip ${metal === "BAKIR" ? "copper" : "silver"}`, text: name,
      onclick: () => { ayar.value = a; milyem.value = String(m); if (!cinsi.value || METAL_PRODUCTS.includes(cinsi.value)) cinsi.value = c; update(); gram.focus(); },
    })));
    gramLabel.firstChild.textContent = metal === "BAKIR" ? "Gram (1 kg = 1000 gr)" : "Gram";
    fiyatLabel.firstChild.textContent = metal === "BAKIR" ? "Kilo fiyatı (TL/kg)" : "Saf gram fiyatı (TL/gr)";
    milyemLabel.hidden = metal === "BAKIR";
    if (metal === "BAKIR") milyem.value = "1000";
    else if (changed && readAmount(milyem.value) === 1000 && !ayar.value) milyem.value = "925";
    kasaTitle.textContent = islem === "ALIS" ? "Müşteriye ödenen" : "Müşteriden alınan";
    fillPrice(); update();
  };
  fiyat.addEventListener("input", () => { priceAuto = false; update(); });
  [gram, milyem, iscilik].forEach((input) => input.addEventListener("input", update));
  ayar.addEventListener("change", () => { const m = /^\d{3,4}$/.test(ayar.value.trim()) ? Number(ayar.value) : 0; if (m >= 100 && m <= 1000 && metal === "GUMUS") { milyem.value = String(m); update(); } });
  if (edit) {
    kisi.value = edit.kisi; cinsi.value = edit.cinsi || ""; ayar.value = edit.ayar || ""; adet.value = amountText(edit.adet); gram.value = amountText(edit.gram);
    milyem.value = amountText(edit.milyem); fiyat.value = amountText(edit.birim_fiyat); iscilik.value = amountText(edit.iscilik); notlar.value = edit.notlar || "";
  } else {
    milyem.value = metal === "BAKIR" ? "1000" : String(preset?.milyem || 925);
    ayar.value = preset?.ayar ?? (metal === "BAKIR" ? "" : "925");
    cinsi.value = preset?.cinsi || "";
  }
  sync(false);
  const save = h("button", { type: "submit", text: edit ? "Güncelle" : "Kaydet" });
  const actions = h("div", { class: "form-bottom-actions" }, save);
  if (edit) actions.append(h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { metalEditing = null; render(); } }));
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const items = kasa.items();
      if (items.length) kasa.validate();
      const payload = { tarih: tarih.value, islem_turu: islem, metal, kisi: kisi.value, cinsi: cinsi.value, ayar: ayar.value, adet: String(readAmount(adet.value)), gram: String(readAmount(gram.value)),
        milyem: String(readAmount(milyem.value) || 1000), birim_fiyat: String(readAmount(fiyat.value)), iscilik: String(readAmount(iscilik.value)), notlar: notlar.value, kasa: items };
      await api(edit ? `/api/metal/${edit.id}` : "/api/metal", { method: edit ? "PUT" : "POST", body: JSON.stringify(payload) });
      showMessage(edit ? "Kayıt güncellendi." : `${METAL_LABEL[metal]} ${islem === "ALIS" ? "alışı" : "satışı"} kaydedildi.`);
      metalEditing = null; await refreshSuggestions(); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(form);
  return panel;
}

/* Alış ve hurda ekranlarında gümüş / bakır kısayolu: listede yalnızca altın sarrafiye vardı. */
const attachSarrafiyeBase = attachSarrafiye;
attachSarrafiye = function (form, withChips) {
  attachSarrafiyeBase(form, withChips);
  if (!form.elements.cinsi || form.querySelector(".metal-chips")) return;
  const hurda = !!form.elements.islem_turu;
  if (!withChips && !hurda) return;
  const satis = state.view === "hurda_satis" || state.view === "satis";
  const go = (preset) => { state.metalPreset = { islem: satis ? "SATIS" : "ALIS", ...preset }; metalEditing = null; goView("metal"); };
  const gold = form.querySelector(".sarrafiye-chips");
  // Altın sarrafiye varsa aynı sıraya, Gram Altın'ın yanına eklenir; yer kalmazsa alt satıra kayar.
  const chips = h(gold ? "span" : "div", { class: gold ? "metal-chips metal-chips-inline" : "sarrafiye-chips metal-chips", role: "group", "aria-label": "Gümüş ve bakır" },
    h("span", { class: "sarrafiye-label", text: "Gümüş / bakır:" }),
    h("button", { type: "button", class: "sarrafiye-chip metal-chip silver", text: "GÜMÜŞ 925", title: "Gümüş / Bakır ekranında açar", onclick: () => go({ metal: "GUMUS", ayar: "925", milyem: 925 }) }),
    h("button", { type: "button", class: "sarrafiye-chip metal-chip silver", text: "GÜMÜŞ 999", title: "Gümüş / Bakır ekranında açar", onclick: () => go({ metal: "GUMUS", ayar: "999", milyem: 999, cinsi: "Külçe" }) }),
    h("button", { type: "button", class: "sarrafiye-chip metal-chip copper", text: "BAKIR", title: "Gümüş / Bakır ekranında açar", onclick: () => go({ metal: "BAKIR", ayar: "", milyem: 1000, cinsi: "Hurda bakır" }) }));
  if (gold) gold.append(chips); else form.prepend(chips);
};
