/*
 * Stok sayımı: ürünler barkod okuyucuyla (ya da elle) sayılır. Bizim etiketler
 * (DT…) ve eski / farklı firma etiketleri okunur; kayıtlı olmayan barkod için
 * ürün bilgisi sorulur, eski barkod saklanır. Açılış sayımı bitince sayılanlar
 * "AÇILIŞ STOĞU" alışıyla stoğa girer; kontrol sayımı yalnızca farkı gösterir.
 * modules.js / rapor.js yardımcılarını kullanır.
 */

Object.assign(views, {
  sayim: { title: "Stok Sayımı", subtitle: "Barkod okutarak açılış ya da kontrol sayımı" },
});
state.sayimId = null;
state.sayimYeniTur = "ACILIS";
state.sayimMesaj = null;
state.sayimForm = null; // kayıtlı olmayan ürün formu: { eski_barkod }

const SAYIM_TUR = { ACILIS: "Açılış sayımı", KONTROL: "Kontrol sayımı" };
const sayimHas = (v) => formatTurkishNumber(v, 2, 3);
const sayimGram = (v) => formatTurkishNumber(v, 2, 2);

extraViews.sayim = async () => {
  const root = h("div", { class: "kasa-root rapor-root sayim-root" });
  if (state.sayimId) {
    try { root.append(await renderSayim(await api(`/api/sayim/${state.sayimId}`))); return root; }
    catch (error) { state.sayimId = null; showMessage(error.message, true); }
  }
  const writable = currentUser?.role !== "viewer";
  if (writable) root.append(renderSayimStart());
  const list = await api("/api/sayim");
  const section = h("section", { class: "table-section" }, h("h2", { text: "Sayımlar" }));
  const wrap = h("div", { class: "table-wrap" });
  if (!list.length) wrap.append(h("div", { class: "empty", text: "Henüz sayım yok. Yukarıdan bir sayım başlatın." }));
  else {
    const body = h("tbody");
    list.forEach((s) => body.append(h("tr", {},
      h("td", { dataset: { label: "No" }, text: `#${s.id}` }),
      h("td", { dataset: { label: "Tarih" }, text: trDate(s.tarih) }),
      h("td", { dataset: { label: "Tür" }, text: SAYIM_TUR[s.tur] }),
      h("td", { dataset: { label: "Durum" } }, h("span", { class: `status-pill ${s.durum === "ACIK" ? "open" : "closed"}`, text: s.durum === "ACIK" ? "Devam ediyor" : "Bitti" })),
      h("td", { class: "num", dataset: { label: "Parça" }, text: String(s.adet) }),
      h("td", { class: "num", dataset: { label: "Gram" }, text: sayimGram(s.gram) }),
      h("td", { dataset: { label: "Not" }, text: s.notlar || "" }),
      h("td", { class: "actions-cell", dataset: { label: "" } }, h("button", { type: "button", class: "secondary", text: s.durum === "ACIK" ? "Devam et" : "Aç", onclick: () => { state.sayimId = s.id; state.sayimMesaj = null; state.sayimForm = null; render(); } })))));
    wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ...["No", "Tarih", "Tür", "Durum", "Parça", "Gram", "Not", ""].map((t) => h("th", { text: t })))), body));
  }
  section.append(wrap); root.append(section);
  return root;
};

