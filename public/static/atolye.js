/*
 * Atölye takibi: atölyeye verilen iş, aşaması (model, döküm, tesviye, kaynak,
 * mıhlama, cila, rodaj, kontrol, hazır), verilen ve geri gelen maden, fire
 * ve işçilik. Siparişten "Atölyeye gönder" denince de buraya iş açılır.
 * takip.js'teki sipariş yardımcılarını (ORDER_TYPE_LABEL, dueText...) kullanır.
 */

Object.assign(views, { atolye: { title: "Atölye", subtitle: "Atölyedeki işler, aşamalar, verilen / gelen has ve fire" } });

const JOB_TYPE_LABEL = { IMALAT: "İmalat", TAMIR: "Tamir" };
const JOB_METAL_LABEL = { ALTIN: "Altın", GUMUS: "Gümüş" };
state.atolyeFilter = "ACIK";
state.atolyeData = null;
state.atolyePreset = null;
let atolyeEditing = null;

const jobStages = (data, tur) => (data?.asamalar || []).filter((s) => (tur === "TAMIR" ? s.tamir : s.imalat));
const fireTone = (r) => r.fire_orani === null || r.fire_orani === undefined ? "" : r.fire_orani < 0 ? "neg" : r.fire_orani > 5 ? "high" : "";

async function loadAtolye() {
  state.atolyeData = await api("/api/atolye");
  return state.atolyeData;
}

function jobDueText(r) {
  if (r.durum !== "ATOLYEDE") return r.donus_tarihi ? `Alındı ${trDate(r.donus_tarihi)}` : "";
  return dueText({ teslim_tarihi: r.soz_tarihi, kalan_gun: r.kalan_gun });
}

/** Aşama çizgisi: geçilen aşamalar altın, bulunulan yeşil. */
function stageTrack(data, r) {
  const stages = jobStages(data, r.tur);
  const at = stages.findIndex((s) => s.kod === r.asama);
  return h("span", { class: "stage-track", title: stages.map((s) => s.ad).join(" › ") },
    ...stages.map((s, i) => h("i", { class: r.durum === "DONDU" || i < at ? "done" : i === at ? "now" : "", title: s.ad })));
}

async function setJobStage(r, asama) {
  try { await api(`/api/atolye/${r.id}/asama`, { method: "POST", body: JSON.stringify({ asama }) }); render(); }
  catch (error) { showMessage(error.message, true); render(); }
}

function openJobHistory(r) {
  const { box } = openModal(`AT-${r.id} · ${r.is_tanimi}`, "kasa-modal");
  const facts = h("div", { class: "teslim-facts" },
    h("span", {}, "Atölye ", h("b", { text: r.atolye })),
    h("span", {}, "Verilen ", h("b", { text: `${formatValue("gram", r.verilen_gram)} gr · ${formatValue("has", r.verilen_has)} has` })),
    r.durum === "DONDU" ? h("span", {}, "Gelen ", h("b", { text: `${formatValue("gram", r.gelen_gram)} gr · ${formatValue("has", r.gelen_has)} has` })) : null,
    r.durum === "DONDU" ? h("span", {}, "Fire ", h("b", { text: `${formatValue("has", r.fire_has)} has (%${formatTurkishNumber(r.fire_orani ?? 0, 0, 2)})` })) : null);
  box.append(facts, h("ul", { class: "stage-list" }, ...r.asamalar.map((s) => h("li", {}, h("span", { text: trDate(s.tarih) }), h("strong", { text: s.asama_adi }), s.notlar || s.kullanici ? h("small", { text: [s.notlar, s.kullanici].filter(Boolean).join(" · ") }) : null))));
}

