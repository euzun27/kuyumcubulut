/*
 * Raporlar, ürün etiketleri (Code128 barkod, pırlanta bilgisi) ve satış
 * formunda barkod okutma. modules.js / takip.js yardımcılarını kullanır.
 */

Object.assign(views, {
  etiket: { title: "Etiket ve Barkod", subtitle: "Parça etiketleri, pırlanta bilgisi ve barkod yazdırma" },
  rapor: { title: "Raporlar", subtitle: "Satış, kâr, ürün, müşteri, döviz, kasa ve cari raporları" },
});
const STONE_LABEL = { "": "Taşsız", PIRLANTA: "Pırlanta", RENKLI: "Renkli taş", ZIRKON: "Zirkon", INCI: "İnci", DIGER: "Diğer" };
state.etiketFilter = "STOKTA";
state.etiketSecili = new Set();
state.raporAralik = "bu_ay";
state.raporOzel = null;
let etiketEditing = null;

/* ------------------------------------------------------------------ */
/* Code128-B barkod (SVG)                                              */
/* ------------------------------------------------------------------ */

const CODE128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 "
  + "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 "
  + "112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 "
  + "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 "
  + "411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");

/** Metni Code128-B olarak SVG'ye çizer (yalnızca ASCII 32-126). */
function barcodeSvg(text, height = 40) {
  const codes = [104];
  for (const ch of String(text)) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error("Barkodda desteklenmeyen karakter.");
    codes.push(v);
  }
  codes.push(codes.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103, 106);
  let x = 10; // sessiz bölge
  const bars = [];
  for (const code of codes) {
    [...CODE128[code]].forEach((w, i) => { if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`); x += Number(w); });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${height}" preserveAspectRatio="none" class="barcode">${bars.join("")}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Etiket yazdırma                                                     */
/* ------------------------------------------------------------------ */

const LABEL_FORMATS = {
  kelebek: { ad: "Kelebek etiket (72 × 12 mm)", page: "72mm 12mm" },
  genis: { ad: "Geniş etiket (50 × 25 mm)", page: "50mm 25mm" },
  a4: { ad: "A4 sayfa (3 × 8 = 24 etiket)", page: "A4" },
};

function stoneText(t) {
  if (!t.tas_tipi) return "";
  const parts = [STONE_LABEL[t.tas_tipi]];
  if (Number(t.karat)) parts.push(`${formatTurkishNumber(t.karat, 2, 3)} ct`);
  if (t.tas_adet > 1) parts.push(`${t.tas_adet} taş`);
  if (t.renk) parts.push(t.renk);
  if (t.berraklik) parts.push(t.berraklik);
  return parts.join(" ");
}

function labelInner(t, firma) {
  const lines = [
    `<b>${esc(`${t.cinsi} ${t.ayar}`.trim())}</b>${t.model ? ` ${esc(t.model)}` : ""}`,
    t.gram ? `${esc(formatTurkishNumber(t.gram, 2, 3))} gr${Number(t.milyem) ? ` · ${esc(formatTurkishNumber(t.milyem, 0, 3))}` : ""}` : "",
    stoneText(t) ? esc(stoneText(t)) : "",
    Number(t.fiyat) ? `<b>${esc(fmtMoney(t.fiyat))}</b>` : Number(t.iscilik) ? `İşç. ${esc(fmtMoney(t.iscilik))}` : "",
  ].filter(Boolean);
  return { code: `<div class="code">${barcodeSvg(t.barkod)}<span>${esc(t.barkod)}</span></div>`, info: `<div class="info">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`, shop: esc(firma?.ad || "") };
}

async function printLabels(tags, format = "kelebek") {
  if (!tags.length) { showMessage("Yazdırılacak etiket seçin.", true); return; }
  const firma = await loadFirma();
  const f = LABEL_FORMATS[format] || LABEL_FORMATS.kelebek;
  const css = {
    kelebek: `@page { size: 72mm 12mm; margin: 0; } body { margin: 0; } .label { width: 72mm; height: 12mm; display: grid; grid-template-columns: 1fr 1fr; page-break-after: always; overflow: hidden; }
      .code { padding: 0.6mm 1.5mm; display: grid; } .code svg { width: 100%; height: 7mm; } .code span { font-size: 6.5pt; text-align: center; letter-spacing: .5px; }
      .info { padding: 0.6mm 1.5mm; font-size: 6.5pt; line-height: 1.18; } .shop { display: none; }`,
    genis: `@page { size: 50mm 25mm; margin: 0; } body { margin: 0; } .label { width: 50mm; height: 25mm; padding: 1.5mm 2mm; box-sizing: border-box; display: grid; grid-template-rows: auto 1fr auto; page-break-after: always; overflow: hidden; }
      .shop { font-size: 6.5pt; font-weight: bold; text-align: center; } .info { font-size: 7.5pt; line-height: 1.2; } .code svg { width: 100%; height: 6mm; } .code span { display: block; font-size: 6.5pt; text-align: center; }
      .label { grid-template-areas: "shop" "info" "code"; } .code { order: 3; }`,
    a4: `@page { size: A4; margin: 8mm 5mm; } body { margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
      .label { height: 35mm; padding: 2.5mm 4mm; box-sizing: border-box; border: 0.2mm dashed #bbb; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; break-inside: avoid; }
      .shop { font-size: 8pt; font-weight: bold; } .info { font-size: 9pt; line-height: 1.25; } .code svg { width: 100%; height: 9mm; } .code span { display: block; font-size: 8pt; text-align: center; }`,
  }[format];
  const body = tags.map((t) => {
    const p = labelInner(t, firma);
    return format === "kelebek" ? `<div class="label">${p.code}${p.info}</div>` : `<div class="label"><div class="shop">${p.shop}</div>${p.info}${p.code}</div>`;
  }).join("");
  printDocument(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(f.ad)}</title><style>* { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #000; } svg.barcode rect { fill: #000; } ${css}</style></head><body>${body}</body></html>`, "width=900,height=760");
}

function openPrintLabels(tags) {
  const { box, close } = openModal(`${tags.length} etiket yazdır`, "kasa-modal");
  const format = h("select", { name: "format" }, ...Object.entries(LABEL_FORMATS).map(([v, f]) => new Option(f.ad, v)));
  try { format.value = localStorage.getItem("etiketFormat") || "kelebek"; } catch { /* yok */ }
  const preview = h("div", { class: "label-preview" });
  const draw = () => {
    const t = tags[0];
    const p = labelInner(t, firmaCache);
    preview.className = `label-preview ${format.value}`;
    preview.innerHTML = format.value === "kelebek" ? `${p.code}${p.info}` : `<div class="shop">${p.shop}</div>${p.info}${p.code}`;
  };
  format.addEventListener("change", draw);
  loadFirma().then(draw);
  const go = h("button", { type: "button", text: "Yazdır", onclick: () => { try { localStorage.setItem("etiketFormat", format.value); } catch { /* yok */ } close(); printLabels(tags, format.value); } });
  box.append(h("div", { class: "settings-form" }, labeled("Etiket türü", format), h("p", { class: "hint", text: "Önizleme (ilk etiket):" }), preview,
    h("p", { class: "hint", text: "Etiket yazıcısında kağıt boyutunu etiket türüyle aynı seçin. Barkod okuyucu satış ekranındaki barkod kutusuna okutur." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: close }), go)));
  go.focus();
}

/* ------------------------------------------------------------------ */
/* Etiket ekranı                                                       */
/* ------------------------------------------------------------------ */

extraViews.etiket = async () => {
  // Etiketin "satılmadı" olması gerçek stokta olduğu anlamına gelmez; stok alış kayıtlarından gelir.
  const [data, havuz] = await Promise.all([api(`/api/etiket?durum=${state.etiketFilter}`), api("/api/stok/normal/secenekler").catch(() => null)]);
  const stokGram = (r) => (havuz || []).find((o) => normalize(o.cinsi) === normalize(r.cinsi) && normalize(o.ayar) === normalize(r.ayar))?.kalan_gram || 0;
  const root = h("div", { class: "emanet-root etiket-root" });
  const o = data.ozet;
  const tile = (label, value) => h("article", { class: "kasa-total" }, h("span", { text: label }), h("strong", { text: value }));
  root.append(h("div", { class: "kasa-totals" }, tile("Satılmamış etiketli parça", String(o.stokta)), tile("Toplam gram", `${formatValue("gram", o.gram)} gr`),
    tile("Pırlantalı parça", String(o.pirlanta)), tile("Toplam taş", `${formatTurkishNumber(o.karat, 2, 3)} ct`), tile("Etiket fiyatları", fmtMoney(o.fiyat))));
  if (currentUser?.role !== "viewer") root.append(renderEtiketForm());
  root.append(renderTabs([["STOKTA", "SATILMAYANLAR"], ["SATILDI", "SATILANLAR"], ["ALL", "TÜMÜ"]], state.etiketFilter, (v) => { state.etiketFilter = v; state.etiketSecili.clear(); render(); }));
  const rows = filteredRows(data.kayitlar.map((r) => ({ ...r, tas_text: stoneText(r) })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Etiketler" });
  const printSel = h("button", { type: "button", class: "csv-btn", text: "SEÇİLENLERİ YAZDIR", onclick: () => openPrintLabels(rows.filter((r) => state.etiketSecili.has(r.id))) });
  if (rows.length) title.append(printSel, h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("etiketler", [["Barkod", "barkod"], ["Tarih", "tarih"], ["Cinsi", "cinsi"], ["Ayar", "ayar"], ["Model", "model"], ["Gram", "gram"], ["Milyem", "milyem"], ["İşçilik", "iscilik"], ["Fiyat", "fiyat"], ["Taş", "tas_text"], ["Sertifika", "sertifika"], ["Durum", "durum"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Etiket yok. Yukarıdaki formdan parça etiketi oluşturun." }));
  else {
    const writable = currentUser?.role !== "viewer";
    const all = h("input", { type: "checkbox", "aria-label": "Tümünü seç", checked: rows.every((r) => state.etiketSecili.has(r.id)), onchange: () => { rows.forEach((r) => all.checked ? state.etiketSecili.add(r.id) : state.etiketSecili.delete(r.id)); render(); } });
    const table = h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, all), ...["Barkod", "Ürün", "Gram", "Taş / pırlanta", "Fiyat", "Durum", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((r) => body.append(h("tr", { class: r.durum === "SATILDI" ? "row-closed" : "" },
      h("td", {}, h("input", { type: "checkbox", "aria-label": `${r.barkod} seç`, checked: state.etiketSecili.has(r.id), onchange: (e) => { e.target.checked ? state.etiketSecili.add(r.id) : state.etiketSecili.delete(r.id); } })),
      h("td", { dataset: { label: "Barkod" } }, h("span", { class: "barcode-cell", html: barcodeSvg(r.barkod, 26) }), h("small", { class: "cell-sub", text: r.eski_barkod ? `${r.barkod} · eski: ${r.eski_barkod}` : r.barkod })),
      h("td", { dataset: { label: "Ürün" } }, `${r.cinsi} ${r.ayar}`.trim(), h("small", { class: "cell-sub", text: [r.model, r.tarih].filter(Boolean).join(" · ") })),
      h("td", { class: "num", dataset: { label: "Gram" }, text: r.gram ? formatValue("gram", r.gram) : "" }),
      h("td", { dataset: { label: "Taş" } }, r.tas_text, r.sertifika ? h("small", { class: "cell-sub", text: r.sertifika }) : null),
      h("td", { class: "num", dataset: { label: "Fiyat" }, text: r.fiyat ? fmtMoney(r.fiyat) : r.iscilik ? `İşç. ${fmtMoney(r.iscilik)}` : "" }),
      h("td", { dataset: { label: "Durum" } }, h("span", { class: `status-pill ${r.durum === "STOKTA" ? "open" : "closed"}`, text: r.durum === "STOKTA" ? "Satılmadı" : "Satıldı" }),
        r.alis_id ? h("span", { class: "status-pill closed stocked", title: "Alış kaydına bağlı (stokta)", text: "Stoğa alındı" }) : null,
        r.durum === "STOKTA" && havuz && stokGram(r) < Number(r.gram) ? h("span", { class: "status-pill warn", title: `Stokta ${r.cinsi} ${r.ayar}: ${formatValue("gram", stokGram(r))} gr. Satabilmek için önce alışını girin.`, text: "Stokta yok" }) : null),
      h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
        h("button", { type: "button", class: "icon-btn", title: "Etiket yazdır", "aria-label": "Etiket yazdır", html: printIcon(), onclick: () => openPrintLabels([r]) }),
        writable && r.durum === "STOKTA" ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Düzenle", "aria-label": "Düzenle", html: iconSvg("edit"), onclick: () => { etiketEditing = r; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }) : null,
        writable && r.durum === "STOKTA" ? h("button", { type: "button", class: "icon-btn icon-delete", title: "Sil", "aria-label": "Sil", html: iconSvg("delete"), onclick: async () => { if (await showConfirm(`${r.barkod} etiketi silinsin mi`, "Sil", "İptal")) { try { await api(`/api/etiket/${r.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } } }) : null))));
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  return root;
};

function renderEtiketForm() {
  const edit = etiketEditing;
  const panel = h("section", { class: "panel form-panel emanet-form-panel" });
  const form = h("form", { class: "entry-form emanet-form etiket-form" });
  const f = (name, attrs = {}) => h("input", { name, autocomplete: "off", ...attrs });
  const cinsi = f("cinsi", { required: true }); const ayar = f("ayar"); const model = f("model", { maxlength: 60, placeholder: "Örn. TS-104" });
  const gram = decimalInput("gram"); const milyem = decimalInput("milyem"); const iscilik = decimalInput("iscilik"); const fiyat = decimalInput("fiyat", "Boşsa gram üzerinden");
  const kopya = h("input", { name: "kopya", inputmode: "numeric", value: "1" });
  kopya.addEventListener("input", () => { kopya.value = kopya.value.replace(/\D/g, ""); });
  const tasTipi = h("select", { name: "tas_tipi" }, ...Object.entries(STONE_LABEL).map(([v, t]) => new Option(t, v)));
  const tasAdet = h("input", { name: "tas_adet", inputmode: "numeric" });
  const karat = decimalInput("karat", "0,25");
  const renk = h("select", { name: "renk" }, new Option("-", ""), ..."D E F G H I J K L M".split(" ").map((v) => new Option(v, v)));
  const berraklik = h("select", { name: "berraklik" }, new Option("-", ""), ..."IF VVS1 VVS2 VS1 VS2 SI1 SI2 I1 I2 I3".split(" ").map((v) => new Option(v, v)));
  const kesim = f("kesim", { placeholder: "Yuvarlak, prenses…" }); const sertifika = f("sertifika", { placeholder: "GIA / HRD no" }); const notlar = f("notlar", { maxlength: 300 });
  const stoneFields = [labeled("Taş adedi", tasAdet), labeled("Toplam karat", karat), labeled("Renk", renk), labeled("Berraklık", berraklik), labeled("Kesim", kesim), labeled("Sertifika", sertifika)];
  const stoneBox = h("div", { class: "stone-box" }, h("span", { class: "siparis-kapora-title", text: "Taş / pırlanta bilgisi" }), h("div", { class: "stone-grid" }, ...stoneFields));
  form.append(h("div", { class: "sarrafiye-chips" }, h("span", { class: "sarrafiye-label", text: "Her etiket bir parçadır. Barkod otomatik verilir." })),
    labeled("Cinsi", cinsi), labeled("Ayar", ayar), labeled("Model / kod", model), labeled("Gram", gram), labeled("Milyem", milyem), labeled("İşçilik (TL)", iscilik),
    labeled("Etiket fiyatı (TL)", fiyat), labeled("Taş", tasTipi), stoneBox, labeled("Not", notlar), ...(edit ? [] : [labeled("Aynı etiketten kaç adet", kopya)]));
  attachAutocomplete(cinsi, "products");
  const sync = () => { stoneBox.hidden = !tasTipi.value; };
  tasTipi.addEventListener("change", sync);
  if (edit) {
    cinsi.value = edit.cinsi; ayar.value = edit.ayar; model.value = edit.model || ""; gram.value = amountText(edit.gram); milyem.value = amountText(edit.milyem);
    iscilik.value = amountText(edit.iscilik); fiyat.value = amountText(edit.fiyat); tasTipi.value = edit.tas_tipi || ""; tasAdet.value = edit.tas_adet || "";
    karat.value = edit.karat ? String(edit.karat).replace(".", ",") : ""; renk.value = edit.renk || ""; berraklik.value = edit.berraklik || ""; kesim.value = edit.kesim || "";
    sertifika.value = edit.sertifika || ""; notlar.value = edit.notlar || "";
  }
  sync();
  const save = h("button", { type: "submit", text: edit ? "Güncelle" : "Etiket oluştur" });
  const actions = h("div", { class: "form-bottom-actions" }, save);
  if (edit) actions.append(h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { etiketEditing = null; render(); } }));
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    const item = { cinsi: cinsi.value, ayar: ayar.value, model: model.value, gram: String(readAmount(gram.value)), milyem: String(readAmount(milyem.value)), iscilik: String(readAmount(iscilik.value)),
      fiyat: String(readAmount(fiyat.value)), tas_tipi: tasTipi.value, tas_adet: tasTipi.value ? tasAdet.value : "", karat: tasTipi.value ? String(readAmount(karat.value)) : "",
      renk: tasTipi.value ? renk.value : "", berraklik: tasTipi.value ? berraklik.value : "", kesim: tasTipi.value ? kesim.value : "", sertifika: tasTipi.value ? sertifika.value : "", notlar: notlar.value };
    try {
      if (edit) { await api(`/api/etiket/${edit.id}`, { method: "PUT", body: JSON.stringify(item) }); showMessage("Etiket güncellendi."); }
      else {
        const made = await api("/api/etiket", { method: "POST", body: JSON.stringify({ items: [item], kopya: Number(kopya.value || 1) }) });
        showMessage(`${made.length} etiket oluşturuldu.`);
        if (await showConfirm(`${made.length} etiket şimdi yazdırılsın mı`, "Yazdır", "Sonra")) openPrintLabels(made);
      }
      etiketEditing = null; render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(form);
  return panel;
}

/* ------------------------------------------------------------------ */
/* Satış formunda barkod okutma                                        */
/* ------------------------------------------------------------------ */

async function applyBarcode(form, code, status) {
  const tag = await api(`/api/etiket/kod/${encodeURIComponent(code.trim())}`);
  if (tag.durum === "SATILDI") throw new Error(`${tag.barkod} etiketli ürün zaten satılmış.`);
  const options = await api("/api/stok/normal/secenekler");
  const pool = options.find((o) => normalize(o.cinsi) === normalize(tag.cinsi) && normalize(o.ayar) === normalize(tag.ayar));
  if (!pool) throw new Error(`Stokta ${tag.cinsi} ${tag.ayar} yok; önce alışını girin.`);
  state.selectedPurchase = pool;
  form.elements.stoktan.value = "true";
  if (form.elements.purchase_id) form.elements.purchase_id.value = "";
  if (form.elements.alis_id) form.elements.alis_id.value = "";
  form.elements.cinsi.value = pool.cinsi; form.elements.ayar.value = pool.ayar;
  if (tag.gram) form.elements.gram.value = String(tag.gram).replace(".", ",");
  if (form.elements.adet) form.elements.adet.value = "1";
  if (Number(tag.iscilik) && form.elements.iscilik && !form.elements.iscilik.value) form.elements.iscilik.value = String(tag.iscilik).replace(".", ",");
  const extra = [stoneText(tag), tag.sertifika].filter(Boolean).join(" · ");
  if (extra && form.elements.notlar && !form.elements.notlar.value) form.elements.notlar.value = extra;
  let hidden = form.elements.namedItem("etiket_id");
  if (!hidden) { hidden = h("input", { type: "hidden", name: "etiket_id" }); form.append(hidden); }
  hidden.value = tag.barkod;
  const note = form.querySelector(".purchase-actions .purchase-note");
  if (note) showSelectedPurchase(note, pool);
  form.elements.gram.dispatchEvent(new Event("input", { bubbles: true }));
  form._updatePreview?.();
  status.replaceChildren(h("b", { text: tag.barkod }), ` ${tag.cinsi} ${tag.ayar} · ${formatValue("gram", tag.gram)} gr${extra ? ` · ${extra}` : ""}${Number(tag.fiyat) ? ` · Etiket fiyatı ${fmtMoney(tag.fiyat)}` : ""}`);
  status.className = "barcode-status ok";
}

function attachBarcodeScan(form) {
  const input = h("input", { class: "barcode-input", placeholder: "Barkod okutun veya yazın (DT000123) ve Enter'a basın", autocomplete: "off", "aria-label": "Barkod" });
  const status = h("span", { class: "barcode-status" });
  const clear = h("button", { type: "button", class: "secondary", text: "Etiketi kaldır", hidden: true, onclick: () => { form.elements.namedItem("etiket_id")?.remove(); status.textContent = ""; status.className = "barcode-status"; clear.hidden = true; } });
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!input.value.trim()) return;
    try { await applyBarcode(form, input.value, status); clear.hidden = false; input.value = ""; }
    catch (error) { status.textContent = error.message; status.className = "barcode-status err"; input.select(); }
  });
  form.prepend(h("div", { class: "barcode-bar" }, h("span", { class: "barcode-icon", html: barcodeSvg("DT", 18) }), input, clear, status));
}

const renderFormBase = renderForm;
renderForm = function (type, ...args) {
  const node = renderFormBase(type, ...args);
  if (type === "satis") {
    const form = node.matches?.("form") ? node : node.querySelector?.("form");
    if (form) attachBarcodeScan(form);
  }
  return node;
};

/* ------------------------------------------------------------------ */
/* Raporlar                                                            */
/* ------------------------------------------------------------------ */

function rangeOf(key) {
  const today_ = state.serverToday || today();
  const d0 = new Date(`${today_}T12:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const shift = (n) => iso(new Date(d0.getTime() + n * 86400000));
  if (key === "bugun") return [today_, today_];
  if (key === "dun") return [shift(-1), shift(-1)];
  if (key === "bu_hafta") { const wd = (d0.getUTCDay() + 6) % 7; return [shift(-wd), today_]; }
  if (key === "son_30") return [shift(-29), today_];
  if (key === "bu_ay") return [`${today_.slice(0, 8)}01`, today_];
  if (key === "gecen_ay") { const first = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, 1)); const last = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 0)); return [iso(first), iso(last)]; }
  if (key === "bu_yil") return [`${today_.slice(0, 4)}-01-01`, today_];
  return state.raporOzel || [`${today_.slice(0, 8)}01`, today_];
}

function reportTable(title, cols, rows, csvName) {
  const section = h("section", { class: "table-section report-table" });
  const head = h("h2", { text: title });
  if (rows.length && csvName) head.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv(csvName, cols.map(([label, key]) => [label, key]), rows) }));
  section.append(head);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Bu aralıkta kayıt yok." }));
  else {
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...cols.map(([label, , kind]) => h("th", { class: kind ? "num" : "", text: label })))));
    const body = h("tbody");
    rows.forEach((r) => body.append(h("tr", {}, ...cols.map(([label, key, kind]) => {
      const v = r[key];
      const text = v === null || v === undefined ? "" : kind === "tl" ? fmtMoney(v) : kind === "cur" ? fmtMoney(v, r.para_birimi || r.doviz) : kind === "kur" ? (v ? formatTurkishNumber(v, 2, 4) : "") : kind === "has" ? formatValue("has", v) : kind === "gram" ? formatValue("gram", v) : kind === "int" ? String(v ?? "") : String(v ?? "");
      return h("td", { class: `${kind ? "num" : ""} ${kind === "tl" && Number(v) < 0 ? "neg" : ""}`, dataset: { label }, text });
    }))));
    table.append(body); wrap.append(table);
  }
  section.append(wrap);
  return section;
}

function reportChart(days) {
  const wrap = h("section", { class: "dashboard-panel week-chart report-chart" }, h("div", { class: "dashboard-panel-head" }, h("h2", { text: "Günlük seyir" }), h("p", { text: "Satış ve alış (TL), kâr üstte" })));
  if (!days.length) { wrap.append(h("div", { class: "empty", text: "Bu aralıkta işlem yok." })); return wrap; }
  const max = Math.max(1, ...days.map((d) => Math.max(d.satis_tl, d.alis_tl)));
  const pct = (v) => `${Math.max(v, 0) / max * 100}%`;
  const short = (v) => Math.abs(v) >= 1e6 ? `${formatTurkishNumber(v / 1e6, 0, 1)} mn` : Math.abs(v) >= 1e3 ? `${formatTurkishNumber(v / 1e3, 0, 1)} b` : formatTurkishNumber(v, 0, 0);
  const bars = h("div", { class: "chart-bars", role: "img", "aria-label": "Günlük satış, alış ve kâr grafiği" });
  days.slice(-31).forEach((d) => bars.append(h("div", { class: "chart-day", title: `${trDate(d.tarih)}\nSatış ${fmtMoney(d.satis_tl)}\nAlış ${fmtMoney(d.alis_tl)}\nKâr ${fmtMoney(d.kar_tl)}` },
    h("span", { class: `chart-kar ${d.kar_tl < 0 ? "neg" : ""}`, text: d.kar_tl ? short(d.kar_tl) : "" }),
    h("div", { class: "chart-cols" }, h("i", { class: "bar-alis", style: `height:${pct(d.alis_tl)}` }), h("i", { class: "bar-satis", style: `height:${pct(d.satis_tl)}` })),
    h("span", { class: "chart-label", text: new Date(`${d.tarih}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) }))));
  wrap.append(bars, h("div", { class: "chart-foot" }, h("div", { class: "chart-legend" }, h("span", { class: "lg-satis", text: "Satış" }), h("span", { class: "lg-alis", text: "Alış" }), h("span", { class: "lg-kar", text: "Kâr" })),
    days.length > 31 ? h("span", { text: "Son 31 gün gösteriliyor" }) : null));
  return wrap;
}

extraViews.rapor = async () => {
  const [start, end] = rangeOf(state.raporAralik);
  const r = await api(`/api/rapor?baslangic=${start}&bitis=${end}`);
  const root = h("div", { class: "kasa-root rapor-root" });
  const presets = [["bugun", "Bugün"], ["dun", "Dün"], ["bu_hafta", "Bu hafta"], ["bu_ay", "Bu ay"], ["gecen_ay", "Geçen ay"], ["son_30", "Son 30 gün"], ["bu_yil", "Bu yıl"], ["ozel", "Özel"]];
  const from = h("input", { type: "date", value: start }); const to = h("input", { type: "date", value: end });
  const applyCustom = () => { if (from.value && to.value) { state.raporOzel = [from.value, to.value]; state.raporAralik = "ozel"; render(); } };
  from.addEventListener("change", applyCustom); to.addEventListener("change", applyCustom);
  root.append(h("div", { class: "kasa-toolbar no-print" },
    renderTabs(presets, state.raporAralik, (v) => { state.raporAralik = v; if (v === "ozel") state.raporOzel = [start, end]; render(); }),
    h("div", { class: "kasa-day" }, from, h("span", { text: "–" }), to, h("button", { type: "button", class: "secondary", text: "Yazdır", onclick: () => window.print() }))));
  root.append(h("p", { class: "report-range", text: `${new Date(`${start}T12:00:00`).toLocaleDateString("tr-TR")} – ${new Date(`${end}T12:00:00`).toLocaleDateString("tr-TR")} arası` }));
  const o = r.ozet;
  const price = state.price?.satis || 0;
  const tile = (label, value, note = "", tone = "") => h("article", { class: `today-tile ${tone}` }, h("span", { text: label }), h("strong", { text: value }), note ? h("small", { text: note }) : null);
  root.append(h("div", { class: "today-tiles report-tiles" },
    tile("Satış cirosu", fmtMoney(o.satis_tl + o.hurda_satis_tl), `${o.satis_islem} satış${o.hurda_satis_islem ? ` + ${o.hurda_satis_islem} hurda satış` : ""} · ort. sepet ${fmtMoney(o.ortalama_sepet_tl)}`, "gold"),
    tile("Brüt kâr", fmtMoney(o.brut_kar_tl + o.hurda_kar_tl), `Milyem kârı ${formatValue("has", o.milyem_kari_has)} has`, "green"),
    tile("Satılan", `${formatValue("gram", o.satis_gram)} gr`, `${formatValue("has", o.satis_has)} has${o.satis_adet ? ` · ${formatTurkishNumber(o.satis_adet)} adet` : ""}${o.hurda_satis_gram ? ` · hurda ${formatValue("gram", o.hurda_satis_gram)} gr` : ""}`),
    tile("Alış", fmtMoney(o.alis_tl + o.hurda_alis_tl), `${formatValue("gram", o.alis_gram)} gr · ${o.alis_islem} alış${o.hurda_alis_gram ? ` · hurda ${formatValue("gram", o.hurda_alis_gram)} gr` : ""}`),
    tile("Giderler", `${formatValue("has", o.gider_has)} has`, price ? `≈ ${fmtMoney(o.gider_has * price)}` : "")));
  // Döviz: alış-satış hacmi ve gerçekleşen kâr (ortalama maliyetle), eldeki dövizin değerleme farkı ayrı.
  const dv = r.doviz || [];
  const dovizKar = dv.reduce((t, x) => t + x.kar_tl, 0);
  if (dv.length) root.lastChild.append(tile("Döviz kârı (gerçekleşen)", fmtMoney(dovizKar), dv.map((x) => `${x.doviz}: alış ${fmtMoney(x.alis_miktar, x.doviz)} · satış ${fmtMoney(x.satis_miktar, x.doviz)}${x.transfer_giris ? ` · transferle giren ${fmtMoney(x.transfer_giris, x.doviz)}` : ""}`).join(" · "), dovizKar < 0 ? "" : "green"));
  // POS komisyonu kâr değildir: brüt kâr ve döviz kârından düşülerek net kâr gösterilir.
  const komisyon = o.komisyon_tl || 0;
  if (komisyon || dv.length) {
    const net = Math.round((o.brut_kar_tl + o.hurda_kar_tl + dovizKar - komisyon) * 100) / 100;
    root.lastChild.append(tile("POS komisyonu", fmtMoney(-komisyon), "Bankanın kestiği tutar; kâra dahil değil"),
      tile("Net kâr", fmtMoney(net), `Brüt kâr${dv.length ? " + döviz kârı" : ""} − POS komisyonu · giderler hariç`, net < 0 ? "" : "green"));
  }
  root.append(reportChart(r.gunler));
  const grid = h("div", { class: "report-grid" });
  const dovizValuation = h("div");
  const wide = (section) => { section.classList.add("report-wide"); return section; };
  api("/api/doviz/ozet").then((z) => {
    const rows = z.stok.map((x) => {
      const kur = state.kurlar?.[x.doviz]?.alis || 0;
      const deger = kur ? Math.round(x.toplam * kur * 100) / 100 : null;
      return { doviz: x.doviz, para_birimi: x.doviz, bakiye: x.toplam, ortalama: x.ortalama_maliyet, maliyet: x.maliyet_tl, kur, deger, fark: kur && x.ortalama_maliyet ? Math.round((deger - x.maliyet_tl) * 100) / 100 : null };
    });
    dovizValuation.replaceWith(wide(reportTable("Eldeki döviz ve değerleme farkı (bugün, satılmadığı için kâra katılmaz)", [["Döviz", "doviz"], ["Kasadaki", "bakiye", "cur"], ["Ort. maliyet", "ortalama", "kur"],
      ["Maliyet TL", "maliyet", "tl"], ["Güncel alış kuru", "kur", "kur"], ["Güncel değer", "deger", "tl"], ["Değerleme farkı", "fark", "tl"]], rows, "rapor_doviz_deger")));
  }).catch(() => dovizValuation.remove());
  grid.append(
    reportTable("Ürün bazında satış", [["Ürün", "ad"], ["Ayar", "ayar"], ["İşlem", "islem", "int"], ["Gram", "gram", "gram"], ["Has", "has", "has"], ["Ciro", "tutar", "tl"], ["Kâr", "kar", "tl"]], r.urunler, "rapor_urun"),
    reportTable("En çok alan müşteriler", [["Müşteri", "ad"], ["İşlem", "islem", "int"], ["Gram", "gram", "gram"], ["Ciro", "tutar", "tl"], ["Kâr", "kar", "tl"]], r.musteriler, "rapor_musteri"),
    reportTable("Tedarikçilerden alış", [["Tedarikçi", "ad"], ["İşlem", "islem", "int"], ["Gram", "gram", "gram"], ["Has", "has", "has"], ["Tutar", "tutar", "tl"]], r.tedarikciler, "rapor_tedarikci"),
    reportTable("Personel satışları", [["Personel", "ad"], ["Satış", "islem", "int"], ["Gram", "gram", "gram"], ["Ciro", "tutar", "tl"], ["Kâr", "kar", "tl"]], r.personel, "rapor_personel"),
    reportTable("Kasa hareketleri", [["Tür", "kategori_text"], ["Para", "para_birimi"], ["İşlem", "islem", "int"], ["Giriş", "giris", "cur"], ["Çıkış", "cikis", "cur"], ["Komisyon", "komisyon", "cur"]],
      r.kasa.map((k) => ({ ...k, kategori_text: KASA_CATEGORY_LABEL[k.kategori] || k.kategori })), "rapor_kasa"),
    reportTable(`POS komisyonları${r.komisyon?.length ? ` · toplam ${fmtMoney(o.komisyon_tl)}` : ""}`, [["Tarih", "tarih_text"], ["Hesap", "hesap"], ["Kaynak", "kategori_text"], ["İşlem", "islem", "int"], ["Çekilen", "tutar", "cur"], ["Komisyon", "komisyon", "cur"], ["Hesaba geçen", "net", "cur"]],
      (r.komisyon || []).map((k) => ({ ...k, tarih_text: trDate(k.tarih), kategori_text: KASA_CATEGORY_LABEL[k.kategori] || k.kategori })), "rapor_komisyon"),
    wide(reportTable("Döviz alış / satış", [["Döviz", "doviz"], ["İşlem", "islem", "int"], ["Alınan", "alis_miktar", "cur"], ["Alış TL", "alis_tl", "tl"], ["Ort. alış kuru", "alis_kur", "kur"],
      ["Satılan", "satis_miktar", "cur"], ["Satış TL", "satis_tl", "tl"], ["Ort. satış kuru", "satis_kur", "kur"], ["Gerçekleşen kâr", "kar_tl", "tl"], ["İptal", "iptal", "int"],
      ["Transferle giren", "transfer_giris", "cur"], ["Transfer kuru", "transfer_kur", "kur"], ["Transferle çıkan", "transfer_cikis", "cur"]],
      dv.map((x) => ({ ...x, alis_kur: x.alis_miktar ? x.alis_tl / x.alis_miktar : 0, satis_kur: x.satis_miktar ? x.satis_tl / x.satis_miktar : 0, transfer_kur: x.transfer_giris ? x.transfer_giris_tl / x.transfer_giris : 0 })), "rapor_doviz")),
    dovizValuation,
    reportTable("Giderler", [["Kategori", "kategori"], ["Has", "has", "has"]], r.giderler, "rapor_gider"),
    reportTable("Cari yaşlandırma (bugüne göre)", [["Son işlemden beri", "ad"], ["Bize borçlu", "alacak_sayi", "int"], ["Alacak has", "alacak_has", "has"], ["Borçlu olduğumuz", "borc_sayi", "int"], ["Borç has", "borc_has", "has"]], r.yaslandirma, "rapor_yaslandirma"),
    reportTable(`Stok değeri${price ? ` (has ${fmtMoney(price)})` : ""}`, [["Stok", "tur"], ["Ürün", "cinsi"], ["Ayar", "ayar"], ["Gram", "kalan_gram", "gram"], ["Has", "kalan_has", "has"], ["Maliyet", "maliyet", "tl"], ["Güncel değer", "deger", "tl"]],
      r.stok.map((s) => ({ ...s, deger: price ? Math.round(s.kalan_has * price * 100) / 100 : null })), "rapor_stok"));
  root.append(grid);
  return root;
};