function renderSayimStart() {
  const panel = h("section", { class: "panel form-panel emanet-form-panel" });
  const tur = state.sayimYeniTur;
  const form = h("form", { class: "entry-form emanet-form" });
  const tarih = h("input", { type: "date", name: "tarih", value: state.serverToday || today() });
  const fiyat = decimalInput("has_fiyati", "Günün alış fiyatı");
  if (state.price?.alis) fiyat.value = String(state.price.alis).replace(".", ",");
  const notlar = h("input", { name: "notlar", maxlength: 300, autocomplete: "off" });
  const info = tur === "ACILIS"
    ? "Programa geçerken eldeki ürünleri sayın. Sayım bitince sayılan her parça \"AÇILIŞ STOĞU\" adına ödemesi kapalı bir alışla, bu maliyet has fiyatından stoğa girer. Cari ve kasa değişmez. Daha önce stoğa girmiş etiketler tekrar girmez."
    : "Stoğa dokunmaz. Sayılan gram ve has sistemdeki stokla karşılaştırılır, sayılmayan etiketler listelenir.";
  form.append(
    h("div", { class: "sarrafiye-chips" }, renderTabs([["ACILIS", "AÇILIŞ SAYIMI"], ["KONTROL", "KONTROL SAYIMI"]], tur, (v) => { state.sayimYeniTur = v; render(); })),
    h("p", { class: "report-range sayim-info", text: info }),
    labeled("Tarih", tarih), ...(tur === "ACILIS" ? [labeled("Maliyet has fiyatı (TL/gr)", fiyat)] : []), labeled("Not", notlar));
  const start = h("button", { type: "submit", text: "Sayımı başlat" });
  form.append(h("div", { class: "form-bottom-actions" }, start));
  form.onsubmit = async (event) => {
    event.preventDefault(); start.disabled = true;
    try {
      const s = await api("/api/sayim", { method: "POST", body: JSON.stringify({ tur, tarih: tarih.value, has_fiyati: tur === "ACILIS" ? String(readAmount(fiyat.value)) : "0", notlar: notlar.value }) });
      state.sayimId = s.id; state.sayimMesaj = null; state.sayimForm = null; render();
    } catch (error) { showMessage(error.message, true); start.disabled = false; }
  };
  panel.append(h("h2", { text: "Yeni sayım" }), form);
  return panel;
}

