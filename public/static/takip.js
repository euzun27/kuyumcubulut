/*
 * Sipariş ve tamir takibi, cari kartları (müşteri, toptancı, atölye; telefon,
 * vade, has limiti) ve dashboard uyarıları. modules.js'teki yardımcıları
 * (h, openModal, kasaRowsEditor, printHtml...) kullanır.
 */

Object.assign(views, { siparis: { title: "Sipariş ve Tamir", subtitle: "Müşteri siparişleri, tamirler, atölye ve teslim takibi" } });
Object.assign(KASA_CATEGORY_LABEL, { SIPARIS_KAPORA: "Sipariş kaporası", SIPARIS_TESLIM: "Sipariş teslim" });
Object.assign(labels, { kart_tur: "Tür", telefon: "Telefon" });
columns.kisiCari.splice(1, 0, "kart_tur", "telefon");

const ORDER_STATE_LABEL = { ALINDI: "Alındı", ATOLYEDE: "Atölyede", HAZIR: "Hazır", TESLIM: "Teslim edildi", IPTAL: "İptal" };
const ORDER_TYPE_LABEL = { SIPARIS: "Sipariş", TAMIR: "Tamir" };
const CARD_TYPE_LABEL = { MUSTERI: "Müşteri", TOPTANCI: "Toptancı", ATOLYE: "Atölye", DIGER: "Diğer" };
state.siparisFilter = "ACIK";
state.cariKartlar = { byKey: new Map(), list: [], vade: 30 };
let siparisEditing = null;

/* ------------------------------------------------------------------ */
/* Cari kartları                                                       */
/* ------------------------------------------------------------------ */

async function loadCariKartlar() {
  try {
    const data = await api("/api/cari-kart");
    state.cariKartlar = { byKey: new Map(data.kartlar.map((k) => [normalize(k.isim), k])), list: data.kartlar, vade: data.vade_gun_varsayilan };
  } catch { /* kartsız da çalışır */ }
  return state.cariKartlar;
}

const cariKartOf = (name) => state.cariKartlar.byKey.get(normalize(name));

/** Cari listesine kart türünü ekler; atölye ve toptancıları ayrı listeler. */
function decorateCari(data) {
  const mark = (row) => {
    const card = cariKartOf(row.isim);
    return { ...row, kart_tur: card ? `${CARD_TYPE_LABEL[card.tur]}${card.kisi_tipi === "TUZEL" ? " · Şirket" : ""}` : "", telefon: card?.telefon || "" };
  };
  data.kisiler = (data.kisiler || []).map(mark);
  // Kartı açılmış ama henüz işlemi olmayanlar (örn. yeni atölye) sıfır bakiyeyle listelenir.
  const known = new Set(data.kisiler.map((row) => normalize(row.isim)));
  const zero = { net_bakiye_has: 0, kalan_has: 0, toplam_satis_has: 0, toplam_alis_has: 0, tahsil_edilen_has: 0, odedigimiz_has: 0, odeyecegimiz_has: 0, son_islem_tarihi: "" };
  state.cariKartlar.list.filter((card) => !known.has(normalize(card.isim))).forEach((card) => data.kisiler.push(mark({ isim: card.isim, ...zero })));
  data.kisiler.sort((a, b) => normalize(a.isim).localeCompare(normalize(b.isim), "tr"));
  data.musteriler = (data.musteriler || []).map(mark);
  data.tedarikciler = (data.tedarikciler || []).map(mark);
  data.atolyeler = data.kisiler.filter((row) => ["ATOLYE", "TOPTANCI"].includes(cariKartOf(row.isim)?.tur));
  return data;
}

const PERSON_TYPE_LABEL = { SAHIS: "Şahıs", TUZEL: "Şirket (tüzel)" };

/**
 * Cari kartı: ekleme (isim boş) ve düzeltme. İsim değişirse önce tüm
 * kayıtlardaki cari adı değiştirilir, sonra kart yeni isimle yazılır.
 */
