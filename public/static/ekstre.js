/*
 * Ekstreler: cari hesap, stok hareket ve kasa ekstresi. Tarih aralığı seçilir;
 * devir, hareketler ve yürüyen bakiye gösterilir, yazdırılır ya da CSV alınır.
 * modules.js / rapor.js yardımcılarını kullanır.
 */

Object.assign(views, {
  ekstre: { title: "Ekstreler", subtitle: "Cari hesap, stok hareket ve kasa ekstresi" },
});
state.ekstreTur = "cari";
state.ekstreAralik = "bu_ay";
state.ekstreOzel = null;
state.ekstreSecim = { cari: "", stok: "", stokTur: "normal", kasa: "" };

function ekstreRange() {
  if (state.ekstreAralik !== "ozel") return rangeOf(state.ekstreAralik);
  return state.ekstreOzel || rangeOf("bu_ay");
}

// İşaretli tutar: artı/eksi işaretiyle, sıfırsa boş.
const signed = (v, fmt) => (Number(v) ? `${Number(v) > 0 ? "+" : "−"}${fmt(Math.abs(Number(v)))}` : "");
const hasText = (v) => formatTurkishNumber(v, 2, 3);
const gramText = (v) => formatTurkishNumber(v, 2, 2);

extraViews.ekstre = async () => {
  const root = h("div", { class: "kasa-root rapor-root ekstre-root" });
  const [start, end] = ekstreRange();
  const presets = [["bu_ay", "Bu ay"], ["gecen_ay", "Geçen ay"], ["son_30", "Son 30 gün"], ["bu_yil", "Bu yıl"], ["ozel", "Özel"]];
  const from = h("input", { type: "date", value: start }); const to = h("input", { type: "date", value: end });
  const applyCustom = () => { if (from.value && to.value) { state.ekstreOzel = [from.value, to.value]; state.ekstreAralik = "ozel"; render(); } };
  from.addEventListener("change", applyCustom); to.addEventListener("change", applyCustom);

  const sel = state.ekstreSecim;
  const picker = h("div", { class: "kasa-day ekstre-picker" });
  let load;
  if (state.ekstreTur === "cari") {
    const list = await api("/api/ekstre/cariler");
    if (!sel.cari && list.length) sel.cari = list[0].isim;
    const select = h("select", { "aria-label": "Cari" }, ...list.map((r) => new Option(r.isim, r.isim, false, r.isim === sel.cari)));
    select.onchange = () => { sel.cari = select.value; render(); };
    picker.append(h("label", { class: "field" }, "Cari", select));
    if (sel.cari) load = () => api(`/api/ekstre/cari?isim=${encodeURIComponent(sel.cari)}&baslangic=${start}&bitis=${end}`);
  } else if (state.ekstreTur === "stok") {
    const list = await api(`/api/ekstre/urunler?tur=${sel.stokTur}`);
    const key = (r) => `${r.cinsi}|${r.ayar}`;
    if (!list.some((r) => key(r) === sel.stok)) sel.stok = list[0] ? key(list[0]) : "";
    const tur = h("select", { "aria-label": "Stok türü" }, new Option("Normal stok", "normal", false, sel.stokTur === "normal"), new Option("Hurda stok", "hurda", false, sel.stokTur === "hurda"));
    tur.onchange = () => { sel.stokTur = tur.value; sel.stok = ""; render(); };
    const select = h("select", { "aria-label": "Ürün" }, ...list.map((r) => new Option(`${r.cinsi} ${r.ayar}`.trim(), key(r), false, key(r) === sel.stok)));
    select.onchange = () => { sel.stok = select.value; render(); };
    picker.append(h("label", { class: "field" }, "Stok", tur), h("label", { class: "field" }, "Ürün", select));
    if (sel.stok) {
      const [cinsi, ayar] = sel.stok.split("|");
      load = () => api(`/api/ekstre/stok?tur=${sel.stokTur}&cinsi=${encodeURIComponent(cinsi)}&ayar=${encodeURIComponent(ayar)}&baslangic=${start}&bitis=${end}`);
    }
  } else {
    const list = (await api("/api/kasa/hesaplar")).filter((r) => r.aktif || r.hareket_sayisi);
    if (!list.some((r) => String(r.id) === sel.kasa)) sel.kasa = list[0] ? String(list[0].id) : "";
    const select = h("select", { "aria-label": "Hesap" }, ...list.map((r) => new Option(`${r.ad} (${r.para_birimi})`, String(r.id), false, String(r.id) === sel.kasa)));
    select.onchange = () => { sel.kasa = select.value; render(); };
    picker.append(h("label", { class: "field" }, "Hesap", select));
    if (sel.kasa) load = () => api(`/api/ekstre/kasa?hesap_id=${sel.kasa}&baslangic=${start}&bitis=${end}`);
  }

  const printBtn = h("button", { type: "button", class: "secondary", text: "Yazdır", onclick: () => window.print() });
  root.append(
    h("div", { class: "kasa-toolbar no-print" },
      renderTabs([["cari", "CARİ HESAP"], ["stok", "STOK HAREKET"], ["kasa", "KASA"]], state.ekstreTur, (v) => { state.ekstreTur = v; render(); }),
      renderTabs(presets, state.ekstreAralik, (v) => { state.ekstreAralik = v; if (v === "ozel") state.ekstreOzel = [start, end]; render(); })),
    h("div", { class: "kasa-toolbar no-print ekstre-bar" }, picker, h("div", { class: "kasa-day" }, from, h("span", { text: "–" }), to, printBtn)));

  if (!load) { root.append(h("div", { class: "empty", text: "Ekstre alınacak kayıt yok." })); return root; }
  const data = await load();
  const firma = await loadFirma();
  root.append(renderEkstre(data, firma));
  return root;
};