async function renderSayim(s) {
  const open = s.durum === "ACIK" && currentUser?.role !== "viewer";
  const acilis = s.tur === "ACILIS";
  const box = h("div", { class: "sayim-doc" });
  const back = h("button", { type: "button", class: "secondary", text: "← Sayımlar", onclick: () => { state.sayimId = null; render(); } });
  box.append(h("div", { class: "kasa-toolbar no-print" }, back,
    h("div", { class: "kasa-day" }, h("strong", { text: `${SAYIM_TUR[s.tur]} #${s.id}` }), h("span", { text: `${trDate(s.tarih)}${s.notlar ? ` · ${s.notlar}` : ""}` }),
      h("span", { class: `status-pill ${s.durum === "ACIK" ? "open" : "closed"}`, text: s.durum === "ACIK" ? "Devam ediyor" : "Bitti" }))));

  if (open) {
    // Barkod okutma: okuyucu metni yazıp Enter gönderir.
    const input = h("input", { class: "barcode-input", placeholder: "Barkodu okutun (bizim ya da eski / farklı firma etiketi) ve Enter", autocomplete: "off", "aria-label": "Barkod" });
    const status = h("span", { class: `barcode-status ${state.sayimMesaj ? (state.sayimMesaj.ok ? "ok" : "err") : ""}`, text: state.sayimMesaj?.text || "" });
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const kod = input.value.trim();
      if (!kod) return;
      input.disabled = true;
      try {
        const r = await api(`/api/sayim/${s.id}/okut`, { method: "POST", body: JSON.stringify({ kod }) });
        if (r.yeni) { state.sayimForm = { eski_barkod: kod }; state.sayimMesaj = { ok: false, text: `${kod} kayıtlı değil. Ürün bilgisini girin.` }; }
        else { state.sayimForm = null; state.sayimMesaj = { ok: true, text: `${r.etiket.barkod}${r.etiket.eski_barkod ? ` (${r.etiket.eski_barkod})` : ""} ${r.etiket.cinsi} ${r.etiket.ayar} · ${sayimGram(r.etiket.gram)} gr sayıldı${acilis && r.etiket.alis_id ? " (zaten stokta)" : ""}.` }; }
      } catch (error) { state.sayimMesaj = { ok: false, text: error.message }; }
      render();
    });
    const manual = h("button", { type: "button", class: "secondary", text: "Barkodsuz ürün ekle", onclick: () => { state.sayimForm = { eski_barkod: "" }; state.sayimMesaj = null; render(); } });
    box.append(h("div", { class: "barcode-bar sayim-scan no-print" }, h("span", { class: "barcode-icon", html: barcodeSvg("DT", 18) }), input, manual, status));
    if (state.sayimForm) box.append(renderSayimItemForm(s));
    else setTimeout(() => input.focus(), 0);
    if (acilis) box.append(renderSayimPrice(s));
  }

  const t = s.toplam;
  const tile = (label, value) => h("article", { class: "today-tile" }, h("span", { text: label }), h("strong", { text: value }));
  const tiles = h("div", { class: "today-tiles report-tiles" }, tile("Sayılan parça", String(t.adet)), tile("Toplam gram", `${sayimGram(t.gram)} gr`), tile("Toplam has", `${sayimHas(t.has)} has`));
  if (acilis) tiles.append(tile(s.durum === "ACIK" ? "Stoğa girecek" : "Maliyet has fiyatı", s.durum === "ACIK" ? `${t.stoga_girecek} parça` : fmtMoney(s.has_fiyati)));
  box.append(tiles);

  if (s.ozet.length) box.append(sayimTable("Ürün bazında", [["Ürün", (r) => `${r.cinsi} ${r.ayar}`.trim()], ["Parça", "adet", "num"], ["Gram", (r) => sayimGram(r.gram), "num"], ["Has", (r) => sayimHas(r.has), "num"]], s.ozet, `sayim_${s.id}_ozet`));

  if (s.karsilastirma) {
    const fark = (v, fmt) => (Number(v) ? `${Number(v) > 0 ? "+" : "−"}${fmt(Math.abs(Number(v)))}` : "0");
    box.append(sayimTable("Sistem stoğu ile karşılaştırma", [["Ürün", (r) => `${r.cinsi} ${r.ayar}`.trim()],
      ["Sistemde gram", (r) => sayimGram(r.sistem_gram), "num"], ["Sayılan gram", (r) => sayimGram(r.sayilan_gram), "num"], ["Fark gram", (r) => fark(r.fark_gram, sayimGram), "num strong", (r) => (r.fark_gram < 0 ? "neg" : r.fark_gram > 0 ? "pos" : "")],
      ["Sistemde has", (r) => sayimHas(r.sistem_has), "num"], ["Sayılan has", (r) => sayimHas(r.sayilan_has), "num"], ["Fark has", (r) => fark(r.fark_has, sayimHas), "num strong", (r) => (r.fark_has < 0 ? "neg" : r.fark_has > 0 ? "pos" : "")]],
    s.karsilastirma, `sayim_${s.id}_fark`, "Eksi: sistemde olup sayılmayan, artı: sayılıp sistemde olmayan. Etiketsiz (gram olarak tutulan) stok da sistem tarafında yer alır."));
    if (s.sayilmayan.length) box.append(sayimTable(`Sayılmayan etiketler (${s.sayilmayan.length})`, [["Barkod", (r) => r.eski_barkod ? `${r.barkod} · ${r.eski_barkod}` : r.barkod], ["Ürün", (r) => `${r.cinsi} ${r.ayar}`.trim()], ["Model", "model"], ["Gram", (r) => sayimGram(r.gram), "num"]], s.sayilmayan, `sayim_${s.id}_sayilmayan`));
  }

  const itemCols = [["Barkod", (r) => r.barkod, "", null, (r) => r.eski_barkod ? `eski: ${r.eski_barkod}` : ""], ["Ürün", (r) => `${r.cinsi} ${r.ayar}`.trim(), "", null, (r) => r.model || ""],
    ["Gram", (r) => sayimGram(r.gram), "num"], ["Milyem", (r) => (r.milyem ? formatTurkishNumber(r.milyem, 0, 2) : ""), "num"], ["Has", (r) => sayimHas(r.has), "num"]];
  if (acilis) itemCols.push(["Stok", (r) => (r.durum === "SATILDI" ? "Satıldı" : r.stokta ? (s.durum === "ACIK" ? "Zaten stokta" : "Stoğa alındı") : "Stoğa girecek")]);
  const table = sayimTable(`Sayılan ürünler (${s.kalemler.length})`, itemCols, s.kalemler, `sayim_${s.id}`, "", open ? (r) => h("button", { type: "button", class: "icon-btn icon-delete", title: "Okutmayı geri al", "aria-label": "Okutmayı geri al", html: iconSvg("delete"), onclick: async () => {
    try { await api(`/api/sayim/${s.id}/kalem/${r.kalem_id}`, { method: "DELETE" }); state.sayimMesaj = { ok: true, text: `${r.barkod} sayımdan çıkarıldı.` }; render(); } catch (error) { showMessage(error.message, true); }
  } }) : null);
  box.append(table);

  const actions = h("div", { class: "form-bottom-actions no-print" }, h("button", { type: "button", class: "secondary", text: "Yazdır", onclick: () => window.print() }));
  if (open) {
    actions.prepend(
      h("button", { type: "button", text: acilis ? "Sayımı bitir ve stoğa al" : "Sayımı bitir", onclick: async () => {
        const msg = acilis
          ? `${t.stoga_girecek} parça "AÇILIŞ STOĞU" alışıyla ${fmtMoney(s.has_fiyati)} has fiyatından stoğa girecek. Cari ve kasa değişmez. Sayım bitince değiştirilemez. Devam edilsin mi?`
          : "Sayım bitince değiştirilemez. Devam edilsin mi?";
        if (!(await showConfirm(msg, "Bitir", "Vazgeç"))) return;
        try { const r = await api(`/api/sayim/${s.id}/bitir`, { method: "POST" }); showMessage(r.stoga_alinan ? `Sayım bitti; ${r.stoga_alinan} parça stoğa alındı.` : "Sayım bitti."); state.sayimMesaj = null; render(); }
        catch (error) { showMessage(error.message, true); }
      } }),
      h("button", { type: "button", class: "secondary", text: "Sayımı iptal et", onclick: async () => {
        if (!(await showConfirm("Sayım ve bu sayımda eklenen etiketler silinsin mi?", "Sil", "Vazgeç"))) return;
        try { await api(`/api/sayim/${s.id}`, { method: "DELETE" }); state.sayimId = null; render(); } catch (error) { showMessage(error.message, true); }
      } }));
  }
  box.append(actions);
  return box;
}