async function openCariKart(isim = "") {
  const isNew = !isim;
  const { box, close } = openModal(isNew ? "Yeni cari" : `${isim} · cari kartı`, "kasa-modal cari-kart-modal");
  const card = (isNew ? null : cariKartOf(isim)) || {};
  const writable = currentUser?.role !== "viewer";
  const form = h("form", { class: "settings-form cari-kart-form" });
  const input = (name, value = "", attrs = {}) => h("input", { name, value: value ?? "", autocomplete: "off", disabled: !writable, ...attrs });
  const ad = input("isim", isim, { required: true, maxlength: 120 });
  const kisiTipi = h("div", { class: "payment-type-tabs kisi-tipi-tabs" });
  let tipi = card.kisi_tipi || "SAHIS";
  Object.entries(PERSON_TYPE_LABEL).forEach(([value, text]) => kisiTipi.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, disabled: !writable, onclick: () => { tipi = value; syncTipi(); } })));
  const tur = h("select", { name: "tur", disabled: !writable }, ...Object.entries(CARD_TYPE_LABEL).map(([v, t]) => new Option(t, v)));
  tur.value = card.tur || "MUSTERI";
  const telefon = input("telefon", card.telefon, { inputmode: "tel", maxlength: 30 });
  const telefon2 = input("telefon2", card.telefon2, { inputmode: "tel", maxlength: 30 });
  const eposta = input("eposta", card.eposta, { type: "email", maxlength: 120 });
  const adres = h("textarea", { name: "adres", rows: 2, maxlength: 300, disabled: !writable }); adres.value = card.adres || "";
  const il = input("il", card.il, { maxlength: 60 });
  const vergiDairesi = input("vergi_dairesi", card.vergi_dairesi, { maxlength: 80 });
  const vergiNo = input("vergi_no", card.vergi_no, { inputmode: "numeric", maxlength: 11 });
  vergiNo.addEventListener("input", () => { vergiNo.value = vergiNo.value.replace(/\D/g, ""); });
  const yetkili = input("yetkili", card.yetkili, { maxlength: 120 });
  const vade = input("vade_gun", card.vade_gun ?? "", { inputmode: "numeric", placeholder: `Genel ayar: ${state.cariKartlar.vade} gün` });
  vade.addEventListener("input", () => { vade.value = vade.value.replace(/\D/g, ""); });
  const limit = decimalInput("limit_has", "Limit yok"); limit.disabled = !writable;
  limit.value = card.limit_has ? amountText(card.limit_has) : "";
  const notlar = input("notlar", card.notlar, { maxlength: 500 });
  const adLabel = labeled("Ad soyad", ad);
  const vergiNoLabel = labeled("TC kimlik no", vergiNo);
  const yetkiliLabel = labeled("Yetkili kişi", yetkili);
  const vergiDairesiLabel = labeled("Vergi dairesi", vergiDairesi);
  const warn = h("p", { class: "hint person-warn", hidden: true });
  const syncTipi = () => {
    kisiTipi.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === tipi));
    const company = tipi === "TUZEL";
    adLabel.firstChild.textContent = company ? "Firma ünvanı" : "Ad soyad";
    vergiNoLabel.firstChild.textContent = company ? "Vergi no" : "TC kimlik no";
    vergiNo.maxLength = company ? 10 : 11;
    yetkiliLabel.hidden = !company;
  };
  // Yeni cari veya isim düzeltmesinde benzer kayıtlı cari uyarısı
  ad.addEventListener("input", () => {
    const value = ad.value.trim();
    if (!value || squash(value) === squash(isim)) { warn.hidden = true; return; }
    const { exact, similar } = similarPeople(value);
    const list = exact ? [exact] : similar;
    warn.hidden = !list.length;
    warn.textContent = exact ? `“${exact}” zaten kayıtlı. Aynı isimle ikinci cari açılmaz; isim değiştirirseniz iki cari birleşir.` : `Benzer kayıtlı cari: ${list.join(", ")}`;
  });
  form.append(h("div", { class: "cari-kart-grid" },
    h("div", { class: "cari-kart-section" }, h("h3", { text: "Kimlik" }), kisiTipi, adLabel, warn, labeled("Cari türü", tur), vergiNoLabel, vergiDairesiLabel, yetkiliLabel),
    h("div", { class: "cari-kart-section" }, h("h3", { text: "İletişim" }), labeled("Telefon", telefon), labeled("2. telefon", telefon2), labeled("E-posta", eposta), labeled("İl / ilçe", il), labeled("Adres", adres)),
    h("div", { class: "cari-kart-section" }, h("h3", { text: "Takip" }), labeled("Vade (gün)", vade),
      h("p", { class: "hint", text: "Bakiye açıkken son işlemden bu kadar gün geçince uyarı verilir. 0 yazarsanız uyarı verilmez." }),
      labeled("Has limiti (gr)", limit), h("p", { class: "hint", text: "Müşterinin bize borcu bu has miktarını aşınca uyarı verilir." }), labeled("Not", notlar))));
  syncTipi();
  const save = h("button", { type: "submit", text: isNew ? "Cariyi kaydet" : "Kaydet", disabled: !writable });
  form.append(h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const yeni = tidyName(ad.value);
    if (!yeni) { showMessage("Cari adını girin.", true); return; }
    const { exact } = similarPeople(yeni);
    if (isNew && exact && cariKartOf(exact)) { showMessage(`“${exact}” için cari kartı zaten var; listeden açıp düzeltin.`, true); return; }
    if (!isNew && squash(yeni) !== squash(isim) && exact && !(await showConfirm(`“${isim}” carisinin tüm kayıtları “${exact}” ile birleşsin mi`, "Birleştir", "Vazgeç"))) return;
    save.disabled = true;
    try {
      if (!isNew && yeni !== isim) await api("/api/cari/kisi", { method: "PUT", body: JSON.stringify({ eski_isim: isim, yeni_isim: exact || yeni }) });
      await api("/api/cari-kart", { method: "PUT", body: JSON.stringify({
        isim: exact || yeni, tur: tur.value, kisi_tipi: tipi, telefon: telefon.value, telefon2: telefon2.value, eposta: eposta.value, adres: adres.value, il: il.value,
        vergi_dairesi: vergiDairesi.value, vergi_no: vergiNo.value, yetkili: tipi === "TUZEL" ? yetkili.value : "", vade_gun: vade.value,
        limit_has: String(readAmount(limit.value)), notlar: notlar.value,
      }) });
      await refreshSuggestions(); close(); showMessage(isNew ? "Cari eklendi." : "Cari kartı kaydedildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); (isNew ? ad : tur).focus();
}

async function openVadeAyari() {
  const { box, close } = openModal("Vade uyarısı", "kasa-modal");
  const form = h("form", { class: "settings-form" });
  const gun = h("input", { name: "vade", inputmode: "numeric", value: String(state.cariKartlar.vade) });
  gun.addEventListener("input", () => { gun.value = gun.value.replace(/\D/g, ""); });
  const save = h("button", { type: "submit", text: "Kaydet" });
  form.append(labeled("Genel vade (gün)", gun), h("p", { class: "hint", text: "Cari kartında ayrı vade yazılmayan herkes için geçerlidir. 0 yazarsanız vade uyarısı kapanır." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try { await api("/api/cari-kart/ayar", { method: "PUT", body: JSON.stringify({ vade_gun_varsayilan: gun.value }) }); await loadCariKartlar(); close(); render(); }
    catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); gun.focus();
}

/* ------------------------------------------------------------------ */
/* Sipariş ve tamir ekranı                                             */
/* ------------------------------------------------------------------ */

function dueText(r) {
  if (!r.teslim_tarihi) return "";
  const day = `${trDate(r.teslim_tarihi)} ${new Date(`${r.teslim_tarihi}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "short" })}`;
  if (r.kalan_gun === null || r.kalan_gun === undefined) return day;
  if (r.kalan_gun < 0) return `${day} · ${-r.kalan_gun} gün gecikti`;
  if (r.kalan_gun === 0) return `${day} · bugün`;
  if (r.kalan_gun === 1) return `${day} · yarın`;
  return `${day} · ${r.kalan_gun} gün var`;
}

const dueTone = (r) => r.kalan_gun === null || r.kalan_gun === undefined ? "" : r.kalan_gun < 0 ? "late" : r.kalan_gun <= 1 ? "soon" : "";

async function setOrderState(r, durum) {
  if (durum === "TESLIM") return openTeslim(r);
  if (durum === "ATOLYEDE") return openAtolye(r);
  if (durum === "IPTAL" && !(await showConfirm(`${r.musteri} - ${r.urun} iptal edilsin mi`, "İptal et", "Vazgeç"))) return render();
  try { await api(`/api/siparis/${r.id}/durum`, { method: "POST", body: JSON.stringify({ durum }) }); showMessage(`Durum: ${ORDER_STATE_LABEL[durum]}`); render(); }
  catch (error) { showMessage(error.message, true); render(); }
}

function openAtolye(r) {
  const { box, close } = openModal(`${r.urun} · atölyeye gönder`, "kasa-modal");
  const form = h("form", { class: "settings-form" });
  const atolye = h("input", { name: "atolye", value: r.atolye || "", required: true, autocomplete: "off" });
  attachAutocomplete(atolye, "people");
  const save = h("button", { type: "submit", text: "Atölyeye gönder" });
  form.append(labeled("Atölye", atolye), h("p", { class: "hint", text: "Atölyeye altın verdiyseniz Cari ekranında o atölyeye has ödemesi olarak girin; bakiye orada izlenir." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: () => { close(); render(); } }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try { await api(`/api/siparis/${r.id}/durum`, { method: "POST", body: JSON.stringify({ durum: "ATOLYEDE", atolye: atolye.value }) }); close(); render(); }
    catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); atolye.focus();
}

function openTeslim(r) {
  const { box, close } = openModal(`${r.musteri} · teslim`, "kasa-modal");
  const form = h("form", { class: "settings-form teslim-form" });
  const tarih = h("input", { type: "date", value: state.serverToday || today() });
  const nakit = state.kasaHesaplar.find((a) => a.aktif && a.tur === "NAKIT" && a.para_birimi === "TRY");
  const initial = r.teslim_odemeleri?.length ? r.teslim_odemeleri : r.kalan_tl > 0 ? [{ hesap_id: nakit?.id, tutar: r.kalan_tl }] : [{}];
  const editor = kasaRowsEditor(initial, "GIRIS");
  const facts = h("div", { class: "teslim-facts" },
    h("span", {}, "Fiyat ", h("b", { text: r.tutar ? fmtMoney(r.tutar) : "-" })),
    h("span", {}, "Kapora ", h("b", { text: fmtMoney(r.kapora) })),
    h("span", {}, "Kalan ", h("b", { text: fmtMoney(r.kalan_tl) })));
  const save = h("button", { type: "submit", text: "Teslim et" });
  form.append(labeled("Teslim günü", tarih), facts, h("p", { class: "hint", text: "Teslimde alınan para (boş bırakabilirsiniz):" }), editor.element,
    h("p", { class: "hint", text: "Ürün stoktan çıktıysa Satış ekranından ayrıca satış kaydı girin." }),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazgeç", onclick: () => { close(); render(); } }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const items = editor.items();
      if (items.length) editor.validate();
      await api(`/api/siparis/${r.id}/durum`, { method: "POST", body: JSON.stringify({ durum: "TESLIM", tarih: tarih.value, kasa: items }) });
      close(); showMessage("Teslim edildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); save.focus();
}

extraViews.siparis = async () => {
  const [data, atolyeData] = await Promise.all([api("/api/siparis"), api("/api/atolye").catch(() => null), loadCariKartlar()]);
  const jobs = new Map((atolyeData?.kayitlar || []).filter((j) => j.siparis_id && j.durum === "ATOLYEDE").map((j) => [Number(j.siparis_id), j]));
  const root = h("div", { class: "emanet-root siparis-root" });
  const o = data.ozet;
  const tile = (label, value, tone = "") => h("article", { class: `kasa-total ${tone}` }, h("span", { text: label }), h("strong", { text: value }));
  root.append(h("div", { class: "kasa-totals" },
    tile("Açık iş", String(o.acik)), tile("Atölyede", String(o.atolyede)), tile("Hazır, teslim bekliyor", String(o.hazir), o.hazir ? "tone-green" : ""),
    tile("Geciken", String(o.geciken), o.geciken ? "tone-red" : ""), tile("Açık işlerde alınan", fmtMoney(o.alinan_kapora))));
  if (currentUser?.role !== "viewer") root.append(renderSiparisForm());
  const filters = [["ACIK", "AÇIK İŞLER"], ["HAZIR", "HAZIR"], ["TESLIM", "TESLİM EDİLENLER"], ["ALL", "TÜMÜ"]];
  root.append(renderTabs(filters, state.siparisFilter, (value) => { state.siparisFilter = value; render(); }));
  const match = { ACIK: (r) => ["ALINDI", "ATOLYEDE", "HAZIR"].includes(r.durum), HAZIR: (r) => r.durum === "HAZIR", TESLIM: (r) => r.durum === "TESLIM", ALL: () => true }[state.siparisFilter];
  const rows = filteredRows(data.kayitlar.filter(match).map((r) => ({ ...r, tur_text: ORDER_TYPE_LABEL[r.tur], durum_text: ORDER_STATE_LABEL[r.durum], teslim_text: dueText(r) })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Sipariş ve Tamir Kayıtları" });
  if (rows.length) title.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("siparisler", [["No", "id"], ["Tarih", "tarih"], ["Tür", "tur_text"], ["Müşteri", "musteri"], ["Telefon", "telefon"], ["Ürün / iş", "urun"], ["Cinsi", "cinsi"], ["Ayar", "ayar"], ["Gram", "gram"], ["Teslim günü", "teslim_tarihi"], ["Durum", "durum_text"], ["Atölye", "atolye"], ["Fiyat", "tutar"], ["Alınan", "alinan_tl"], ["Kalan", "kalan_tl"], ["Not", "notlar"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Kayıt yok." }));
  else {
    const writable = currentUser?.role !== "viewer";
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["No", "Tarih", "Tür", "Müşteri", "Ürün / iş", "Teslim günü", "Durum", "Fiyat", "Kalan", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((r) => {
      const next = { ALINDI: ["HAZIR", "Hazır"], ATOLYEDE: ["HAZIR", "Hazır"], HAZIR: ["TESLIM", "Teslim et"] }[r.durum];
      const select = h("select", { class: "durum-select", "aria-label": "Durum", onchange: () => setOrderState(r, select.value) }, ...Object.entries(ORDER_STATE_LABEL).map(([v, t]) => new Option(t, v)));
      select.value = r.durum;
      body.append(h("tr", { class: ["TESLIM", "IPTAL"].includes(r.durum) ? "row-closed" : "" },
        h("td", { dataset: { label: "No" }, text: `SP-${r.id}` }),
        h("td", { dataset: { label: "Tarih" }, text: trDate(r.tarih) }),
        h("td", { dataset: { label: "Tür" }, text: r.tur_text }),
        h("td", { dataset: { label: "Müşteri" } }, r.musteri, r.telefon ? h("small", { class: "cell-sub", text: r.telefon }) : null),
        h("td", { dataset: { label: "Ürün / iş" } }, r.urun, h("small", { class: "cell-sub", text: [r.cinsi, r.ayar, r.gram ? `${formatValue("gram", r.gram)} gr` : "", r.atolye ? `Atölye: ${r.atolye}${jobs.has(Number(r.id)) ? ` (${jobs.get(Number(r.id)).asama_adi})` : ""}` : ""].filter(Boolean).join(" · ") })),
        h("td", { dataset: { label: "Teslim günü" } }, r.teslim_text ? h("span", { class: `due ${dueTone(r)}`, text: r.teslim_text }) : null),
        h("td", { dataset: { label: "Durum" } }, writable ? select : h("span", { class: "status-pill open", text: r.durum_text })),
        h("td", { class: "num", dataset: { label: "Fiyat" }, text: r.tutar ? fmtMoney(r.tutar) : "" }),
        h("td", { class: "num", dataset: { label: "Kalan" }, text: r.tutar ? fmtMoney(r.kalan_tl) : r.alinan_tl ? `Alınan ${fmtMoney(r.alinan_tl)}` : "" }),
        h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
          writable && next ? h("button", { type: "button", class: "secondary emanet-toggle", text: next[1], onclick: () => setOrderState(r, next[0]) }) : null,
          h("button", { type: "button", class: "icon-btn", title: "Fiş yazdır", "aria-label": "Fiş yazdır", html: printIcon(), onclick: () => printSiparis(r) }),
          writable ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Düzenle", "aria-label": "Düzenle", html: iconSvg("edit"), onclick: () => { siparisEditing = r; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }) : null,
          writable ? h("button", {
            type: "button", class: "icon-btn icon-delete", title: "Sil", "aria-label": "Sil", html: iconSvg("delete"),
            onclick: async () => { if (await showConfirm("Bu kayıt ve kasaya işlenen kapora/teslim ödemeleri silinsin mi", "Sil", "İptal")) { try { await api(`/api/siparis/${r.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } },
          }) : null)));
    });
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  updateSiparisBadge(data.kayitlar.filter((r) => ["ALINDI", "ATOLYEDE", "HAZIR"].includes(r.durum) && r.kalan_gun !== null && r.kalan_gun <= 1).length);
  return root;
};

