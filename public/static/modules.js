/*
 * Bulut sürümünün ek ekranları: kasa (nakit, POS, banka, döviz), gün sonu,
 * emanet, sarrafiye, fiş yazdırma, CSV dışa aktarma ve klavye kısayolları.
 * app.js'teki ortak yardımcıları (api, state, render, formatValue...) kullanır.
 */

const CUR_SYMBOL = { TRY: "₺", USD: "$", EUR: "€", GBP: "£" };
const CUR_NAME = { TRY: "TL", USD: "Dolar", EUR: "Euro", GBP: "Sterlin" };
const ACCOUNT_TYPE_LABEL = { NAKIT: "Nakit", BANKA: "Banka", POS: "POS" };
const KASA_CATEGORY_LABEL = {
  SATIS: "Satış", ALIS: "Alış", HURDA_SATIS: "Hurda satış", HURDA_ALIS: "Hurda alış",
  CARI_TAHSILAT: "Cari tahsilat", CARI_ODEME: "Cari ödeme", TRANSFER: "Transfer", DOVIZ: "Döviz",
  GELIR: "Gelir", GIDER: "Gider", DEVIR: "Devir / açılış", DIGER: "Diğer",
};
/** Sarrafiye: standart gram, ayar ve milyem (adet girilince gram hesaplanır). */
const SARRAFIYE = [
  ["ÇEYREK", 1.75, "22", 916], ["YARIM", 3.5, "22", 916], ["TAM", 7, "22", 916],
  ["ATA LİRA", 7.216, "22", 916], ["GREMSE", 17.5, "22", 916], ["BEŞLİ", 36.08, "22", 916],
  ["GRAM ALTIN", 1, "24", 995],
];
const extraViews = {};

Object.assign(views, {
  kasa: { title: "Kasa", subtitle: "Nakit, POS, banka ve döviz hesapları" },
  emanet: { title: "Emanet", subtitle: "Müşteri emanetleri ve teslimler" },
});
Object.assign(labels, { adet: "Adet", adet_tahmini: "Adet (≈)" });
numberFields.add("adet"); numberFields.add("adet_tahmini");
state.kasaTarih = null;
state.emanetFilter = "ACIK";
state.kasaHesaplar = [];
state.kurlar = {};

/* ------------------------------------------------------------------ */
/* Küçük yardımcılar                                                   */
/* ------------------------------------------------------------------ */

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function fmtMoney(value, currency = "TRY") {
  if (value === null || value === undefined || value === "") return "";
  return `${formatTurkishNumber(value, 2, 2)} ${CUR_SYMBOL[currency] || currency}`;
}

/** Türkçe girilen sayı ("1.250,50" veya "1250.5") -> 1250.5 */
function readAmount(text) {
  const raw = String(text ?? "").trim().replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

const amountText = (value) => value ? String(Math.round(Number(value) * 100) / 100).replace(".", ",") : "";

function decimalInput(name, placeholder = "") {
  const input = h("input", { name, inputmode: "decimal", autocomplete: "off", placeholder });
  input.addEventListener("input", () => { input.value = input.value.replace(/[^0-9.,]/g, ""); });
  return input;
}

function labeled(text, input, extra = "") {
  return h("label", { class: `field field-main ${extra}`.trim() }, text, input);
}

function accountOptions(select, filter = () => true, selected = null) {
  select.replaceChildren(...state.kasaHesaplar.filter((a) => a.aktif && filter(a)).map((a) => new Option(`${a.ad} (${CUR_NAME[a.para_birimi] || a.para_birimi})`, a.id)));
  if (selected) select.value = String(selected);
  return select;
}

const accountById = (id) => state.kasaHesaplar.find((a) => Number(a.id) === Number(id));
const isAdmin = () => currentUser?.role === "admin";

/** Ortak pencere: başlık, kapatma, Esc ile kapanma. */
function openModal(titleText, className = "") {
  const previous = document.activeElement;
  const overlay = h("div", { class: `modal ext-modal ${className}` });
  const box = h("div", { class: "modal-box ext-modal-box", role: "dialog", "aria-modal": "true", "aria-label": titleText });
  const onKey = (event) => { if (event.key === "Escape" && [...document.querySelectorAll(".modal")].at(-1) === overlay) { event.preventDefault(); close(); } };
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); if (previous?.isConnected) previous.focus(); };
  const closeBtn = h("button", { type: "button", class: "icon-btn ext-close", title: "Kapat", "aria-label": "Kapat", html: iconSvg("close"), onclick: close });
  const head = h("div", { class: "modal-title" }, h("h2", { text: titleText }), closeBtn);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  box.append(head); overlay.append(box); document.body.append(overlay);
  closeBtn.focus();
  return { overlay, box, close };
}

async function loadKasaAccounts() {
  try { state.kasaHesaplar = await api("/api/kasa/hesaplar"); } catch { state.kasaHesaplar = []; }
  return state.kasaHesaplar;
}

/** Dövizin TL kuru önerisi: kasaya giren döviz için alış, çıkan için satış kuru. */
function suggestedRate(currency, yon) {
  const rate = state.kurlar?.[currency];
  if (!rate) return 0;
  return yon === "CIKIS" ? rate.satis : rate.alis;
}

/* ------------------------------------------------------------------ */
/* Kasa ödeme satırları (satış, alış, cari ödeme formlarında)           */
/* ------------------------------------------------------------------ */

/**
 * Nakit / POS / havale / döviz satırları. `yon`: GIRIS (bize gelen) veya CIKIS.
 * Satırlar [{hesap_id, tutar, kur}] olarak okunur; toplam TL karşılığıdır.
 */
function kasaRowsEditor(initial, yon, onChange = () => {}) {
  const wrap = h("div", { class: "kasa-rows" });
  const list = h("div", { class: "kasa-rows-list" });
  const total = h("strong", { class: "kasa-rows-total" });
  const rows = [];
  let ready = false; // kurulum sırasında onChange çağrılmaz
  const emit = () => {
    total.textContent = fmtMoney(editor.totalTL());
    if (ready) onChange(editor.totalTL());
  };
  const addRow = (item = {}) => {
    const select = accountOptions(h("select", { "aria-label": "Kasa hesabı" }), () => true, item.hesap_id);
    const tutar = decimalInput("tutar", "Tutar");
    tutar.value = amountText(item.tutar);
    const kur = decimalInput("kur", "Kur (TL)");
    const kurField = h("label", { class: "kasa-row-kur" }, "Kur", kur);
    const symbol = h("span", { class: "kasa-row-symbol" });
    const remove = h("button", { type: "button", class: "icon-btn icon-delete", title: "Satırı sil", "aria-label": "Satırı sil", html: iconSvg("delete") });
    const line = h("div", { class: "kasa-row" }, select, h("div", { class: "kasa-row-amount" }, tutar, symbol), kurField, remove);
    const row = { line, select, tutar, kur };
    const sync = (fillRate) => {
      const account = accountById(select.value);
      const foreign = account && account.para_birimi !== "TRY";
      kurField.hidden = !foreign;
      symbol.textContent = CUR_SYMBOL[account?.para_birimi] || "";
      if (foreign && fillRate && !readAmount(kur.value)) kur.value = amountText(suggestedRate(account.para_birimi, yon));
      emit();
    };
    if (item.kur) kur.value = amountText(item.kur);
    select.addEventListener("change", () => { kur.value = ""; sync(true); });
    [tutar, kur].forEach((input) => input.addEventListener("input", emit));
    remove.onclick = () => { rows.splice(rows.indexOf(row), 1); line.remove(); emit(); };
    rows.push(row); list.append(line); sync(true);
    return row;
  };
  const add = h("button", { type: "button", class: "secondary kasa-row-add", text: "+ Ödeme satırı ekle", onclick: () => addRow() });
  wrap.append(list, h("div", { class: "kasa-rows-foot" }, add, h("span", { class: "kasa-rows-total-wrap" }, "Toplam: ", total)));
  const editor = {
    element: wrap,
    addRow,
    rows: () => rows,
    items: () => rows.map((r) => {
      const account = accountById(r.select.value);
      const tutar = readAmount(r.tutar.value);
      return { hesap_id: Number(r.select.value), tutar, kur: account && account.para_birimi !== "TRY" ? readAmount(r.kur.value) || null : null };
    }).filter((r) => r.hesap_id && r.tutar > 0),
    totalTL: () => editor.items().reduce((sum, r) => sum + r.tutar * (r.kur || 1), 0),
    validate: () => {
      const items = editor.items();
      if (!items.length) throw new Error("En az bir ödeme tutarı girin.");
      for (const item of items) {
        const account = accountById(item.hesap_id);
        if (account.para_birimi !== "TRY" && !item.kur) throw new Error(`${account.ad} için TL kurunu girin.`);
      }
      return items;
    },
  };
  (initial?.length ? initial : [{}]).forEach(addRow);
  emit();
  ready = true;
  return editor;
}

function kasaSummaryText(items) {
  return items.map((item) => `${accountById(item.hesap_id)?.ad || "Kasa"} ${fmtMoney(item.tutar, accountById(item.hesap_id)?.para_birimi)}${item.kur ? ` (kur ${formatTurkishNumber(item.kur, 2, 4)})` : ""}`).join(" + ");
}