function renderEkstre(data, firma) {
  const tur = state.ekstreTur;
  const range = `${trDate(data.baslangic)} – ${trDate(data.bitis)}`;
  let title; let note; let cols; let devirRow;
  if (tur === "cari") {
    title = `Cari hesap ekstresi: ${data.isim}`;
    note = "Bakiye has üzerinden yürür. Artı: müşteri size borçlu, eksi: siz ona borçlusunuz. Has sütunu işlemden kalan (ödenmemiş) hastır; tutar bilgi içindir.";
    cols = [["Tarih", (r) => trDate(r.tarih)], ["İşlem", "islem"], ["Açıklama", "aciklama"], ["Gram", (r) => (r.gram ? gramText(r.gram) : ""), "num"],
      ["Tutar (TL)", (r) => (r.tutar ? fmtMoney(r.tutar) : ""), "num"], ["Has", (r) => signed(r.has, hasText), "num"],
      ["Bakiye has", (r) => hasText(r.bakiye_has), "num strong"]];
    devirRow = { islem: "Devir", bakiye_has: data.devir.has };
  } else if (tur === "stok") {
    title = `${data.tur === "hurda" ? "Hurda stok" : "Stok"} hareket ekstresi: ${data.cinsi} ${data.ayar}`.trim();
    note = "Çıkışlarda has, stoktan düşen alış hasıdır (stok ekranıyla aynı).";
    cols = [["Tarih", (r) => trDate(r.tarih)], ["İşlem", "islem"], ["Kişi / firma", "kisi"], ["Milyem", (r) => (r.milyem ? formatTurkishNumber(r.milyem, 0, 2) : ""), "num"],
      ["Gram", (r) => signed(r.gram, gramText), "num"], ["Has", (r) => signed(r.has, hasText), "num"],
      ["Kalan gram", (r) => gramText(r.bakiye_gram), "num strong"], ["Kalan has", (r) => hasText(r.bakiye_has), "num strong"]];
    devirRow = { islem: "Devir", bakiye_gram: data.devir.gram, bakiye_has: data.devir.has };
  } else {
    const cur = data.hesap.para_birimi;
    title = `Kasa ekstresi: ${data.hesap.ad}`;
    note = data.satirlar.some((r) => r.komisyon) ? "POS girişleri komisyon düşülmüş net tutarla gösterilir." : "";
    cols = [["Tarih", (r) => trDate(r.tarih)], ["İşlem", "islem"], ["Açıklama", "aciklama"],
      ["Giriş", (r) => (r.tutar > 0 ? fmtMoney(r.tutar, cur) : ""), "num"], ["Çıkış", (r) => (r.tutar < 0 ? fmtMoney(-r.tutar, cur) : ""), "num"],
      ["Bakiye", (r) => fmtMoney(r.bakiye_tutar, cur), "num strong"]];
    devirRow = { islem: "Devir", bakiye_tutar: data.devir.tutar };
  }

  const section = h("section", { class: "ekstre-doc" });
  section.append(h("header", { class: "ekstre-head" },
    h("div", {}, h("strong", { class: "ekstre-firma", text: firma.ad || "" }), firma.adres ? h("small", { text: firma.adres }) : null, firma.telefon ? h("small", { text: `Tel: ${firma.telefon}` }) : null),
    h("div", { class: "ekstre-title" }, h("h2", { text: title }), h("small", { text: `${range} · Düzenlenme: ${trDate(state.serverToday || today())}` }))));

  const tiles = h("div", { class: "today-tiles report-tiles ekstre-tiles" });
  const tile = (label, value) => h("article", { class: "today-tile" }, h("span", { text: label }), h("strong", { text: value }));
  if (tur === "cari") {
    const price = state.price?.satis || 0;
    tiles.append(tile("Devir", `${hasText(data.devir.has)} has`), tile("Borçlandırma (+)", `${hasText(data.giris.has)} has`), tile("Alacaklandırma (−)", `${hasText(data.cikis.has)} has`),
      h("article", { class: "today-tile" }, h("span", { text: "Kapanış bakiyesi" }), h("strong", { text: `${hasText(data.kapanis.has)} has` }),
        price && data.kapanis.has ? h("small", { text: `≈ ${fmtMoney(Math.abs(data.kapanis.has) * price)} (güncel has fiyatıyla)` }) : null));
  }
  else if (tur === "stok") tiles.append(tile("Devir", `${gramText(data.devir.gram)} gr · ${hasText(data.devir.has)} has`), tile("Giriş", `${gramText(data.giris.gram)} gr · ${hasText(data.giris.has)} has`),
    tile("Çıkış", `${gramText(data.cikis.gram)} gr · ${hasText(data.cikis.has)} has`), tile("Kalan", `${gramText(data.kapanis.gram)} gr · ${hasText(data.kapanis.has)} has`));
  else { const cur = data.hesap.para_birimi; tiles.append(tile("Devir", fmtMoney(data.devir.tutar, cur)), tile("Giriş", fmtMoney(data.giris.tutar, cur)), tile("Çıkış", fmtMoney(data.cikis.tutar, cur)), tile("Kapanış bakiyesi", fmtMoney(data.kapanis.tutar, cur))); }
  section.append(tiles);
  if (note) section.append(h("p", { class: "report-range", text: note }));

  const cell = (r, [, get]) => (typeof get === "function" ? get(r) : r[get] ?? "");
  const wrap = h("div", { class: "table-wrap" });
  const table = h("table", { class: "ekstre-table" }, h("thead", {}, h("tr", {}, ...cols.map(([label, , cls]) => h("th", { class: cls || "", text: label })))));
  const body = h("tbody");
  body.append(h("tr", { class: "ekstre-devir" }, ...cols.map((col, i) => h("td", { class: col[2] || "", dataset: { label: col[0] }, text: i === 1 ? "Devir" : i === 0 ? trDate(data.baslangic) : col[2]?.includes("strong") ? cell(devirRow, col) : "" }))));
  data.satirlar.forEach((r) => body.append(h("tr", {}, ...cols.map((col) => h("td", { class: col[2] || "", dataset: { label: col[0] }, text: cell(r, col) })))));
  table.append(body); wrap.append(table); section.append(wrap);
  if (!data.satirlar.length) section.append(h("div", { class: "empty", text: "Bu aralıkta hareket yok." }));

  const csvRows = [{ ...devirRow, tarih: data.baslangic }, ...data.satirlar].map((r) => Object.fromEntries(cols.map((col) => [col[0], cell(r, col)])));
  section.append(h("div", { class: "form-bottom-actions no-print" },
    h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv(title, cols.map(([label]) => [label, label]), csvRows) })));
  return section;
}