/** Açılış sayımının maliyet has fiyatı; sayım sürerken değiştirilebilir. */
function renderSayimPrice(s) {
  const input = decimalInput("has_fiyati", "Günün alış fiyatı");
  if (Number(s.has_fiyati)) input.value = String(s.has_fiyati).replace(".", ",");
  input.addEventListener("change", async () => {
    try { await api(`/api/sayim/${s.id}`, { method: "PUT", body: JSON.stringify({ has_fiyati: String(readAmount(input.value)) }) }); showMessage("Maliyet has fiyatı kaydedildi."); }
    catch (error) { showMessage(error.message, true); }
  });
  return h("div", { class: "kasa-day sayim-price no-print" }, labeled("Maliyet has fiyatı (TL/gr)", input),
    h("small", { class: "hint", text: "Sayım bitince stoğa girecek parçaların maliyeti: has × bu fiyat." }));
}

/** Kayıtlı olmayan ürün: eski / farklı firma barkodu ya da barkodsuz parça. */
function renderSayimItemForm(s) {
  const panel = h("section", { class: "panel form-panel emanet-form-panel no-print" });
  const form = h("form", { class: "entry-form emanet-form" });
  const f = (name, attrs = {}) => h("input", { name, autocomplete: "off", ...attrs });
  const eski = f("eski_barkod", { value: state.sayimForm.eski_barkod || "", placeholder: "Boşsa barkodsuz" });
  const cinsi = f("cinsi", { required: true }); const ayar = f("ayar"); const model = f("model", { maxlength: 60 });
  const gram = decimalInput("gram"); const milyem = decimalInput("milyem"); const iscilik = decimalInput("iscilik");
  let printRemembered = false;
  try { printRemembered = localStorage.getItem("sayimEtiketBas") === "1"; } catch { /* varsayılan kapalı */ }
  const bas = h("input", { type: "checkbox", checked: printRemembered });
  form.append(labeled("Eski barkod", eski), labeled("Cinsi", cinsi), labeled("Ayar", ayar), labeled("Model / kod", model), labeled("Gram", gram), labeled("Milyem", milyem), labeled("İşçilik (TL)", iscilik),
    h("label", { class: "check-field sayim-print" }, bas, " Bizim etiketi de yazdır"));
  attachAutocomplete(cinsi, "products");
  const save = h("button", { type: "submit", text: "Sayıma ekle" });
  form.append(h("div", { class: "form-bottom-actions" }, save, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: () => { state.sayimForm = null; state.sayimMesaj = null; render(); } })));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try { localStorage.setItem("sayimEtiketBas", bas.checked ? "1" : "0"); } catch { /* yalnız bu oturum */ }
    try {
      const r = await api(`/api/sayim/${s.id}/kalem`, { method: "POST", body: JSON.stringify({ eski_barkod: eski.value, cinsi: cinsi.value, ayar: ayar.value, model: model.value,
        gram: String(readAmount(gram.value)), milyem: String(readAmount(milyem.value)), iscilik: String(readAmount(iscilik.value)) }) });
      state.sayimForm = null;
      state.sayimMesaj = { ok: true, text: `${r.etiket.barkod}${r.etiket.eski_barkod ? ` (${r.etiket.eski_barkod})` : ""} ${r.etiket.cinsi} ${r.etiket.ayar} sayıma eklendi.` };
      render();
      if (bas.checked) openPrintLabels([r.etiket]);
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(h("h2", { text: state.sayimForm.eski_barkod ? `Kayıtlı olmayan barkod: ${state.sayimForm.eski_barkod}` : "Barkodsuz ürün" }),
    h("p", { class: "report-range", text: "Eski barkod saklanır; satışta bu barkod okutulunca da ürün bulunur. Bizim etiketi yapıştırmak isterseniz yazdırın." }), form);
  setTimeout(() => (state.sayimForm.eski_barkod ? cinsi : eski).focus(), 0);
  return panel;
}