function renderSiparisForm() {
  const edit = siparisEditing;
  const panel = h("section", { class: "panel form-panel emanet-form-panel siparis-form-panel" });
  const form = h("form", { class: "entry-form emanet-form siparis-form" });
  let tur = edit?.tur || "SIPARIS";
  const tabs = h("div", { class: "payment-type-tabs emanet-tabs" });
  Object.entries(ORDER_TYPE_LABEL).forEach(([value, text]) => tabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text: value === "TAMIR" ? "Tamir" : "Sipariş", onclick: () => { tur = value; sync(); } })));
  const tarih = h("input", { type: "date", name: "tarih", value: edit?.tarih || state.serverToday || today() });
  const musteri = h("input", { name: "musteri", required: true, autocomplete: "off" });
  const telefon = h("input", { name: "telefon", inputmode: "tel", autocomplete: "off" });
  const urun = h("input", { name: "urun", required: true, autocomplete: "off", maxlength: 300 });
  const cinsi = h("input", { name: "cinsi", autocomplete: "off" });
  const ayar = h("input", { name: "ayar", autocomplete: "off" });
  const gram = decimalInput("gram");
  const tutar = decimalInput("tutar");
  const teslim = h("input", { type: "date", name: "teslim_tarihi" });
  const atolye = h("input", { name: "atolye", autocomplete: "off" });
  const notlar = h("textarea", { name: "notlar", rows: 1, maxlength: 500 });
  const urunLabel = labeled("Ürün", urun);
  const kapora = kasaRowsEditor(edit?.kapora_odemeleri?.length ? edit.kapora_odemeleri : [{}], "GIRIS");
  const kaporaBox = h("div", { class: "siparis-kapora" }, h("span", { class: "siparis-kapora-title", text: "Kapora / ön ödeme (isteğe bağlı)" }), kapora.element);
  form.append(tabs, labeled("Tarih", tarih), labeled("Müşteri", musteri), labeled("Telefon", telefon), urunLabel, labeled("Cinsi", cinsi), labeled("Ayar", ayar),
    labeled("Gram", gram), labeled("Fiyat (TL)", tutar), labeled("Söz verilen teslim", teslim), labeled("Atölye", atolye), labeled("Not", notlar), kaporaBox);
  attachAutocomplete(musteri, "people"); attachAutocomplete(atolye, "people"); attachAutocomplete(cinsi, "products");
  musteri.addEventListener("change", () => { const card = cariKartOf(musteri.value); if (card?.telefon && !telefon.value) telefon.value = card.telefon; });
  const sync = () => {
    tabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === tur));
    urunLabel.firstChild.textContent = tur === "TAMIR" ? "Yapılacak tamir" : "Ürün";
    urun.placeholder = tur === "TAMIR" ? "Örn. bilezik kaynak, taş takma" : "Örn. isimli kolye, alyans";
  };
  if (edit) {
    musteri.value = edit.musteri; telefon.value = edit.telefon || ""; urun.value = edit.urun; cinsi.value = edit.cinsi || ""; ayar.value = edit.ayar || "";
    gram.value = amountText(edit.gram); tutar.value = amountText(edit.tutar); teslim.value = edit.teslim_tarihi || ""; atolye.value = edit.atolye || ""; notlar.value = edit.notlar || "";
  }
  sync();
  const save = h("button", { type: "submit", text: edit ? "Güncelle" : "Kaydet" });
  const actions = h("div", { class: "form-bottom-actions" }, save);
  if (edit) actions.append(h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { siparisEditing = null; render(); } }));
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const items = kapora.items();
      if (items.length) kapora.validate();
      const payload = { tarih: tarih.value, tur, musteri: musteri.value, telefon: telefon.value, urun: urun.value, cinsi: cinsi.value, ayar: ayar.value,
        gram: String(readAmount(gram.value)), tutar: String(readAmount(tutar.value)), teslim_tarihi: teslim.value, atolye: atolye.value, notlar: notlar.value, kasa: items };
      const saved = await api(edit ? `/api/siparis/${edit.id}` : "/api/siparis", { method: edit ? "PUT" : "POST", body: JSON.stringify(payload) });
      showMessage(edit ? "Kayıt güncellendi." : tur === "TAMIR" ? "Tamir kaydı alındı." : "Sipariş kaydedildi.");
      if (!edit && saved?.id && await showConfirm("Müşteriye fiş yazdırılsın mı", "Yazdır", "Hayır")) {
        printSiparis({ ...saved, kapora: kapora.totalTL(), kalan_tl: Math.max(readAmount(tutar.value) - kapora.totalTL(), 0) });
      }
      siparisEditing = null; await refreshSuggestions(); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(form);
  return panel;
}