function openJobReturn(r) {
  const { box, close } = openModal(`${r.atolye} · atölyeden al`, "kasa-modal");
  const form = h("form", { class: "settings-form teslim-form" });
  const tarih = h("input", { type: "date", value: state.serverToday || today() });
  const gram = decimalInput("gelen_gram"); const milyem = decimalInput("gelen_milyem");
  milyem.value = amountText(r.verilen_milyem) || "";
  const iscilik = decimalInput("iscilik_tl"); iscilik.value = amountText(r.iscilik_tl);
  const iscilikHas = decimalInput("iscilik_has");
  const notlar = h("input", { maxlength: 300, autocomplete: "off" });
  const fireOut = h("b", { text: "-" }); const hasOut = h("b", { text: "0" });
  const update = () => {
    const has = readAmount(gram.value) * (readAmount(milyem.value) || 0) / 1000;
    const fire = r.verilen_has - has;
    hasOut.textContent = `${formatValue("has", has)} has`;
    fireOut.textContent = r.verilen_has > 0 && readAmount(gram.value) > 0 ? `${formatValue("has", fire)} has (%${formatTurkishNumber(fire * 100 / r.verilen_has, 0, 2)})` : "-";
  };
  [gram, milyem].forEach((i) => i.addEventListener("input", update));
  const facts = h("div", { class: "teslim-facts" },
    h("span", {}, "Verilen ", h("b", { text: `${formatValue("gram", r.verilen_gram)} gr · ${formatTurkishNumber(r.verilen_milyem)} milyem · ${formatValue("has", r.verilen_has)} has` })),
    h("span", {}, "Gelen ", hasOut), h("span", {}, "Fire ", fireOut));
  const save = h("button", { type: "submit", text: "Atölyeden al" });
  form.append(labeled("Alış günü", tarih), labeled("Gelen gram", gram), labeled("Gelen milyem", milyem), facts,
    labeled("İşçilik (TL)", iscilik), labeled("İşçilik (has, varsa)", iscilikHas), labeled("Not", notlar),
    h("p", { class: "hint", text: r.siparis_id ? `Bağlı sipariş SP-${r.siparis_id} "Hazır" olacak.` : "Fire = verilen has - gelen has. Atölye has işçilik istiyorsa yukarıya yazın." }),
    h("p", { class: "hint", text: "Atölyeye altın verdiyseniz veya has işçilik ödediyseniz Cari ekranında o atölyeye has ödemesi olarak girin; bakiye orada izlenir." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const res = await api(`/api/atolye/${r.id}/donus`, { method: "POST", body: JSON.stringify({ tarih: tarih.value, gelen_gram: String(readAmount(gram.value)), gelen_milyem: String(readAmount(milyem.value)), iscilik_tl: String(readAmount(iscilik.value)), iscilik_has: String(readAmount(iscilikHas.value)), notlar: notlar.value }) });
      close(); showMessage(`İş atölyeden alındı. Fire: ${formatValue("has", res.fire_has)} has`); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); gram.focus();
}

extraViews.atolye = async () => {
  const [data] = await Promise.all([loadAtolye(), loadCariKartlar()]);
  const orders = await api("/api/siparis").catch(() => ({ kayitlar: [] }));
  const root = h("div", { class: "emanet-root atolye-root" });
  const o = data.ozet;
  const tile = (label, value, tone = "", sub = "") => h("article", { class: `kasa-total ${tone}` }, h("span", { text: label }), h("strong", { text: value }), sub ? h("small", { text: sub }) : null);
  root.append(h("div", { class: "kasa-totals" },
    tile("Atölyedeki iş", String(o.acik)),
    tile("Hazır, alınmayı bekliyor", String(o.hazir), o.hazir ? "tone-green" : ""),
    tile("Geciken", String(o.geciken), o.geciken ? "tone-red" : ""),
    tile("Atölyedeki altın", `${formatValue("has", o.atolyedeki_has)} gr has`, "", o.atolyedeki_gumus ? `Gümüş: ${formatValue("has", o.atolyedeki_gumus)} gr saf` : ""),
    tile("Bu ay fire", `${formatValue("has", o.bu_ay_fire_has)} gr has`, o.bu_ay_fire_has > 0 ? "tone-red" : "")));
  if (currentUser?.role !== "viewer") root.append(renderAtolyeForm(data, orders.kayitlar.filter((r) => ["ALINDI", "ATOLYEDE", "HAZIR"].includes(r.durum))));
  root.append(renderTabs([["ACIK", "ATÖLYEDEKİLER"], ["DONDU", "ALINANLAR"], ["ALL", "TÜMÜ"], ["OZET", "ATÖLYE ÖZETİ"]], state.atolyeFilter, (value) => { state.atolyeFilter = value; render(); }));
  root.append(state.atolyeFilter === "OZET" ? renderAtolyeOzet(data) : renderAtolyeTable(data));
  return root;
};

function renderAtolyeOzet(data) {
  const section = h("section", { class: "table-section" }, h("h2", { text: "Atölye Bazında Fire ve İşçilik" }));
  const wrap = h("div", { class: "table-wrap" });
  if (!data.atolyeler.length) wrap.append(h("div", { class: "empty", text: "Kayıt yok." }));
  else {
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Atölye", "Açık iş", "Biten iş", "Atölyedeki has", "Toplam fire (has)", "Fire oranı", "İşçilik (TL)", "İşçilik (has)"].map((t) => h("th", { text: t })))));
    table.append(h("tbody", {}, ...data.atolyeler.map((a) => h("tr", {},
      h("td", { dataset: { label: "Atölye" }, text: a.atolye }),
      h("td", { class: "num", dataset: { label: "Açık iş" }, text: String(a.acik_is) }),
      h("td", { class: "num", dataset: { label: "Biten iş" }, text: String(a.biten_is) }),
      h("td", { class: "num", dataset: { label: "Atölyedeki has" }, text: formatValue("has", a.atolyedeki_has) }),
      h("td", { class: "num", dataset: { label: "Toplam fire" }, text: formatValue("has", a.toplam_fire_has) }),
      h("td", { class: `num fire-cell ${fireTone(a)}`, dataset: { label: "Fire oranı" }, text: a.fire_orani === null ? "" : `%${formatTurkishNumber(a.fire_orani, 0, 2)}` }),
      h("td", { class: "num", dataset: { label: "İşçilik (TL)" }, text: fmtMoney(a.iscilik_tl) }),
      h("td", { class: "num", dataset: { label: "İşçilik (has)" }, text: a.iscilik_has ? formatValue("has", a.iscilik_has) : "" })))));
    wrap.append(table);
  }
  section.append(wrap, h("p", { class: "hint", text: "Fire oranı, atölyeden alınan işlerde verilen hasa göre kaybın yüzdesidir. Atölyeyle anlaştığınız oranla karşılaştırın." }));
  return section;
}

function renderAtolyeTable(data) {
  const match = { ACIK: (r) => r.durum === "ATOLYEDE", DONDU: (r) => r.durum === "DONDU", ALL: () => true }[state.atolyeFilter] || (() => true);
  const rows = filteredRows(data.kayitlar.filter(match).map((r) => ({ ...r, tur_text: JOB_TYPE_LABEL[r.tur], due_text: jobDueText(r) })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Atölye İşleri" });
  if (rows.length) title.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("atolye-isleri", [["No", "id"], ["Tarih", "tarih"], ["Atölye", "atolye"], ["Tür", "tur_text"], ["İş", "is_tanimi"], ["Sipariş", "siparis_id"], ["Aşama", "asama_adi"], ["Verilen gram", "verilen_gram"], ["Verilen milyem", "verilen_milyem"], ["Verilen has", "verilen_has"], ["Gelen gram", "gelen_gram"], ["Gelen has", "gelen_has"], ["Fire has", "fire_has"], ["İşçilik TL", "iscilik_tl"], ["Söz günü", "soz_tarihi"], ["Alış günü", "donus_tarihi"], ["Not", "notlar"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: state.atolyeFilter === "ACIK" ? "Atölyede iş yok." : "Kayıt yok." }));
  else {
    const writable = currentUser?.role !== "viewer";
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["No", "Veriliş", "Atölye", "İş", "Verilen", "Aşama", "Dönüş", "Fire", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((r) => {
      const stages = jobStages(data, r.tur);
      const open = r.durum === "ATOLYEDE";
      const at = stages.findIndex((s) => s.kod === r.asama);
      const next = open && at >= 0 && at < stages.length - 1 ? stages[at + 1] : null;
      const select = h("select", { class: "durum-select", "aria-label": "Aşama", onchange: () => setJobStage(r, select.value) }, ...stages.map((s) => new Option(s.ad, s.kod)));
      select.value = r.asama;
      body.append(h("tr", { class: open ? "" : "row-closed" },
        h("td", { dataset: { label: "No" }, text: `AT-${r.id}` }),
        h("td", { dataset: { label: "Veriliş" } }, trDate(r.tarih), h("small", { class: "cell-sub", text: open ? `${r.gun} gündür atölyede` : `${r.gun} günde döndü` })),
        h("td", { dataset: { label: "Atölye" }, text: r.atolye }),
        h("td", { dataset: { label: "İş" } }, r.is_tanimi, h("small", { class: "cell-sub", text: [r.tur_text, r.metal !== "ALTIN" ? JOB_METAL_LABEL[r.metal] : "", r.siparis_id ? `Sipariş SP-${r.siparis_id}` : ""].filter(Boolean).join(" · ") })),
        h("td", { class: "num", dataset: { label: "Verilen" } }, r.verilen_gram ? `${formatValue("gram", r.verilen_gram)} gr` : "-", r.verilen_has ? h("small", { class: "cell-sub", text: `${formatValue("has", r.verilen_has)} has` }) : null),
        h("td", { dataset: { label: "Aşama" } }, open && writable ? select : h("span", { class: `status-pill ${open ? "open" : "closed"}`, text: open ? r.asama_adi : "Alındı" }), stageTrack(data, r),
          writable && next && next.kod !== "HAZIR" ? h("button", { type: "button", class: "stage-next", text: `Sonraki: ${next.ad} ›`, onclick: () => setJobStage(r, next.kod) }) : null),
        h("td", { dataset: { label: "Dönüş" } }, r.due_text ? h("span", { class: `due ${open ? dueTone({ kalan_gun: r.kalan_gun }) : ""}`, text: r.due_text }) : null),
        h("td", { class: `num fire-cell ${fireTone(r)}`, dataset: { label: "Fire" } }, r.durum === "DONDU" ? `${formatValue("has", r.fire_has)} has` : "", r.durum === "DONDU" && r.fire_orani !== null ? h("small", { class: "cell-sub", text: `%${formatTurkishNumber(r.fire_orani, 0, 2)}` }) : null),
        h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
          writable && open ? h("button", { type: "button", class: "emanet-toggle", text: "Atölyeden al", onclick: () => openJobReturn(r) }) : null,
          writable && !open ? h("button", { type: "button", class: "secondary emanet-toggle", text: "Geri al", title: "Yeniden atölyede yap", onclick: async () => {
            if (!(await showConfirm("İş yeniden atölyede olarak işaretlensin mi (gelen has ve fire silinir)", "Geri al", "Vazgeç"))) return;
            try { await api(`/api/atolye/${r.id}/geri-al`, { method: "POST", body: "{}" }); render(); } catch (error) { showMessage(error.message, true); }
          } }) : null,
          h("button", { type: "button", class: "icon-btn", title: "Aşama geçmişi", "aria-label": "Aşama geçmişi", html: iconSvg("view"), onclick: () => openJobHistory(r) }),
          writable ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Düzenle", "aria-label": "Düzenle", html: iconSvg("edit"), onclick: () => { atolyeEditing = r; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }) : null,
          writable ? h("button", {
            type: "button", class: "icon-btn icon-delete", title: "Sil", "aria-label": "Sil", html: iconSvg("delete"),
            onclick: async () => { if (await showConfirm("Bu atölye işi ve aşama geçmişi silinsin mi", "Sil", "İptal")) { try { await api(`/api/atolye/${r.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } },
          }) : null)));
    });
    table.append(body); wrap.append(table);
  }
  section.append(wrap);
  return section;
}

function renderAtolyeForm(data, openOrders) {
  const edit = atolyeEditing;
  const preset = state.atolyePreset; state.atolyePreset = null;
  const panel = h("section", { class: "panel form-panel emanet-form-panel atolye-form-panel" });
  const form = h("form", { class: "entry-form emanet-form siparis-form" });
  let tur = edit?.tur || preset?.tur || "IMALAT";
  const tabs = h("div", { class: "payment-type-tabs emanet-tabs" });
  Object.entries(JOB_TYPE_LABEL).forEach(([value, text]) => tabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => { tur = value; sync(); } })));
  const guide = h("div", { class: "stage-guide" });
  const tarih = h("input", { type: "date", name: "tarih", value: edit?.tarih || state.serverToday || today() });
  const atolye = h("input", { name: "atolye", required: true, autocomplete: "off" });
  const isTanimi = h("input", { name: "is_tanimi", required: true, autocomplete: "off", maxlength: 300, placeholder: "Örn. 14 ayar tektaş yüzük dökümü" });
  const siparis = h("select", { name: "siparis_id" }, new Option("Bağlı sipariş yok", ""), ...openOrders.map((s) => new Option(`SP-${s.id} · ${s.musteri} · ${s.urun}`, s.id)));
  const metal = h("select", { name: "metal" }, ...Object.entries(JOB_METAL_LABEL).map(([v, t]) => new Option(t, v)));
  const gram = decimalInput("verilen_gram"); const milyem = decimalInput("verilen_milyem");
  const iscilik = decimalInput("iscilik_tl");
  const soz = h("input", { type: "date", name: "soz_tarihi" });
  const notlar = h("textarea", { name: "notlar", rows: 1, maxlength: 500 });
  const hasOut = h("strong", { text: "0" });
  form.append(tabs, guide, labeled("Veriliş günü", tarih), labeled("Atölye", atolye), labeled("Yapılacak iş", isTanimi), labeled("Bağlı sipariş", siparis),
    labeled("Maden", metal), labeled("Verilen gram", gram), labeled("Verilen milyem", milyem), h("div", { class: "has-preview" }, h("span", { text: "Verilen has" }), hasOut),
    labeled("Atölyenin söz verdiği gün", soz), labeled("Anlaşılan işçilik (TL)", iscilik), labeled("Not", notlar));
  attachAutocomplete(atolye, "people");
  const updateHas = () => { hasOut.textContent = formatValue("has", readAmount(gram.value) * readAmount(milyem.value) / 1000); };
  [gram, milyem].forEach((i) => i.addEventListener("input", updateHas));
  siparis.addEventListener("change", () => {
    const s = openOrders.find((o) => String(o.id) === siparis.value);
    if (!s) return;
    if (!isTanimi.value) isTanimi.value = s.urun;
    if (!gram.value && s.gram) gram.value = amountText(s.gram);
    if (!milyem.value && s.ayar) { const m = { 8: 333, 14: 585, 18: 750, 21: 875, 22: 916, 24: 995 }[Number(String(s.ayar).replace(/\D/g, ""))]; if (m) milyem.value = String(m); }
    if (!soz.value && s.teslim_tarihi) soz.value = s.teslim_tarihi;
    tur = s.tur === "TAMIR" ? "TAMIR" : "IMALAT"; sync(); updateHas();
  });
  const sync = () => {
    tabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === tur));
    guide.replaceChildren(h("strong", { text: "Aşamalar:" }), ...jobStages(data, tur).map((s) => h("span", { text: s.ad })));
  };
  // Öneri listesinde atölye ve toptancı kartları önce gelir.
  const workshops = state.cariKartlar.list.filter((k) => k.tur === "ATOLYE").map((k) => k.isim);
  if (workshops.length === 1 && !edit && !preset) atolye.value = workshops[0];
  if (edit) {
    atolye.value = edit.atolye; isTanimi.value = edit.is_tanimi; metal.value = edit.metal; gram.value = amountText(edit.verilen_gram); milyem.value = amountText(edit.verilen_milyem);
    iscilik.value = amountText(edit.iscilik_tl); soz.value = edit.soz_tarihi || ""; notlar.value = edit.notlar || "";
    if (edit.siparis_id && ![...siparis.options].some((op) => op.value === String(edit.siparis_id))) siparis.add(new Option(`SP-${edit.siparis_id}`, edit.siparis_id));
    siparis.value = edit.siparis_id ? String(edit.siparis_id) : "";
  } else if (preset?.siparis_id) {
    siparis.value = String(preset.siparis_id); siparis.dispatchEvent(new Event("change"));
    if (preset.atolye) atolye.value = preset.atolye;
  }
  sync(); updateHas();
  const save = h("button", { type: "submit", text: edit ? "Güncelle" : "Atölyeye ver" });
  const actions = h("div", { class: "form-bottom-actions" }, save);
  if (edit) actions.append(h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { atolyeEditing = null; render(); } }));
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const payload = { tarih: tarih.value, atolye: atolye.value, tur, is_tanimi: isTanimi.value, siparis_id: siparis.value || null, metal: metal.value,
        verilen_gram: String(readAmount(gram.value)), verilen_milyem: String(readAmount(milyem.value)), iscilik_tl: String(readAmount(iscilik.value)), soz_tarihi: soz.value, notlar: notlar.value };
      await api(edit ? `/api/atolye/${edit.id}` : "/api/atolye", { method: edit ? "PUT" : "POST", body: JSON.stringify(payload) });
      showMessage(edit ? "Atölye işi güncellendi." : "İş atölyeye verildi.");
      atolyeEditing = null; await refreshSuggestions(); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(form);
  return panel;
}

/* Siparişte "Atölyede" seçilince iş Atölye ekranında, verilen maden ve dönüş günüyle açılır. */
openAtolye = function (r) {
  state.atolyePreset = { siparis_id: r.id, atolye: r.atolye, tur: r.tur === "TAMIR" ? "TAMIR" : "IMALAT" };
  atolyeEditing = null;
  goView("atolye");
};