/** Formdaki işlemin TL tutarı (has × has fiyatı + işçilik). */
function formTotalTL(form) {
  return Math.round((calcHas(form) * parseNum(form.elements.has_fiyati?.value) + parseNum(form.elements.iscilik?.value)) * 100) / 100;
}

/**
 * Kasa ödemesini forma uygular: tutar işlem tutarını karşılıyorsa borç tam
 * kapanır, değilse ödenen TL has fiyatıyla has'a çevrilir.
 */
function applyKasaToForm(form, items, auto = false) {
  form._kasa = items;
  form._kasaAuto = auto;
  if (!items.length) { form._refreshPaymentSummary?.(); return; }
  const totalTL = items.reduce((sum, r) => sum + r.tutar * (r.kur || 1), 0);
  const tutar = formTotalTL(form);
  const price = parseNum(form.elements.has_fiyati?.value);
  if (tutar > 0 && totalTL >= tutar - 0.01) {
    form.elements.odeme_tipi.value = "TAM_KAPAT";
  } else {
    if (!price) throw new Error("Para ile kısmi ödemede has fiyatı girilmeli.");
    form.elements.odeme_tipi.value = "HAS";
    form.elements.odenen_has.value = String(Math.round(totalTL / price * 1000) / 1000);
  }
  syncTransactionPayment(form);
}

/** Satış/alış formuna hızlı ödeme düğmeleri: tek tıkla tamamı nakit, kart, havale, dolar veya euro. */
function attachKasaQuickPay(form, box) {
  const yon = form.dataset.kasaYon || "GIRIS";
  const quick = h("div", { class: "kasa-quick" });
  const pick = (type, cur) => state.kasaHesaplar.find((a) => a.aktif && a.tur === type && a.para_birimi === cur);
  // Dövizde tutar, işlemin TL karşılığını tam karşılayacak şekilde yukarı yuvarlanır.
  const rowFor = (account, tutarTL) => {
    if (account.para_birimi === "TRY") return { hesap_id: account.id, tutar: tutarTL, kur: null };
    const kur = suggestedRate(account.para_birimi, yon);
    if (!(kur > 0)) throw new Error(`${account.para_birimi} kuru yok; HAS düğmesinden kuru girin veya Ödeme Ekle / Düzenle ile elle yazın.`);
    return { hesap_id: account.id, tutar: Math.ceil(tutarTL / kur * 100) / 100, kur };
  };
  const options = [["NAKIT", "TRY", yon === "GIRIS" ? "Nakit al" : "Nakit öde"], ["POS", "TRY", "Kart (POS)"], ["BANKA", "TRY", "Havale / EFT"], ["NAKIT", "USD", "Dolar"], ["NAKIT", "EUR", "Euro"]];
  options.filter(([type, cur]) => cur === "TRY" || pick(type, cur)).forEach(([type, cur, text]) => {
    quick.append(h("button", {
      type: "button", class: "kasa-quick-btn", dataset: { type, cur }, text,
      title: cur === "TRY" ? "" : `Tutarın tamamı ${CUR_NAME?.[cur] || cur} olarak; kur günün ${yon === "GIRIS" ? "alış" : "satış"} kurundan gelir`,
      onclick: () => {
        const account = pick(type, cur);
        if (!account) { showMessage("Bu türde aktif kasa hesabı yok.", true); return; }
        const tutar = formTotalTL(form);
        if (!(tutar > 0)) { showMessage("Önce gram, milyem ve has fiyatını girin.", true); return; }
        try { applyKasaToForm(form, [rowFor(account, tutar)], true); } catch (error) { showMessage(error.message, true); }
      },
    }));
  });
  quick.hidden = !state.kasaHesaplar.length;
  box.append(quick);
  // Tutar değişirse tek tıkla seçilen ödeme tutarı da güncellenir.
  form._onTotalChange = (tutar) => {
    if (!form._kasaAuto || form._kasa?.length !== 1) return;
    const account = accountById(form._kasa[0].hesap_id);
    form._kasa[0] = account && tutar > 0 ? rowFor(account, tutar) : { ...form._kasa[0], tutar };
    form.elements.odeme_tipi.value = tutar > 0 ? "TAM_KAPAT" : "ODEME_YOK";
    form._refreshPaymentSummary?.();
  };
  const refresh = () => quick.querySelectorAll(".kasa-quick-btn").forEach((btn) => {
    const a = form._kasa?.length === 1 ? accountById(form._kasa[0].hesap_id) : null;
    btn.classList.toggle("active", !!a && a.tur === btn.dataset.type && a.para_birimi === btn.dataset.cur);
  });
  const original = form._refreshPaymentSummary;
  form._refreshPaymentSummary = () => {
    original?.();
    if (form._kasa?.length) box.querySelector("[data-payment-summary]").textContent = kasaSummaryText(form._kasa);
    refresh();
  };
  form._refreshPaymentSummary();
}

/** Ödeme penceresindeki "Nakit / Kart / Havale" sekmesinin içeriği. */
function transactionKasaPanel(form) {
  const yon = form.dataset.kasaYon || "GIRIS";
  const info = h("div", { class: "has-preview payment-preview kasa-payment-preview" },
    h("span", { text: "İşlem tutarı" }), h("strong", { text: fmtMoney(formTotalTL(form)) }),
    h("span", { text: "Kalan" }), h("strong", { "data-kalan": "" }));
  const showRest = (total) => { info.querySelector("[data-kalan]").textContent = fmtMoney(Math.max(formTotalTL(form) - total, 0)); };
  const editor = kasaRowsEditor(form._kasa?.length ? form._kasa : [{ hesap_id: state.kasaHesaplar.find((a) => a.aktif)?.id, tutar: formTotalTL(form) }], yon, showRest);
  showRest(editor.totalTL());
  const hint = h("p", { class: "hint", text: "Tutar işlem tutarını karşılıyorsa has borcu tam kapanır; eksikse ödenen TL has fiyatıyla has'a çevrilir." });
  const panel = h("div", { class: "kasa-payment-panel" }, editor.element, info, hint);
  return { panel, editor };
}

/* ------------------------------------------------------------------ */
/* Sarrafiye                                                           */
/* ------------------------------------------------------------------ */

const sarrafiyeOf = (cinsi) => SARRAFIYE.find(([name]) => normalize(name) === normalize(cinsi));

/** Sarrafiyenin panodaki ürün kodu (BEŞLİ'nin piyasa fiyatı yok; has fiyatıyla hesaplanır). */
const SARRAFIYE_KOD = { "ÇEYREK": "CEYREK", "YARIM": "YARIM", "TAM": "TAM", "ATA LİRA": "ATA", "GREMSE": "GREMSE", "GRAM ALTIN": "GRAM" };

/**
 * Seçili sarrafiyenin canlı adet fiyatından has fiyatı: adet × standart gram × milyem
 * has'ı bu fiyatla çarpılınca tutar panodaki (TV) adet fiyatına eşit olur. Fiyat yoksa null.
 */
function productHasPrice(cinsi, milyem, side) {
  const preset = sarrafiyeOf(cinsi);
  const kod = preset && SARRAFIYE_KOD[preset[0]];
  const unitPrice = kod && state.urunFiyat?.[kod]?.[side];
  if (!unitPrice) return null;
  const purity = parseNum(milyem) > 0 ? parseNum(milyem) : preset[3];
  const hasPerUnit = preset[1] * purity / 1000;
  return {
    value: Math.ceil(unitPrice / hasPerUnit * 10000) / 10000, // 4 hane, yukarı: tutar adet x fiyatın altına düşmesin
    note: `${preset[0]} ${side === "alis" ? "alış" : "satış"} ${fmtMoney(unitPrice)} / ${kod === "GRAM" ? "gr" : "adet"} (panodaki fiyat)`,
  };
}

/** Alış ve hurda formlarına sarrafiye düğmeleri; adet girilince gram hesaplanır. */
function attachSarrafiye(form, withChips) {
  const adet = form.elements.adet;
  if (!adet || !form.elements.gram) return;
  attachDecimalGuard(adet);
  const purity = form.elements.satis_milyem || form.elements.milyem;
  const fillGram = () => {
    const preset = sarrafiyeOf(form.elements.cinsi?.value);
    const count = parseNum(adet.value);
    if (!preset || !(count > 0)) return;
    form.elements.gram.value = String(Math.round(count * preset[1] * 1000) / 1000).replace(".", ",");
    form.elements.gram.dispatchEvent(new Event("input", { bubbles: true }));
  };
  adet.addEventListener("input", fillGram);
  if (!withChips) return;
  const chips = h("div", { class: "sarrafiye-chips", role: "group", "aria-label": "Sarrafiye" }, h("span", { class: "sarrafiye-label", text: "Sarrafiye:" }));
  SARRAFIYE.forEach(([name, gram, ayar, milyem]) => chips.append(h("button", {
    type: "button", class: "sarrafiye-chip", text: name, title: `${gram} gr, ${ayar} ayar`,
    onclick: () => {
      // Yeni ürün seçimi: elle yazılmış has fiyatı bırakılır, ürünün canlı fiyatı gelir.
      if (form.elements.has_fiyati?.dataset.canli) delete form.elements.has_fiyati.dataset.elle;
      form.elements.cinsi.value = name;
      form.elements.ayar.value = ayar;
      if (purity && !purity.readOnly) { purity.value = String(milyem); purity.dispatchEvent(new Event("input", { bubbles: true })); }
      if (!parseNum(adet.value)) adet.value = "1";
      fillGram();
      if (form.elements.has_fiyati) setLivePrice(form.elements.has_fiyati);
      adet.focus(); adet.select();
    },
  })));
  form.prepend(chips);
}