async function printSiparis(r) {
  const firma = await loadFirma();
  const line = (label, value) => value === "" || value === null || value === undefined ? "" : `<tr><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const title = r.tur === "TAMIR" ? "TAMİR FİŞİ" : "SİPARİŞ FİŞİ";
  const due = r.teslim_tarihi ? new Date(`${r.teslim_tarihi}T12:00:00`).toLocaleDateString("tr-TR") : "";
  const inner = receiptHeader(firma, title, `SP-${r.id}`, r.tarih) + `<table>${line("Müşteri", r.musteri)}${line("Telefon", r.telefon)}</table><hr>
    <div><b>${esc(r.urun)}</b></div><table>${line("Cinsi", [r.cinsi, r.ayar].filter(Boolean).join(" "))}${line("Gram", r.gram ? formatValue("gram", r.gram) : "")}${line("Teslim günü", due)}</table><hr><table>
    ${line("Fiyat", r.tutar ? fmtMoney(r.tutar) : "")}${line("Kapora", r.kapora ? fmtMoney(r.kapora) : "")}${r.tutar ? `<tr class="total"><td>KALAN</td><td class="r">${esc(fmtMoney(r.kalan_tl ?? r.tutar))}</td></tr>` : ""}</table>
    ${r.notlar ? `<div class="muted">Not: ${esc(r.notlar)}</div>` : ""}<div class="c muted">Ürünü teslim alırken bu fişi getiriniz.</div>` + receiptFooter(firma);
  printHtml(title, inner);
}

/* ------------------------------------------------------------------ */
/* Dashboard uyarıları                                                 */
/* ------------------------------------------------------------------ */

function updateSiparisBadge(count) {
  const nav = document.querySelector('.nav[data-view="siparis"]');
  if (!nav) return;
  let badge = nav.querySelector(".nav-badge");
  if (!count) { badge?.remove(); return; }
  if (!badge) { badge = h("span", { class: "nav-badge" }); nav.append(badge); }
  badge.textContent = String(count);
  badge.title = `${count} işin teslim günü geldi veya geçti`;
}

function renderUyarilar() {
  const panel = h("section", { class: "dashboard-panel alerts-panel" });
  const head = h("div", { class: "dashboard-panel-head" }, h("h2", { text: "Uyarılar" }), h("p", { text: "Yükleniyor…" }));
  if (isAdmin()) head.append(h("button", { type: "button", class: "csv-btn", text: "VADE AYARI", onclick: openVadeAyari }));
  const list = h("ul", { class: "alert-list" });
  panel.append(head, list);
  Promise.all([api("/api/uyarilar"), loadCariKartlar()]).then(([u]) => {
    head.querySelector("p").textContent = u.toplam ? `${u.toplam} konu dikkat bekliyor` : "Bugün için uyarı yok";
    updateSiparisBadge(u.siparis.length);
    const item = (tone, title, detail, onclick) => h("li", {}, h("button", { type: "button", class: `alert-item ${tone}`, onclick }, h("strong", { text: title }), h("span", { text: detail })));
    u.siparis.forEach((s) => list.append(item(s.kalan_gun < 0 ? "late" : "soon", `${ORDER_TYPE_LABEL[s.tur]}: ${s.musteri}`,
      `${s.urun} · ${s.kalan_gun < 0 ? `${-s.kalan_gun} gün gecikti` : s.kalan_gun === 0 ? "bugün teslim" : "yarın teslim"} · ${ORDER_STATE_LABEL[s.durum]}${s.telefon ? ` · ${s.telefon}` : ""}`,
      () => { state.siparisFilter = "ACIK"; goView("siparis"); })));
    const tl = (has) => state.price?.satis ? ` (≈ ${fmtMoney(Math.abs(has) * state.price.satis)})` : "";
    u.vade.forEach((v) => list.append(item(v.yon === "ALACAK" ? "late" : "soon", `${v.isim}${v.tur ? ` · ${CARD_TYPE_LABEL[v.tur]}` : ""}`,
      `${v.yon === "ALACAK" ? "Bize borcu" : "Bizim borcumuz"} ${formatValue("has", Math.abs(v.kalan_has))} gr has${tl(v.kalan_has)} · son işlem ${v.gun} gün önce (vade ${v.vade_gun})${v.telefon ? ` · ${v.telefon}` : ""}`,
      () => openCariKart(v.isim))));
    u.limit.forEach((v) => list.append(item("late", `${v.isim} · limit aşıldı`, `Borç ${formatValue("has", v.kalan_has)} gr has, limit ${formatValue("has", v.limit_has)} gr`, () => openCariKart(v.isim))));
    (u.atolye || []).forEach((a) => list.append(item("late", `Atölye: ${a.atolye}`, `${a.is_tanimi} · ${a.gecikme_gun} gün gecikti (söz ${trDate(a.soz_tarihi)}) · ${a.asama_adi}`,
      () => { state.atolyeFilter = "ACIK"; goView("atolye"); })));
    if (!u.toplam) list.append(h("li", { class: "alert-empty", text: "Geciken sipariş, atölye işi veya vadesi geçen cari yok." }));
  }).catch(() => { head.querySelector("p").textContent = "Uyarılar alınamadı"; });
  return panel;
}

const renderDashboardTodayBase = renderDashboardToday;
renderDashboardToday = function (data) {
  const root = renderDashboardTodayBase(data);
  root.querySelector(".quick-actions")?.append(h("button", { type: "button", text: "Sipariş / tamir", onclick: () => goView("siparis") }));
  root.querySelector(".dashboard-today-row")?.append(renderUyarilar());
  return root;
};

/* ------------------------------------------------------------------ */
/* Mükerrer cari önleme                                                */
/* ------------------------------------------------------------------ */

/** Kart isimlerini öneri listelerine ekler (henüz işlemi olmayan atölye vb.). */
function mergeCardNames() {
  if (!state.suggestions) return;
  for (const key of ["people", "customers", "suppliers"]) {
    const list = state.suggestions[key] || (state.suggestions[key] = []);
    const seen = new Set(list.map(normalize));
    state.cariKartlar.list.forEach((card) => { if (!seen.has(normalize(card.isim))) { list.push(card.isim); seen.add(normalize(card.isim)); } });
  }
}

const refreshSuggestionsBase = refreshSuggestions;
refreshSuggestions = async function () {
  await Promise.all([refreshSuggestionsBase(), loadCariKartlar()]);
  mergeCardNames();
};

const PERSON_FIELDS = ["musteri", "tedarikci", "kisi"];
const squash = (value) => normalize(String(value || "")).replace(/\s+/g, " ").trim();
const tidyName = (value) => String(value || "").trim().replace(/\s+/g, " ");

function knownPeople() {
  const names = new Map();
  const add = (name) => { const key = squash(name); if (key && !names.has(key)) names.set(key, tidyName(name)); };
  (state.suggestions?.people || []).forEach(add);
  state.cariKartlar.list.forEach((card) => add(card.isim));
  (state.cariData?.kisiler || []).forEach((row) => add(row.isim));
  return names;
}

function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Yazılan isim kayıtlı bir cariyle aynıysa (büyük/küçük harf, boşluk farkı)
 * o yazım döner; değilse benzer isimler: tek harf hatası ("Erdal Uzn") veya
 * eksik yazılmış ad ("Erdal" ↔ "Erdal Uzun").
 */
function similarPeople(name) {
  const key = squash(name);
  const names = knownPeople();
  if (!key) return { exact: null, similar: [] };
  if (names.has(key)) return { exact: names.get(key), similar: [] };
  const limit = key.length >= 8 ? 2 : 1;
  const similar = [...names].filter(([k]) => k.startsWith(`${key} `) || key.startsWith(`${k} `) || (Math.min(k.length, key.length) >= 4 && editDistance(k, key, limit) <= limit)).map(([, v]) => v);
  return { exact: null, similar: similar.slice(0, 5) };
}

function choosePerson(typed, similar) {
  return new Promise((resolve) => {
    const { overlay, box, close } = openModal("Benzer cari bulundu", "kasa-modal person-check-modal");
    let done = false;
    const finish = (value) => { if (done) return; done = true; observer.disconnect(); close(); resolve(value); };
    const observer = new MutationObserver(() => { if (!overlay.isConnected && !done) { done = true; observer.disconnect(); resolve(null); } });
    observer.observe(document.body, { childList: true });
    box.append(
      h("p", { class: "hint", text: `“${typed}” yazdınız. Aynı kişi için ikinci bir cari açılmasın diye kontrol edin:` }),
      h("div", { class: "person-choices" },
        ...similar.map((name, i) => h("button", { type: "button", class: i === 0 ? "" : "secondary", text: `${name} (kayıtlı cari)`, onclick: () => finish(name) })),
        h("button", { type: "button", class: "secondary person-new", text: `Yeni cari olarak kaydet: ${typed}`, onclick: () => finish(typed) })));
    box.querySelector(".person-choices button")?.focus();
  });
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form._personChecked) { form._personChecked = false; return; }
  const input = PERSON_FIELDS.map((name) => form.elements.namedItem(name)).find((el) => el instanceof HTMLInputElement && !el.disabled && el.value.trim());
  if (!input) return;
  const { exact, similar } = similarPeople(input.value);
  if (exact) { input.value = exact; return; }
  input.value = tidyName(input.value);
  if (!similar.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const choice = await choosePerson(input.value, similar);
  if (choice === null) { input.focus(); return; }
  input.value = choice;
  form._personChecked = true;
  form.requestSubmit();
}, true);

/* Cari ekranı: "Yeni cari" düğmesi ve satırdaki kart düğmesi */
function cariToolbar(tabs) {
  const bar = h("div", { class: "cari-toolbar" }, tabs);
  if (currentUser?.role !== "viewer") bar.append(h("button", { type: "button", class: "cari-new-btn", text: "+ Yeni cari", onclick: () => openCariKart() }));
  return bar;
}

function cariKartButton(row) {
  const name = row.isim || row.musteri_adi || row.tedarikci_adi;
  return h("button", {
    type: "button", class: "icon-btn icon-card", title: "Cari kartı (bilgileri düzelt)", "aria-label": "Cari kartı",
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M6 16c.6-1.5 1.8-2 3-2s2.4.5 3 2M14 10h4M14 13h3"></path></svg>',
    onclick: () => openCariKart(name),
  });
}