/** cols: [başlık, alan|fn, sınıf, hücre sınıfı fn, alt satır fn] */
function sayimTable(title, cols, rows, csvName, note = "", action = null) {
  const cell = (r, get) => (typeof get === "function" ? get(r) : r[get] ?? "");
  const section = h("section", { class: "table-section" });
  const head = h("h2", { text: title });
  if (rows.length) head.append(h("button", { type: "button", class: "csv-btn no-print", text: "CSV", onclick: () => downloadCsv(csvName, cols.map(([label]) => [label, label]), rows.map((r) => Object.fromEntries(cols.map(([label, get]) => [label, cell(r, get)])))) }));
  section.append(head);
  if (note) section.append(h("p", { class: "report-range", text: note }));
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Henüz ürün okutulmadı." }));
  else {
    const body = h("tbody");
    rows.forEach((r) => body.append(h("tr", {}, ...cols.map(([label, get, cls, clsFn, sub]) => {
      const subText = sub ? sub(r) : "";
      return h("td", { class: `${cls || ""} ${clsFn ? clsFn(r) : ""}`.trim(), dataset: { label } }, String(cell(r, get)), subText ? h("small", { class: "cell-sub", text: subText }) : null);
    }), ...(action ? [h("td", { class: "actions-cell", dataset: { label: "" } }, action(r))] : []))));
    wrap.append(h("table", {}, h("thead", {}, h("tr", {}, ...cols.map(([label, , cls]) => h("th", { class: cls || "", text: label })), ...(action ? [h("th", { text: "" })] : []))), body));
  }
  section.append(wrap);
  return section;
}