/* ------------------------------------------------------------------ */
/* CSV (Excel) dışa aktarma                                            */
/* ------------------------------------------------------------------ */

function csvButton(type, rows, title) {
  return h("button", {
    type: "button", class: "csv-btn", title: "Excel için CSV indir", text: "CSV",
    onclick: () => downloadCsv(`${title}`, (columns[type] || Object.keys(rows[0] || {})).map((col) => [columnLabel(type, col), col]), rows),
  });
}

function downloadCsv(title, cols, rows) {
  const cell = (value) => {
    const text = value === null || value === undefined ? "" : typeof value === "number" ? String(value).replace(".", ",") : String(value);
    return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [cols.map(([label]) => cell(label)).join(";"), ...rows.map((row) => cols.map(([, key]) => cell(row[key])).join(";"))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: `${normalize(title).replace(/[^a-z0-9]+/g, "_")}_${today()}.csv` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* Kasa ekranı                                                         */
/* ------------------------------------------------------------------ */

function shiftDay(day, delta) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toLocaleDateString("en-CA");
}

extraViews.kasa = async () => {
  // Gün seçilmemişse sunucunun (dükkânın saat dilimindeki) bugünü kullanılır.
  const summary = await api(`/api/kasa${state.kasaTarih ? `?tarih=${state.kasaTarih}` : ""}`);
  const day = summary.tarih;
  state.serverToday = state.kasaTarih ? state.serverToday : day;
  const moves = await api(`/api/kasa/hareketler?baslangic=${day}&bitis=${day}`);
  await loadKasaAccounts();
  const root = h("div", { class: "kasa-root" });

  const dateInput = h("input", { type: "date", value: day, "aria-label": "Kasa günü" });
  dateInput.addEventListener("change", () => { state.kasaTarih = dateInput.value || today(); render(); });
  const go = (delta) => { state.kasaTarih = shiftDay(day, delta); render(); };
  const writable = currentUser?.role !== "viewer";
  root.append(h("div", { class: "kasa-toolbar" },
    h("div", { class: "kasa-day" },
      h("button", { type: "button", class: "secondary", title: "Önceki gün", "aria-label": "Önceki gün", text: "‹", onclick: () => go(-1) }),
      dateInput,
      h("button", { type: "button", class: "secondary", title: "Sonraki gün", "aria-label": "Sonraki gün", text: "›", onclick: () => go(1) }),
      state.kasaTarih && state.kasaTarih !== state.serverToday ? h("button", { type: "button", class: "secondary", text: "Bugün", onclick: () => { state.kasaTarih = null; render(); } }) : null,
      h("span", { class: `kasa-badge ${summary.gun_sonu_kapali ? "closed" : "open"}`, text: summary.gun_sonu_kapali ? "Gün sonu alındı" : "Gün açık" })),
    writable ? h("div", { class: "kasa-actions" },
      h("button", { type: "button", text: "Gelir / Gider", onclick: () => openKasaMovement(day) }),
      h("button", { type: "button", text: "Transfer", onclick: () => openTransfer(day) }),
      h("button", { type: "button", text: "Döviz Al / Sat", onclick: () => goView("doviz") }),
      h("button", { type: "button", class: "kasa-close-btn", text: "Gün Sonu", onclick: () => openGunSonu(day) }),
      isAdmin() ? h("button", { type: "button", class: "secondary", text: "Hesaplar", onclick: openAccountsDialog }) : null) : null));

  const totals = h("div", { class: "kasa-totals" });
  Object.entries(summary.toplamlar).forEach(([cur, t]) => {
    if (!summary.hesaplar.some((a) => a.para_birimi === cur)) return;
    totals.append(h("article", { class: "kasa-total" },
      h("span", { text: `Toplam ${CUR_NAME[cur]}` }), h("strong", { text: fmtMoney(t.bakiye, cur) }),
      h("small", { text: `Bugün +${fmtMoney(t.giris, cur)} / −${fmtMoney(t.cikis, cur)}` })));
  });
  root.append(totals);

  const cards = h("div", { class: "kasa-cards" });
  summary.hesaplar.forEach((a) => cards.append(h("article", { class: `kasa-card kasa-${a.tur.toLowerCase()} ${a.aktif ? "" : "inactive"}` },
    h("div", { class: "kasa-card-head" }, h("strong", { text: a.ad }), h("span", { class: "kasa-type", text: `${ACCOUNT_TYPE_LABEL[a.tur]} · ${a.para_birimi}` })),
    h("div", { class: `kasa-balance ${a.bakiye < 0 ? "neg" : ""}`, text: fmtMoney(a.bakiye, a.para_birimi) }),
    h("div", { class: "kasa-card-foot" },
      h("span", { class: "pos", text: `+${fmtMoney(a.giris, a.para_birimi)}` }),
      h("span", { class: "neg", text: `−${fmtMoney(a.cikis, a.para_birimi)}` }),
      a.komisyon ? h("span", { class: "muted", text: `Kom. ${fmtMoney(a.komisyon, a.para_birimi)}` }) : null))));
  root.append(cards);

  // İşlem türüne göre süzme: altın işlemleri, döviz alış-satış, transfer, elle hareket.
  const KASA_FILTERS = [["ALL", "TÜMÜ"], ["ALTIN", "ALTIN / GÜMÜŞ"], ["DOVIZ", "DÖVİZ AL / SAT"], ["TRANSFER", "TRANSFER / BOZDURMA"], ["ELLE", "GELİR / GİDER"]];
  const kasaGroup = (m) => m.bagli_tur === "doviz" ? "DOVIZ" : m.grup ? "TRANSFER" : m.bagli_tur && m.bagli_tur !== "gider" ? "ALTIN" : "ELLE";
  state.kasaFilter = KASA_FILTERS.some(([k]) => k === state.kasaFilter) ? state.kasaFilter : "ALL";
  const rows = filteredRows(moves.filter((m) => state.kasaFilter === "ALL" || kasaGroup(m) === state.kasaFilter).map((m) => ({ ...m, tur_text: KASA_CATEGORY_LABEL[m.kategori] || m.kategori })));
  root.append(renderTabs(KASA_FILTERS, state.kasaFilter, (value) => { state.kasaFilter = value; render(); }));
  const section = h("section", { class: "table-section kasa-moves" });
  const title = h("h2", { text: `Kasa Hareketleri · ${new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}` });
  if (rows.length) title.append(h("button", {
    type: "button", class: "csv-btn", text: "CSV", title: "Excel için CSV indir",
    onclick: () => downloadCsv(`kasa_${day}`, [["Tarih", "tarih"], ["Hesap", "hesap"], ["Para", "para_birimi"], ["Tür", "tur_text"], ["Cari", "cari"], ["Açıklama", "aciklama"], ["Yön", "yon"], ["Tutar", "tutar"], ["Komisyon", "komisyon"], ["Kur", "kur"], ["Kaynak", "kaynak"], ["Kullanıcı", "kullanici"]], rows),
  }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Bu gün kasa hareketi yok." }));
  else {
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Hesap", "Tür", "Cari", "Açıklama", "Giriş", "Çıkış", "Komisyon", "Kaynak", "Kullanıcı", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    rows.forEach((m) => {
      const del = (m.duzenlenebilir || m.grup) && writable ? h("button", {
        type: "button", class: "icon-btn icon-delete", title: m.grup ? "Transferi sil (iki taraf)" : "Sil", "aria-label": "Sil", html: iconSvg("delete"),
        onclick: async () => {
          if (!(await showConfirm(m.grup ? "Bu transferin iki tarafı da silinsin mi" : "Bu kasa hareketi silinsin mi", "Sil", "İptal"))) return;
          try { await api(`/api/kasa/hareket/${m.id}`, { method: "DELETE" }); showMessage("Silindi."); render(); } catch (error) { showMessage(error.message, true); }
        },
      }) : null;
      body.append(h("tr", {},
        h("td", { dataset: { label: "Hesap" }, text: m.hesap }),
        h("td", { dataset: { label: "Tür" }, text: m.tur_text }),
        h("td", { dataset: { label: "Cari" }, text: m.cari }),
        h("td", { dataset: { label: "Açıklama" }, text: m.aciklama + (m.kur && m.kategori !== "DOVIZ" ? ` (kur ${formatTurkishNumber(m.kur, 2, 4)})` : "") }),
        h("td", { class: "num pos", dataset: { label: "Giriş" }, text: m.yon === "GIRIS" ? fmtMoney(m.tutar, m.para_birimi) : "" }),
        h("td", { class: "num neg", dataset: { label: "Çıkış" }, text: m.yon === "CIKIS" ? fmtMoney(m.tutar, m.para_birimi) : "" }),
        h("td", { class: "num", dataset: { label: "Komisyon" }, text: m.komisyon ? fmtMoney(m.komisyon, m.para_birimi) : "" }),
        h("td", { dataset: { label: "Kaynak" }, text: m.kaynak }),
        h("td", { dataset: { label: "Kullanıcı" }, text: m.kullanici || "" }),
        h("td", { class: "actions-cell", dataset: { label: "İşlemler" } }, del)));
    });
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  return root;
};

function openKasaMovement(day) {
  const { box, close } = openModal("Gelir / Gider", "kasa-modal");
  const form = h("form", { class: "settings-form kasa-form" });
  const kategori = h("select", { name: "kategori" }, ...[["GELIR", "Gelir (kasaya giriş)"], ["GIDER", "Gider (kasadan çıkış)"], ["DEVIR", "Devir / açılış bakiyesi"], ["DIGER", "Diğer"]].map(([v, t]) => new Option(t, v)));
  const yon = h("select", { name: "yon" }, new Option("Giriş", "GIRIS"), new Option("Çıkış", "CIKIS"));
  const yonField = labeled("Yön", yon);
  const hesap = accountOptions(h("select", { name: "hesap_id" }));
  const tarih = h("input", { type: "date", name: "tarih", value: day });
  const tutar = decimalInput("tutar", "0,00");
  const cari = h("input", { name: "cari", autocomplete: "off", placeholder: "İsteğe bağlı" });
  const aciklama = h("input", { name: "aciklama", maxlength: 300, placeholder: "Örn. dükkân kirası, elektrik faturası" });
  const sync = () => { yonField.hidden = ["GELIR", "GIDER"].includes(kategori.value); if (kategori.value === "DEVIR") yon.value = "GIRIS"; };
  kategori.addEventListener("change", sync); sync();
  const save = h("button", { type: "submit", text: "Kaydet" });
  form.append(labeled("Tarih", tarih), labeled("Tür", kategori), yonField, labeled("Hesap", hesap), labeled("Tutar", tutar), labeled("Cari / kişi", cari), labeled("Açıklama", aciklama),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "İptal", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      await api("/api/kasa/hareket", { method: "POST", body: JSON.stringify({ tarih: tarih.value, kategori: kategori.value, yon: yon.value, hesap_id: Number(hesap.value), tutar: tutar.value, cari: cari.value, aciklama: aciklama.value }) });
      close(); showMessage("Kasa hareketi kaydedildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); tutar.focus();
}

function openTransfer(day) {
  const { box, close } = openModal("Hesaplar arası transfer", "kasa-modal");
  const form = h("form", { class: "settings-form kasa-form" });
  const from = accountOptions(h("select", { name: "kaynak_id" }));
  const to = accountOptions(h("select", { name: "hedef_id" }));
  const trys = state.kasaHesaplar.filter((a) => a.aktif && a.para_birimi === "TRY");
  if (trys[0]) from.value = String(trys[0].id);
  if (trys[1]) to.value = String(trys.find((a) => a.tur === "BANKA")?.id || trys[1].id);
  const tarih = h("input", { type: "date", name: "tarih", value: day });
  const tutar = decimalInput("tutar", "0,00");
  const hedef = decimalInput("hedef_tutar", "Karşılık tutarı");
  const hedefField = labeled("Giriş hesabına geçen tutar", hedef);
  const aciklama = h("input", { name: "aciklama", maxlength: 300, placeholder: "Örn. bankaya yatırılan" });
  const sync = () => { hedefField.hidden = accountById(from.value)?.para_birimi === accountById(to.value)?.para_birimi; };
  [from, to].forEach((s) => s.addEventListener("change", sync)); sync();
  const save = h("button", { type: "submit", text: "Transferi kaydet" });
  form.append(labeled("Tarih", tarih), labeled("Çıkış hesabı", from), labeled("Giriş hesabı", to), labeled("Tutar (çıkış hesabının parası)", tutar), hedefField, labeled("Açıklama", aciklama),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "İptal", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      await api("/api/kasa/transfer", { method: "POST", body: JSON.stringify({ tarih: tarih.value, kaynak_id: Number(from.value), hedef_id: Number(to.value), tutar: tutar.value, hedef_tutar: hedef.value, aciklama: aciklama.value }) });
      close(); showMessage("Transfer kaydedildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); tutar.focus();
}

async function openGunSonu(day) {
  const { box, close } = openModal(`Gün sonu · ${new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR")}`, "kasa-modal gun-sonu-modal");
  let data;
  try { data = await api(`/api/kasa/gun-sonu?tarih=${day}`); } catch (error) { showMessage(error.message, true); close(); return; }
  const form = h("form", { class: "gun-sonu-form" });
  if (data.kapali) form.append(h("p", { class: "hint", text: `Bu gün ${data.kapanis.kullanici || ""} tarafından kapatıldı (${new Date(`${data.kapanis.zaman}Z`).toLocaleString("tr-TR")}). Yeniden kaydederseniz sayım güncellenir.` }));
  const table = h("table", { class: "gun-sonu-table" }, h("thead", {}, h("tr", {}, ...["Hesap", "Devir", "Giriş", "Çıkış", "Komisyon", "Beklenen", "Sayılan", "Fark"].map((t) => h("th", { text: t })))));
  const body = h("tbody");
  const inputs = [];
  data.hesaplar.forEach((a) => {
    const input = decimalInput(`sayilan_${a.hesap_id}`, amountText(a.beklenen) || "0");
    if (a.sayilan !== null) input.value = amountText(a.sayilan) || "0";
    const fark = h("td", { class: "num", dataset: { label: "Fark" } });
    const sync = () => {
      if (!input.value.trim()) { fark.textContent = ""; fark.className = "num"; return; }
      const diff = Math.round((readAmount(input.value) - a.beklenen) * 100) / 100;
      fark.textContent = fmtMoney(diff, a.para_birimi);
      fark.className = `num ${diff < 0 ? "neg" : diff > 0 ? "pos" : ""}`;
    };
    input.addEventListener("input", sync); sync();
    inputs.push([a, input]);
    body.append(h("tr", { class: a.degisti ? "gun-sonu-changed" : "" },
      h("td", { dataset: { label: "Hesap" } }, a.ad, a.degisti ? h("small", { class: "warn-text", text: " kapanıştan sonra değişti" }) : null),
      ...["devir", "giris", "cikis", "komisyon", "beklenen"].map((k) => h("td", { class: `num ${k === "beklenen" ? "strong" : ""}`, dataset: { label: k }, text: fmtMoney(a[k], a.para_birimi) })),
      h("td", { dataset: { label: "Sayılan" } }, input), fark));
  });
  table.append(body);
  const notlar = h("textarea", { rows: 2, maxlength: 500, placeholder: "Not (isteğe bağlı)" });
  if (data.kapanis?.notlar) notlar.value = data.kapanis.notlar;
  const fillAll = h("button", { type: "button", class: "secondary", text: "Beklenenleri yaz", onclick: () => inputs.forEach(([a, input]) => { input.value = amountText(a.beklenen) || "0"; input.dispatchEvent(new Event("input")); }) });
  const printBtn = h("button", { type: "button", class: "secondary", text: "Yazdır", onclick: () => printGunSonu(data, inputs) });
  const save = h("button", { type: "submit", text: data.kapali ? "Sayımı güncelle" : "Gün sonunu kapat" });
  const dovizRows = (data.doviz || []).filter((x) => x.islem || x.iptal);
  const dovizBox = dovizRows.length ? h("div", { class: "gun-sonu-doviz" }, h("h3", { text: "Günün döviz alış-satışı" }),
    h("table", { class: "gun-sonu-table" }, h("thead", {}, h("tr", {}, ...["Döviz", "Alınan", "Satılan", "Alış TL", "Satış TL", "Kâr", "İptal"].map((t) => h("th", { text: t })))),
      h("tbody", {}, ...dovizRows.map((x) => h("tr", {}, h("td", { text: CUR_NAME[x.doviz] || x.doviz }), h("td", { class: "num", text: fmtMoney(x.alis_miktar, x.doviz) }), h("td", { class: "num", text: fmtMoney(x.satis_miktar, x.doviz) }),
        h("td", { class: "num", text: fmtMoney(x.alis_tl) }), h("td", { class: "num", text: fmtMoney(x.satis_tl) }), h("td", { class: "num", text: fmtMoney(x.kar_tl) }), h("td", { class: "num", text: String(x.iptal || "") })))))) : null;
  form.append(h("div", { class: "table-wrap" }, table), dovizBox, labeled("Not", notlar),
    h("div", { class: "form-bottom-actions" }, fillAll, printBtn, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const sayimlar = inputs.filter(([, input]) => input.value.trim()).map(([a, input]) => ({ hesap_id: a.hesap_id, sayilan: String(readAmount(input.value)) }));
    if (!sayimlar.length) { showMessage("En az bir hesabın sayımını girin.", true); return; }
    save.disabled = true;
    try {
      await api("/api/kasa/gun-sonu", { method: "POST", body: JSON.stringify({ tarih: day, sayimlar, notlar: notlar.value }) });
      close(); showMessage("Gün sonu kaydedildi."); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form);
}

async function openAccountsDialog() {
  const { box } = openModal("Kasa hesapları", "kasa-modal");
  const list = h("div", { class: "account-users kasa-account-list" });
  const load = async () => {
    const rows = await loadKasaAccounts();
    list.replaceChildren(...rows.map((a) => {
      const oran = decimalInput("komisyon_orani", "0"); oran.value = a.komisyon_orani ? String(a.komisyon_orani).replace(".", ",") : "";
      oran.title = "POS komisyon oranı (%)";
      const update = async (changes) => { try { await api(`/api/kasa/hesaplar/${a.id}`, { method: "PUT", body: JSON.stringify(changes) }); await load(); render(); } catch (error) { showMessage(error.message, true); } };
      oran.addEventListener("change", () => update({ komisyon_orani: oran.value || "0" }));
      const remove = async () => {
        if (!(await showConfirm(`${a.ad} hesabı silinsin mi`, "Sil", "İptal"))) return;
        try { await api(`/api/kasa/hesaplar/${a.id}`, { method: "DELETE" }); showMessage("Hesap silindi."); await load(); render(); } catch (error) { showMessage(error.message, true); }
      };
      return h("div", { class: `account-user ${a.aktif ? "" : "inactive"}` },
        h("span", { text: `${a.ad} · ${ACCOUNT_TYPE_LABEL[a.tur]} · ${a.para_birimi} · ${fmtMoney(a.bakiye, a.para_birimi)}` }),
        a.tur === "POS" ? h("label", { class: "kasa-oran" }, "Komisyon %", oran) : h("span"),
        a.hareket_sayisi === 0 && !a.varsayilan
          ? h("button", { type: "button", class: "secondary danger-text", text: "Sil", title: "Hiç hareketi olmayan hesap silinebilir", onclick: () => remove() })
          : h("button", { type: "button", class: "secondary", text: a.aktif ? "Pasif yap" : "Aktif yap", onclick: () => update({ aktif: !a.aktif }) }));
    }));
  };
  const add = h("form", { class: "settings-form account-add" });
  const ad = h("input", { name: "ad", required: true, placeholder: "Örn. Ziraat POS" });
  const tur = h("select", { name: "tur" }, ...Object.entries(ACCOUNT_TYPE_LABEL).map(([v, t]) => new Option(t, v)));
  const cur = h("select", { name: "para_birimi" }, ...Object.entries(CUR_NAME).map(([v, t]) => new Option(t, v)));
  const oran = decimalInput("komisyon_orani", "0");
  add.append(labeled("Hesap adı", ad), labeled("Tür", tur), labeled("Para birimi", cur), labeled("POS komisyon %", oran),
    h("div", { class: "form-bottom-actions" }, h("button", { type: "submit", text: "Hesap ekle" })));
  add.onsubmit = async (event) => {
    event.preventDefault();
    try { await api("/api/kasa/hesaplar", { method: "POST", body: JSON.stringify({ ad: ad.value, tur: tur.value, para_birimi: cur.value, komisyon_orani: oran.value }) }); ad.value = oran.value = ""; showMessage("Hesap eklendi."); await load(); render(); }
    catch (error) { showMessage(error.message, true); }
  };
  box.append(h("p", { class: "settings-intro", text: "Sonradan eklediğiniz hesap, hiç hareketi yoksa silinebilir; hareketi olan ve programla gelen hesaplar silinmez, pasif yapılır. POS hesabında komisyon oranı girerseniz kart tahsilatlarından düşülür." }), list, h("h3", { class: "account-subtitle", text: "Yeni hesap" }), add);
  load().catch((error) => showMessage(error.message, true));
}

/* ------------------------------------------------------------------ */
/* Emanet ekranı                                                       */
/* ------------------------------------------------------------------ */

let emanetEditing = null;

extraViews.emanet = async () => {
  const data = await api("/api/emanet");
  const root = h("div", { class: "emanet-root" });
  const o = data.ozet;
  const paraText = Object.entries(o.alinan_para).map(([cur, v]) => fmtMoney(v, cur)).join(" + ") || "0";
  root.append(h("div", { class: "kasa-totals emanet-summary" },
    h("article", { class: "kasa-total" }, h("span", { text: "Açık emanet" }), h("strong", { text: String(o.acik_sayisi) })),
    h("article", { class: "kasa-total" }, h("span", { text: "Müşteriden alınan has" }), h("strong", { text: `${formatValue("has", o.alinan_has)} gr` })),
    h("article", { class: "kasa-total" }, h("span", { text: "Müşteriden alınan para" }), h("strong", { text: paraText })),
    h("article", { class: "kasa-total" }, h("span", { text: "Bizim bıraktığımız has" }), h("strong", { text: `${formatValue("has", o.verilen_has)} gr` }))));
  if (currentUser?.role !== "viewer") root.append(renderEmanetForm());
  root.append(renderTabs([["ACIK", "AÇIK EMANETLER"], ["IADE", "TESLİM EDİLENLER"], ["ALL", "TÜMÜ"]], state.emanetFilter, (value) => { state.emanetFilter = value; render(); }));
  const rows = filteredRows(data.kayitlar.filter((r) => state.emanetFilter === "ALL" || r.durum === state.emanetFilter).map((r) => ({
    ...r,
    yon_text: r.yon === "ALINAN" ? "Müşteriden alındı" : "Bizden verildi",
    emanet_text: r.tur === "PARA" ? fmtMoney(r.tutar, r.para_birimi) : `${r.adet ? `${formatTurkishNumber(r.adet)} adet ` : ""}${r.cinsi} ${r.ayar}`.trim(),
    durum_text: r.durum === "ACIK" ? "Açık" : `Teslim edildi ${trDate(r.iade_tarihi)}`,
  })));
  const section = h("section", { class: "table-section" });
  const title = h("h2", { text: "Emanet Kayıtları" });
  if (rows.length) title.append(h("button", { type: "button", class: "csv-btn", text: "CSV", onclick: () => downloadCsv("emanetler", [["Tarih", "tarih"], ["Kişi", "kisi"], ["Telefon", "telefon"], ["Yön", "yon_text"], ["Emanet", "emanet_text"], ["Gram", "gram"], ["Milyem", "milyem"], ["Has", "has"], ["Durum", "durum_text"], ["Not", "notlar"]], rows) }));
  section.append(title);
  const wrap = h("div", { class: "table-wrap" });
  if (!rows.length) wrap.append(h("div", { class: "empty", text: "Kayıt yok." }));
  else {
    const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Tarih", "Kişi", "Telefon", "Yön", "Emanet", "Gram", "Has (gr)", "Durum", "Not", "İşlemler"].map((t) => h("th", { text: t })))));
    const body = h("tbody");
    const writable = currentUser?.role !== "viewer";
    rows.forEach((r) => body.append(h("tr", { class: r.durum === "IADE" ? "row-closed" : "" },
      h("td", { dataset: { label: "Tarih" }, text: trDate(r.tarih) }),
      h("td", { dataset: { label: "Kişi" }, text: r.kisi }),
      h("td", { dataset: { label: "Telefon" }, text: r.telefon }),
      h("td", { dataset: { label: "Yön" }, text: r.yon_text }),
      h("td", { dataset: { label: "Emanet" }, text: r.emanet_text }),
      h("td", { class: "num", dataset: { label: "Gram" }, text: r.tur === "ALTIN" ? formatValue("gram", r.gram) : "" }),
      h("td", { class: "num", dataset: { label: "Has" }, text: r.tur === "ALTIN" ? formatValue("has", r.has) : "" }),
      h("td", { dataset: { label: "Durum" } }, h("span", { class: `status-pill ${r.durum === "ACIK" ? "open" : "closed"}`, text: r.durum_text })),
      h("td", { class: "note-cell", dataset: { label: "Not" } }, r.notlar ? h("button", { type: "button", class: "note-preview", text: r.notlar, onclick: () => openNote(r.notlar) }) : null),
      h("td", { class: "actions-cell", dataset: { label: "İşlemler" } },
        h("button", { type: "button", class: "icon-btn", title: "Makbuz yazdır", "aria-label": "Makbuz yazdır", html: printIcon(), onclick: () => printReceipt("emanet", r) }),
        writable ? h("button", {
          type: "button", class: `secondary emanet-toggle`, text: r.durum === "ACIK" ? "Teslim et" : "Geri aç",
          onclick: async () => {
            const closing = r.durum === "ACIK";
            if (!(await showConfirm(closing ? `${r.kisi} emaneti teslim edildi olarak kapatılsın mı` : "Emanet yeniden açılsın mı", closing ? "Teslim et" : "Geri aç", "İptal"))) return;
            try { await api(`/api/emanet/${r.id}/iade`, { method: "POST", body: JSON.stringify({ iade: closing, tarih: today() }) }); render(); } catch (error) { showMessage(error.message, true); }
          },
        }) : null,
        writable ? h("button", { type: "button", class: "icon-btn icon-edit", title: "Düzenle", "aria-label": "Düzenle", html: iconSvg("edit"), onclick: () => { emanetEditing = r; render(); } }) : null,
        writable ? h("button", {
          type: "button", class: "icon-btn icon-delete", title: "Sil", "aria-label": "Sil", html: iconSvg("delete"),
          onclick: async () => { if (await showConfirm("Bu emanet kaydı silinsin mi", "Sil", "İptal")) { try { await api(`/api/emanet/${r.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } },
        }) : null))));
    table.append(body); wrap.append(table);
  }
  section.append(wrap); root.append(section);
  return root;
};

function renderEmanetForm() {
  const edit = emanetEditing;
  const panel = h("section", { class: "panel form-panel emanet-form-panel" });
  const form = h("form", { class: "entry-form emanet-form" });
  let tur = edit?.tur || "ALTIN";
  const tabs = h("div", { class: "payment-type-tabs emanet-tabs" });
  [["ALTIN", "Altın emanet"], ["PARA", "Para emanet"]].forEach(([value, text]) => tabs.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => { tur = value; sync(); } })));
  const tarih = h("input", { type: "date", name: "tarih", value: edit?.tarih || today() });
  const yon = h("select", { name: "yon" }, new Option("Müşteriden alındı (bizde)", "ALINAN"), new Option("Bizden verildi (karşıda)", "VERILEN"));
  const kisi = h("input", { name: "kisi", required: true, autocomplete: "off" });
  const telefon = h("input", { name: "telefon", inputmode: "tel", autocomplete: "off" });
  const cinsi = h("input", { name: "cinsi", autocomplete: "off" });
  const ayar = h("input", { name: "ayar", autocomplete: "off" });
  const adet = decimalInput("adet"); const gram = decimalInput("gram"); const milyem = decimalInput("milyem");
  const tutar = decimalInput("tutar");
  const para = h("select", { name: "para_birimi" }, ...Object.entries(CUR_NAME).map(([v, t]) => new Option(t, v)));
  const notlar = h("textarea", { name: "notlar", rows: 1, maxlength: 500 });
  const hasOut = h("strong", { text: "0" });
  const goldFields = [labeled("Cinsi", cinsi), labeled("Ayar", ayar), labeled("Adet", adet), labeled("Gram", gram), labeled("Milyem", milyem),
    h("div", { class: "has-preview" }, h("span", { text: "Has" }), hasOut)];
  const moneyFields_ = [labeled("Tutar", tutar), labeled("Para birimi", para)];
  form.append(tabs, labeled("Tarih", tarih), labeled("Yön", yon), labeled("Kişi", kisi), labeled("Telefon", telefon), ...goldFields, ...moneyFields_, labeled("Not", notlar));
  // Sarrafiye: adet girilince gram, düğmeyle cinsi/ayar/milyem dolar.
  const chips = h("div", { class: "sarrafiye-chips" }, h("span", { class: "sarrafiye-label", text: "Sarrafiye:" }),
    ...SARRAFIYE.map(([name, g, a, m]) => h("button", { type: "button", class: "sarrafiye-chip", text: name, onclick: () => { cinsi.value = name; ayar.value = a; milyem.value = String(m); if (!readAmount(adet.value)) adet.value = "1"; fill(); adet.focus(); } })));
  goldFields.unshift(chips); tabs.after(chips);
  const fill = () => { const preset = sarrafiyeOf(cinsi.value); if (preset && readAmount(adet.value) > 0) gram.value = String(Math.round(readAmount(adet.value) * preset[1] * 1000) / 1000).replace(".", ","); updateHas(); };
  const updateHas = () => { hasOut.textContent = formatValue("has", readAmount(gram.value) * readAmount(milyem.value) / 1000); };
  adet.addEventListener("input", fill); [gram, milyem].forEach((i) => i.addEventListener("input", updateHas));
  attachAutocomplete(kisi, "people"); attachAutocomplete(cinsi, "products");
  const sync = () => {
    tabs.querySelectorAll(".payment-type-tab").forEach((t) => t.classList.toggle("active", t.dataset.value === tur));
    goldFields.forEach((f) => { f.hidden = tur !== "ALTIN"; });
    moneyFields_.forEach((f) => { f.hidden = tur !== "PARA"; });
  };
  if (edit) {
    yon.value = edit.yon; kisi.value = edit.kisi; telefon.value = edit.telefon || ""; cinsi.value = edit.cinsi; ayar.value = edit.ayar;
    adet.value = amountText(edit.adet); gram.value = amountText(edit.gram); milyem.value = amountText(edit.milyem);
    tutar.value = amountText(edit.tutar); para.value = edit.para_birimi || "TRY"; notlar.value = edit.notlar || "";
  }
  sync(); updateHas();
  const save = h("button", { type: "submit", text: edit ? "Güncelle" : "Emaneti kaydet" });
  const actions = h("div", { class: "form-bottom-actions" }, save);
  if (edit) actions.append(h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { emanetEditing = null; render(); } }));
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const payload = { tarih: tarih.value, yon: yon.value, tur, kisi: kisi.value, telefon: telefon.value, notlar: notlar.value,
      cinsi: cinsi.value, ayar: ayar.value, adet: String(readAmount(adet.value)), gram: String(readAmount(gram.value)), milyem: String(readAmount(milyem.value)),
      tutar: String(readAmount(tutar.value)), para_birimi: para.value };
    save.disabled = true;
    try {
      await api(edit ? `/api/emanet/${edit.id}` : "/api/emanet", { method: edit ? "PUT" : "POST", body: JSON.stringify(payload) });
      showMessage(edit ? "Emanet güncellendi." : "Emanet kaydedildi.");
      emanetEditing = null; await refreshSuggestions(); render();
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.append(form);
  return panel;
}

/* ------------------------------------------------------------------ */
/* Fiş / makbuz yazdırma                                               */
/* ------------------------------------------------------------------ */

let firmaCache = null;
async function loadFirma() {
  if (!firmaCache) { try { firmaCache = await api("/api/firma"); } catch { firmaCache = { ad: "Dünyatek Kuyumcu" }; } }
  return firmaCache;
}

function printIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5"></path><path d="M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M7 14h10v7H7z"></path></svg>';
}

function printButton(kind, row) {
  return h("button", { type: "button", class: "icon-btn icon-print", title: "Fiş yazdır", "aria-label": "Fiş yazdır", html: printIcon(), onclick: () => printReceipt(kind, row) });
}

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/**
 * Yazdırılacak belgeyi küçük, ayrı bir pencerede açar; yazdırma önizlemesi orada görünür.
 * Böylece önizlemeyi kapatmak isteyen kullanıcı programın penceresini kapatmaz.
 * Pencere açılamazsa (engellendiyse) belge görünmez bir çerçevede yazdırılır.
 */
function printDocument(html, size = "width=520,height=760") {
  let win = null;
  try { win = window.open("", "dunyatek_yazdir", `popup,${size}`); } catch { win = null; }
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    let closed = false;
    const done = () => { if (!closed) { closed = true; setTimeout(() => { try { win.close(); } catch { /* kapalı */ } window.focus(); }, 300); } };
    win.addEventListener("afterprint", done);
    setTimeout(() => { win.focus(); win.print(); }, 250);
    return;
  }
  const frame = h("iframe", { class: "print-frame", title: "Yazdırma", "aria-hidden": "true" });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.addEventListener("afterprint", done);
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(done, 60000); }, 150);
}

function printHtml(title, inner) {
  printDocument(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font: 12px/1.45 "Courier New", monospace; color: #000; margin: 0; width: 72mm; }
    h1 { font-size: 15px; text-align: center; margin: 0 0 2px; } h2 { font-size: 13px; text-align: center; margin: 8px 0 6px; letter-spacing: .08em; }
    .c { text-align: center; } .muted { color: #333; font-size: 11px; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; } td.r { text-align: right; white-space: nowrap; }
    .total td { font-weight: bold; font-size: 13px; border-top: 1px solid #000; padding-top: 3px; } .sign { margin-top: 26px; display: flex; justify-content: space-between; font-size: 11px; }
  </style></head><body>${inner}</body></html>`);
}

function receiptHeader(firma, title, no, tarih) {
  return `<h1>${esc(firma.ad)}</h1>${firma.adres ? `<div class="c muted">${esc(firma.adres)}</div>` : ""}${firma.telefon ? `<div class="c muted">Tel: ${esc(firma.telefon)}</div>` : ""}${firma.vergi ? `<div class="c muted">${esc(firma.vergi)}</div>` : ""}
    <h2>${esc(title)}</h2><table><tr><td>Fiş no: ${esc(no)}</td><td class="r">${esc(new Date(`${tarih}T12:00:00`).toLocaleDateString("tr-TR"))}</td></tr></table><hr>`;
}

function receiptFooter(firma) {
  return `<hr>${firma.fis_notu ? `<div class="c">${esc(firma.fis_notu)}</div>` : ""}<div class="c muted">Bu belge mali değeri olmayan bilgi fişidir.</div>
    <div class="sign"><span>Teslim eden</span><span>Teslim alan</span></div>`;
}

async function printReceipt(kind, row) {
  const firma = await loadFirma();
  const line = (label, value) => value === "" || value === null || value === undefined ? "" : `<tr><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const tl = (v) => fmtMoney(v);
  let inner = "";
  if (kind === "emanet") {
    const title = row.yon === "ALINAN" ? "EMANET MAKBUZU" : "EMANET TESLİM BELGESİ";
    inner = receiptHeader(firma, title, `E-${row.id}`, row.tarih) + `<table>${line("Kişi", row.kisi)}${line("Telefon", row.telefon)}</table><hr><table>
      ${row.tur === "PARA" ? line("Tutar", fmtMoney(row.tutar, row.para_birimi)) : `${line("Cinsi", `${row.cinsi} ${row.ayar}`)}${line("Adet", row.adet ? formatTurkishNumber(row.adet) : "")}${line("Gram", formatValue("gram", row.gram))}${line("Milyem", row.milyem ? formatValue("milyem", row.milyem) : "")}${line("Has", row.has ? `${formatValue("has", row.has)} gr` : "")}`}
      ${line("Durum", row.durum === "ACIK" ? "Emanette" : `Teslim edildi ${trDate(row.iade_tarihi)}`)}</table>${row.notlar ? `<div class="muted">Not: ${esc(row.notlar)}</div>` : ""}` + receiptFooter(firma);
  } else if (kind === "cari") {
    inner = receiptHeader(firma, row.yon === "ODEME" ? "ÖDEME MAKBUZU" : "TAHSİLAT MAKBUZU", `C-${row.id}`, row.tarih) + `<table>${line("Cari", row.isim)}${line("İşlem has", `${formatValue("has", row.odenen_has)} gr`)}
      ${(row.kasa_odemeleri || []).map((k) => line(k.hesap, fmtMoney(k.tutar, k.para_birimi))).join("")}</table>${row.not ? `<div class="muted">Not: ${esc(row.not)}</div>` : ""}` + receiptFooter(firma);
  } else {
    const sale = kind === "satis" || (kind === "hurda" && normalize(row.islem_turu).startsWith("satis"));
    const person = row.musteri || row.tedarikci || row.kisi;
    const title = kind === "hurda" ? (sale ? "HURDA SATIŞ FİŞİ" : "HURDA ALIŞ MAKBUZU") : sale ? "SATIŞ FİŞİ" : "ALIŞ MAKBUZU";
    const milyem = sale ? (row.satis_milyem ?? row.milyem) : row.milyem;
    const payments = row.kasa_odemeleri || [];
    const paid = payments.reduce((sum, k) => sum + k.tutar * (k.kur || 1), 0);
    inner = receiptHeader(firma, title, `${kind === "satis" ? "S" : kind === "alis" ? "A" : "H"}-${row.id}`, row.tarih) + `<table>${line(sale ? "Müşteri" : "Satıcı", person)}</table><hr><table>
      ${line("Ürün", `${row.cinsi} ${row.ayar}`)}${line("Adet", row.adet ? formatTurkishNumber(row.adet) : "")}${line("Gram", formatValue("gram", row.gram))}${line("Milyem", formatValue("milyem", milyem))}${line("Has", `${formatValue("has", row.has)} gr`)}
      ${row.has_fiyati ? line("Has fiyatı", tl(row.has_fiyati)) : ""}${row.iscilik ? line("İşçilik", tl(row.iscilik)) : ""}
      ${row.toplam_tutar ? `<tr class="total"><td>TOPLAM</td><td class="r">${esc(tl(row.toplam_tutar))}</td></tr>` : ""}</table>
      ${payments.length ? `<hr><table>${payments.map((k) => line(k.hesap, fmtMoney(k.tutar, k.para_birimi) + (k.kur ? ` (${formatTurkishNumber(k.kur, 2, 4)})` : ""))).join("")}${row.toplam_tutar && paid < row.toplam_tutar - 0.01 ? line("Kalan", tl(row.toplam_tutar - paid)) : ""}</table>` : ""}
      ${row.odeme_tipi && row.odeme_tipi !== "ODEME_YOK" && !payments.length ? `<hr><table>${line("Ödeme", paymentLabel(row.odeme_tipi))}${line("Ödenen has", `${formatValue("has", row.odenen_has)} gr`)}</table>` : ""}
      ${row.not ? `<div class="muted">Not: ${esc(row.not)}</div>` : ""}` + receiptFooter(firma);
  }
  printHtml("Fiş", inner);
}

function printGunSonu(data, inputs) {
  loadFirma().then((firma) => {
    const rows = data.hesaplar.map((a) => {
      const counted = inputs.find(([x]) => x.hesap_id === a.hesap_id)?.[1].value;
      const say = counted ? readAmount(counted) : a.sayilan;
      return `<tr><td colspan="2"><b>${esc(a.ad)}</b></td></tr><tr><td>Devir</td><td class="r">${esc(fmtMoney(a.devir, a.para_birimi))}</td></tr>
        <tr><td>Giriş</td><td class="r">${esc(fmtMoney(a.giris, a.para_birimi))}</td></tr><tr><td>Çıkış</td><td class="r">${esc(fmtMoney(a.cikis, a.para_birimi))}</td></tr>
        ${a.komisyon ? `<tr><td>Komisyon</td><td class="r">${esc(fmtMoney(a.komisyon, a.para_birimi))}</td></tr>` : ""}
        <tr><td>Beklenen</td><td class="r">${esc(fmtMoney(a.beklenen, a.para_birimi))}</td></tr>
        ${say !== null && say !== undefined ? `<tr><td>Sayılan</td><td class="r">${esc(fmtMoney(say, a.para_birimi))}</td></tr><tr><td>Fark</td><td class="r">${esc(fmtMoney(Math.round((say - a.beklenen) * 100) / 100, a.para_birimi))}</td></tr>` : ""}`;
    }).join('<tr><td colspan="2"><hr></td></tr>');
    const doviz = (data.doviz || []).filter((x) => x.islem || x.iptal).map((x) => `<tr><td colspan="2"><b>Döviz ${esc(CUR_NAME[x.doviz] || x.doviz)}</b></td></tr>
      <tr><td>Alınan</td><td class="r">${esc(fmtMoney(x.alis_miktar, x.doviz))} / ${esc(fmtMoney(x.alis_tl))}</td></tr><tr><td>Satılan</td><td class="r">${esc(fmtMoney(x.satis_miktar, x.doviz))} / ${esc(fmtMoney(x.satis_tl))}</td></tr>
      <tr><td>Döviz kârı</td><td class="r">${esc(fmtMoney(x.kar_tl))}</td></tr>${x.iptal ? `<tr><td>İptal</td><td class="r">${x.iptal}</td></tr>` : ""}`).join("");
    printHtml("Gün sonu", receiptHeader(firma, "GÜN SONU RAPORU", trDate(data.tarih), data.tarih) + `<table>${rows}</table>${doviz ? `<hr><table>${doviz}</table>` : ""}<hr><div class="c muted">Yazdırma: ${esc(new Date().toLocaleString("tr-TR"))} · ${esc(currentUser?.name || "")}</div>`);
  });
}

/** İşyeri logosu: seçilen resim en fazla 600 px'e küçültülüp PNG olarak kaydedilir; fiyat panosunda görünür. */
function firmaLogoField(firma) {
  const preview = h("img", { class: "logo-preview", alt: "İşyeri logosu", hidden: !firma.logo });
  if (firma.logo) preview.src = `/api/firma/logo?v=${Date.now()}`;
  const empty = h("span", { class: "hint", text: "Logo yüklenmedi.", hidden: !!firma.logo });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const remove = h("button", { type: "button", class: "secondary", text: "Logoyu kaldır", hidden: !firma.logo, disabled: !isAdmin() });
  const choose = h("button", { type: "button", class: "secondary", text: firma.logo ? "Logoyu değiştir" : "Logo seç", disabled: !isAdmin(), onclick: () => file.click() });
  const show = (on) => { preview.hidden = !on; empty.hidden = on; remove.hidden = !on; choose.textContent = on ? "Logoyu değiştir" : "Logo seç"; firmaCache = { ...(firmaCache || firma), logo: on }; };
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; file.value = "";
    if (!f) return;
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Resim okunamadı.")); i.src = URL.createObjectURL(f); });
      const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = h("canvas", { width: Math.max(1, Math.round(img.naturalWidth * scale)), height: Math.max(1, Math.round(img.naturalHeight * scale)) });
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      await api("/api/firma/logo", { method: "PUT", body: JSON.stringify({ data: canvas.toDataURL("image/png") }) });
      preview.src = `/api/firma/logo?v=${Date.now()}`; show(true); showMessage("Logo kaydedildi.");
    } catch (error) { showMessage(error.message, true); }
  });
  remove.addEventListener("click", async () => {
    try { await api("/api/firma/logo", { method: "PUT", body: JSON.stringify({ data: "" }) }); show(false); showMessage("Logo kaldırıldı."); }
    catch (error) { showMessage(error.message, true); }
  });
  return h("div", { class: "field field-main logo-field" }, h("span", { text: "İşyeri logosu (fiyat panosunda görünür)" }),
    h("div", { class: "logo-row" }, preview, empty, h("div", { class: "logo-actions" }, choose, remove)), file);
}

async function openFirmaDialog() {
  const { box, close } = openModal("Firma, logo ve fiş bilgileri", "kasa-modal");
  const firma = await loadFirma();
  const form = h("form", { class: "settings-form" });
  const fields = [["ad", "İşyeri adı"], ["adres", "Adres"], ["telefon", "Telefon"], ["vergi", "Vergi dairesi / no"], ["fis_notu", "Fiş alt notu"]];
  const inputs = Object.fromEntries(fields.map(([key]) => [key, h("input", { name: key, value: firma[key] || "", maxlength: 300, disabled: !isAdmin() })]));
  form.append(...fields.map(([key, text]) => labeled(text, inputs[key])));
  form.append(firmaLogoField(firma));
  if (!isAdmin()) form.append(h("p", { class: "hint", text: "Firma bilgilerini yönetici değiştirebilir." }));
  const save = h("button", { type: "submit", text: "Kaydet", disabled: !isAdmin() });
  form.append(h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try { firmaCache = await api("/api/firma", { method: "PUT", body: JSON.stringify(Object.fromEntries(fields.map(([key]) => [key, inputs[key].value]))) }); close(); showMessage("Firma bilgileri kaydedildi."); }
    catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form); inputs.ad.focus();
}

/* ------------------------------------------------------------------ */
/* Dashboard: bugünün özeti, 7 günlük grafik, hızlı işlemler           */
/* ------------------------------------------------------------------ */

function goView(view) {
  const button = document.querySelector(`.nav[data-view="${view}"]`);
  if (button) button.click();
}

function renderWeekChart(days) {
  const wrap = h("section", { class: "dashboard-panel week-chart" }, h("div", { class: "dashboard-panel-head" }, h("h2", { text: "Son 7 gün" }), h("p", { text: "Satış, alış ve kâr (TL)" })));
  const max = Math.max(1, ...days.map((d) => Math.max(d.satis_tl, d.alis_tl)));
  const pct = (v) => `${Math.max(v, 0) / max * 100}%`;
  const short = (v) => v >= 1e6 ? `${formatTurkishNumber(v / 1e6, 0, 1)} mn` : v >= 1e3 ? `${formatTurkishNumber(v / 1e3, 0, 1)} b` : formatTurkishNumber(v, 0, 0);
  const bars = h("div", { class: "chart-bars", role: "img", "aria-label": "Son 7 günün satış, alış ve kâr grafiği" });
  days.forEach((d) => bars.append(h("div", { class: "chart-day", title: `${trDate(d.tarih)}\nSatış ${fmtMoney(d.satis_tl)}\nAlış ${fmtMoney(d.alis_tl)}\nKâr ${fmtMoney(d.kar_tl)}` },
    h("span", { class: `chart-kar ${d.kar_tl < 0 ? "neg" : ""}`, text: d.kar_tl ? short(d.kar_tl) : "" }),
    h("div", { class: "chart-cols" }, h("i", { class: "bar-alis", style: `height:${pct(d.alis_tl)}` }), h("i", { class: "bar-satis", style: `height:${pct(d.satis_tl)}` })),
    h("span", { class: "chart-label", text: new Date(`${d.tarih}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "short", day: "numeric" }) }))));
  const legend = h("div", { class: "chart-legend" }, h("span", { class: "lg-satis", text: "Satış" }), h("span", { class: "lg-alis", text: "Alış" }), h("span", { class: "lg-kar", text: "Kâr (üstte)" }));
  const total = days.reduce((t, d) => ({ satis: t.satis + d.satis_tl, kar: t.kar + d.kar_tl }), { satis: 0, kar: 0 });
  wrap.append(bars, h("div", { class: "chart-foot" }, legend, h("span", { text: `7 gün: satış ${fmtMoney(total.satis)} \u00b7 kâr ${fmtMoney(total.kar)}` })));
  return wrap;
}

/** Dashboard'daki has ve kur kartlarını son okunan fiyatla günceller (loadPrice her yenilemede çağırır). */
function refreshPriceTiles(root = document) {
  root.querySelectorAll(".today-tile[data-fiyat]").forEach((t) => {
    const key = t.dataset.fiyat;
    const p = key === "HAS" ? state.price : state.kurlar?.[key];
    const value = !p ? (key === "HAS" ? "Girilmedi" : "—") : fmtMoney(p.satis);
    const note = !p ? (key === "HAS" ? "Fiyat düğmesinden girin" : "") : key === "HAS" ? `Alış ${fmtMoney(p.alis)} · ${p.kaynak === "canli" ? "canlı" : "elle"}` : `Alış ${fmtMoney(p.alis)}`;
    t.querySelector("strong").textContent = value;
    t.querySelector("small").textContent = note;
  });
}

function renderDashboardToday(data) {
  const root = h("div", { class: "dashboard-today" });
  const tiles = h("div", { class: "today-tiles" });
  const tile = (label, value, note = "", tone = "") => h("article", { class: `today-tile ${tone}` }, h("span", { text: label }), h("strong", { text: value }), note ? h("small", { text: note }) : null);
  const priceTile = (key, label, tone = "") => { const t = tile(label, "…", "…", tone); t.dataset.fiyat = key; return t; };
  tiles.append(priceTile("HAS", "Has altın (TL/gr)", "gold"));
  ["USD", "EUR"].forEach((cur) => { if (state.kurlar?.[cur]) tiles.append(priceTile(cur, `${CUR_NAME[cur]} kuru`)); });
  refreshPriceTiles(tiles);
  const kasaTile = tile("Kasadaki nakit TL", "…", "", "green");
  const todayTile = tile("Bugün kasaya giren", "…");
  const emanetTile = tile("Açık emanet", "…");
  const dovizTile = tile("Döviz kârı (bugün)", "…", "", "green");
  tiles.append(kasaTile, todayTile, emanetTile, dovizTile);
  api("/api/doviz/ozet").then((z) => {
    const kar = z.dovizler.reduce((t, x) => t + x.kar_tl, 0);
    dovizTile.querySelector("strong").textContent = fmtMoney(kar);
    const kasada = z.stok.filter((x) => x.toplam).map((x) => fmtMoney(x.toplam, x.doviz)).join(" · ");
    dovizTile.append(h("small", { text: `${z.dovizler.reduce((t, x) => t + x.islem, 0)} işlem${kasada ? ` · kasada ${kasada}` : ""}` }));
  }).catch(() => { dovizTile.querySelector("strong").textContent = "-"; });
  const quick = h("div", { class: "quick-actions" },
    h("button", { type: "button", text: "Yeni satış", onclick: () => goView("satis") }, h("kbd", { text: "F2" })),
    h("button", { type: "button", text: "Yeni alış", onclick: () => goView("alis") }, h("kbd", { text: "F3" })),
    h("button", { type: "button", text: "Döviz al / sat", onclick: () => goView("doviz") }),
    h("button", { type: "button", text: "Kasa", onclick: () => goView("kasa") }, h("kbd", { text: "F4" })),
    h("button", { type: "button", text: "Gün sonu", onclick: () => openGunSonu(state.serverToday || today()) }),
    h("button", { type: "button", text: "Emanet", onclick: () => goView("emanet") }, h("kbd", { text: "F8" })));
  root.append(tiles, quick, h("div", { class: "dashboard-today-row" }, renderWeekChart(data.son_7_gun || [])));
  Promise.all([api("/api/kasa"), api("/api/emanet")]).then(([kasa, emanet]) => {
    state.serverToday = kasa.tarih;
    const nakit = kasa.hesaplar.filter((a) => a.tur === "NAKIT" && a.para_birimi === "TRY").reduce((t, a) => t + a.bakiye, 0);
    kasaTile.querySelector("strong").textContent = fmtMoney(nakit);
    kasaTile.append(h("small", { text: kasa.gun_sonu_kapali ? "Gün sonu alındı" : "Gün açık" }));
    todayTile.querySelector("strong").textContent = fmtMoney(kasa.toplamlar.TRY?.giris || 0);
    todayTile.append(h("small", { text: `Çıkan ${fmtMoney(kasa.toplamlar.TRY?.cikis || 0)}` }));
    emanetTile.querySelector("strong").textContent = String(emanet.ozet.acik_sayisi);
    emanetTile.append(h("small", { text: `${formatValue("has", emanet.ozet.alinan_has)} gr has müşteriden` }));
  }).catch(() => { [kasaTile, todayTile, emanetTile].forEach((t) => { t.querySelector("strong").textContent = "-"; }); });
  return root;
}

/* ------------------------------------------------------------------ */
/* Klavye kısayolları                                                  */
/* ------------------------------------------------------------------ */

const SHORTCUTS = { F2: "satis", F3: "alis", F4: "kasa", F6: "cari", F7: "stok", F8: "emanet", F9: "dashboard" };

function openShortcutHelp() {
  const { box } = openModal("Klavye kısayolları", "kasa-modal");
  const names = { satis: "Satış", alis: "Alış", kasa: "Kasa", cari: "Cari", stok: "Stok", emanet: "Emanet", dashboard: "Dashboard" };
  box.append(h("table", { class: "shortcut-table" }, h("tbody", {},
    ...Object.entries(SHORTCUTS).map(([key, view]) => h("tr", {}, h("td", {}, h("kbd", { text: key })), h("td", { text: names[view] }))),
    h("tr", {}, h("td", {}, h("kbd", { text: "/" })), h("td", { text: "Aramaya git" })),
    h("tr", {}, h("td", {}, h("kbd", { text: "Esc" })), h("td", { text: "Pencereyi kapat" })),
    h("tr", {}, h("td", {}, h("kbd", { text: "?" })), h("td", { text: "Bu yardım" })))));
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector(".modal, .confirm-overlay")) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (SHORTCUTS[event.key]) { event.preventDefault(); goView(SHORTCUTS[event.key]); return; }
  if (typing) return;
  if (event.key === "/") { event.preventDefault(); search.focus(); }
  if (event.key === "?") { event.preventDefault(); openShortcutHelp(); }
});

/* Kur bandı (üst çubuk): USD, EUR */
function renderRateTicker() {
  const ticker = document.querySelector("#rateTicker");
  if (!ticker) return;
  ticker.replaceChildren(...["USD", "EUR"].filter((cur) => state.kurlar?.[cur]).map((cur) => h("span", { class: "rate-chip", title: `${CUR_NAME[cur]}: alış ${fmtMoney(state.kurlar[cur].alis)} / satış ${fmtMoney(state.kurlar[cur].satis)}` },
    h("b", { text: cur }), ` ${formatTurkishNumber(state.kurlar[cur].satis, 2, 2)}`)));
}

document.querySelector("#firmaBtn")?.addEventListener("click", openFirmaDialog);
document.querySelector("#shortcutBtn")?.addEventListener("click", openShortcutHelp);
document.querySelector("#manualBtn")?.addEventListener("click", () => window.open("/static/kilavuz/", "_blank", "noopener"));
