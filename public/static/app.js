
const state = {
  view: "dashboard",
  search: "",
  cariFilter: "all",
  cariData: null,
  hurdaKayitFilter: "all",
  hurdaScrollToRecords: false,
  stokFilter: "normal",
  selectedPurchase: null,
  selectedHurdaPurchase: null,
  suggestions: { products: ["B\u0130LEZ\u0130K", "Y\u00dcZ\u00dcK", "KOLYE", "K\u00dcPE", "B\u0130LEKL\u0130K", "Z\u0130NC\u0130R", "KOLYE UCU", "SET", "\u00c7EYREK", "YARIM", "TAM", "GRAM ALTIN", "RE\u015eAT", "RE\u015eAT \u00c7EYREK", "RE\u015eAT YARIM", "RE\u015eAT TAM", "RE\u015eAT GREMSE", "RE\u015eAT BE\u015eL\u0130", "ATA L\u0130RA", "CUMHUR\u0130YET", "GREMSE", "BE\u015eL\u0130", "D\u0130\u011eER"], customers: [], suppliers: [], people: [] },
};

const views = {
  giderler: { title: "Giderler", subtitle: "Ki\u015fisel ve i\u015fletme giderleri" },
  dashboard: { title: "Dashboard", subtitle: "G\u00fcncel stok, cari ve sat\u0131\u015f \u00f6zeti" },
  alis: { title: "Al\u0131\u015f", subtitle: "Normal \u00fcr\u00fcn al\u0131\u015f kay\u0131tlar\u0131" },
  satis: { title: "Sat\u0131\u015f", subtitle: "Toplam stoktan sat\u0131\u015f" },
  hurda_alis: { title: "Hurda Al\u0131\u015f", subtitle: "Sadece hurda al\u0131\u015f kay\u0131tlar\u0131" },
  hurda_satis: { title: "Hurda Sat\u0131\u015f", subtitle: "Toplam hurda stoktan sat\u0131\u015f" },
  stok: { title: "Stok", subtitle: "Normal stok ve hurda stok ayr\u0131" },
  cari: { title: "Cari", subtitle: "M\u00fc\u015fteri ve tedarik\u00e7i bakiyeleri" },
};

const forms = {
  giderler: [["tarih", "Tarih", "date"], ["tutar", "Gider (has)", "decimal"], ["kategori", "Kategori", "text"], ["notlar", "A\u00e7\u0131klama / not", "textarea"]],
  alis: [
    ["tarih", "Tarih", "date"], ["tedarikci", "Tedarik\u00e7i", "autocomplete", "suppliers"],
    ["cinsi", "Cinsi", "autocomplete", "products"], ["ayar", "Ayar", "text"],
    ["adet", "Adet", "decimal"], ["gram", "Gram", "decimal"], ["milyem", "Al\u0131\u015f Milyem", "decimal"],
    ["has_fiyati", "Has Fiyat\u0131 (TL/gr)", "decimal"], ["iscilik", "\u0130\u015f\u00e7ilik (TL)", "decimal"],
    ["notlar", "Not", "textarea"],
  ],
  satis: [
    ["purchase_id", "", "hidden"], ["alis_id", "", "hidden"],
    ["tarih", "Tarih", "date"], ["musteri", "M\u00fc\u015fteri", "autocomplete", "customers"],
    ["cinsi", "Cinsi", "text", null, true], ["ayar", "Ayar", "text", null, true],
    ["alis_milyem", "Al\u0131\u015f Milyem", "decimal", null, true],
    ["adet", "Adet", "decimal"], ["gram", "Sat\u0131\u015f Gram", "decimal"], ["satis_milyem", "Sat\u0131\u015f Milyem", "decimal"],
    ["has_fiyati", "Has Fiyat\u0131 (TL/gr)", "decimal"], ["iscilik", "\u0130\u015f\u00e7ilik (TL)", "decimal"],
    ["notlar", "Not", "textarea"],
  ],
  hurda: [
    ["hurda_alis_id", "", "hidden"], ["tarih", "Tarih", "date"], ["islem_turu", "", "hidden"],
    ["kisi", "Ki\u015fi / Firma", "autocomplete", "people"], ["cinsi", "Cinsi", "text"], ["ayar", "Ayar", "text"],
    ["adet", "Adet", "decimal"], ["gram", "Gram", "decimal"], ["milyem", "Al\u0131\u015f Milyem", "decimal"],
    ["has_fiyati", "Has Fiyat\u0131 (TL/gr)", "decimal"], ["iscilik", "\u0130\u015f\u00e7ilik (TL)", "decimal"],
    ["notlar", "Not", "textarea"],
  ],
};

const columns = {
  giderler: ["tarih", "tl_tutar", "tutar", "kategori", "notlar"],
  alis: ["tarih", "tedarikci", "cinsi", "ayar", "adet", "gram", "milyem", "has", "has_fiyati", "toplam_tutar", "not"],
  satis: ["tarih", "musteri", "cinsi", "ayar", "adet", "gram", "alis_milyem", "satis_milyem", "milyem_farki", "milyem_kari", "toplam_tutar", "brut_kar", "not"],
  hurdaAlis: ["tarih", "kisi", "cinsi", "ayar", "gram", "milyem", "has", "has_fiyati", "toplam_tutar", "not"],
  hurdaSatis: ["tarih", "kisi", "cinsi", "ayar", "gram", "alis_milyem", "satis_milyem", "milyem_farki", "milyem_kari", "toplam_tutar", "hurda_kar", "kalan_gram", "not"],
  stok: ["cinsi", "ayar", "alis_gram", "alis_has", "satis_gram", "satis_has", "kalan_gram", "adet_tahmini", "kalan_has"],
  hurdaStok: ["cinsi", "ayar", "hurda_alis_gram", "hurda_alis_has", "hurda_satis_gram", "hurda_satis_has", "kalan_gram", "kalan_has"],
  musteriCari: ["musteri_adi", "net_bakiye_has", "toplam_satis_has", "tahsil_edilen_has", "son_islem_tarihi"],
  tedarikciCari: ["tedarikci_adi", "net_bakiye_has", "toplam_alis_has", "odedigimiz_has", "odeyecegimiz_has", "son_islem_tarihi"],
  kisiCari: ["isim", "net_bakiye_has", "toplam_satis_has", "toplam_alis_has", "tahsil_edilen_has", "odedigimiz_has", "son_islem_tarihi"],
  cariHistory: ["tarih", "hareket", "kaynak", "gram", "has", "not"],
  cariOdeme: ["tarih", "isim", "yon", "odeme_tipi", "odenen_has", "not"],
};

const labels = {
  hareket: "\u0130\u015flem", kaynak: "Kaynak",
  tutar: "Gider (has)", tl_tutar: "Ödenen (TL)", kategori: "Kategori", notlar: "A\u00e7\u0131klama / not",
  tarih: "Tarih", tedarikci: "Tedarik\u00e7i", musteri: "M\u00fc\u015fteri", kisi: "Ki\u015fi / Firma", cinsi: "Cinsi", ayar: "Ayar",
  gram: "Gram", milyem: "Milyem", has: "Has", has_fiyati: "Has Fiyat\u0131 (TL)", iscilik: "\u0130\u015f\u00e7ilik (TL)", toplam_tutar: "Tutar (TL)", brut_kar: "K\u00e2r (TL)", hurda_kar: "K\u00e2r (TL)",
  odenen: "\u00d6denen", alinan: "Al\u0131nan", odenen_veya_alinan: "\u00d6denen / Al\u0131nan", kalan_borc: "Kalan Bor\u00e7", not: "Not",
  islem_turu: "\u0130\u015flem", alis_gram: "Al\u0131\u015f Gram", alis_has: "Al\u0131\u015f Has",
  satis_gram: "Sat\u0131\u015f Gram", satis_has: "Sat\u0131\u015f Has", kalan_gram: "Kalan Gram", kalan_has: "Kalan Has",
  alis_milyem: "Al\u0131\u015f Milyem", satis_milyem: "Sat\u0131\u015f Milyem", milyem_farki: "Milyem Fark\u0131",
  tahmini_kar: "Milyem K\u00e2r\u0131", has_kari: "Milyem K\u00e2r\u0131", milyem_kari: "Milyem K\u00e2r\u0131", musteri_adi: "Ad", tedarikci_adi: "Ad", toplam_satis: "Toplam Sat\u0131\u015f", toplam_alis: "Toplam Al\u0131\u015f",
  alis_borcu: "Al\u0131\u015f Borcu", satis_borcu: "Sat\u0131\u015f Borcu", net_bakiye: "Net Bakiye", net_bakiye_has: "Net Has Bakiyesi", son_islem_tarihi: "Son \u0130\u015flem", odeme_tipi: "\u00d6deme Tipi", yon: "\u0130\u015flem Y\u00f6n\u00fc", odenen_has: "\u0130\u015flem Has\u0131", odenen_gram: "\u00d6denen Gram", odenen_milyem: "\u00d6denen Milyem", hesaplanan_has: "Hesaplanan Has", toplam_has: "Toplam Has", odeme_has: "\u00d6deme Has", odedigimiz_has: "\u00d6dedi\u011fimiz Has", tahsil_edilen_has: "Tahsil Etti\u011fimiz Has", odeyecegimiz_has: "\u00d6deyece\u011fimiz Has", tahsil_edilecek_has: "Tahsil Edilecek Has", normal_alis_has: "Normal Al\u0131\u015f Has", normal_satis_has: "Normal Sat\u0131\u015f Has", hurda_alis_has: "Hurda Al\u0131\u015f Has", hurda_satis_has: "Hurda Sat\u0131\u015f Has", toplam_alis_has: "Toplam Al\u0131\u015f Has", toplam_satis_has: "Toplam Sat\u0131\u015f Has", hurda_alis_gram: "Hurda Al\u0131\u015f Gram", hurda_satis_gram: "Hurda Sat\u0131\u015f Gram",
};

const moneyFields = new Set(["has_fiyati", "tl_tutar", "brut_kar", "hurda_kar", "toplam_tl_kar", "gunluk_tl_kar", "stok_degeri", "gunluk_satis", "tl", "iscilik", "ek_masraf", "ek_ucret", "indirim", "odenen", "alinan", "toplam_tutar", "kalan_borc", "toplam_satis", "toplam_alis", "alis_borcu", "satis_borcu", "net_bakiye", "odenen_veya_alinan"]);
const numberFields = new Set(["gram", "milyem", "has", "alis_gram", "alis_has", "satis_gram", "satis_has", "kalan_gram", "kalan_has", "alis_milyem", "satis_milyem", "milyem_farki", "has_kari", "milyem_kari", "tahmini_kar", "hurda_alis_gram", "hurda_alis_has", "hurda_satis_gram", "hurda_satis_has", "normal_alis_has", "normal_satis_has", "toplam_alis_has", "toplam_satis_has", "tutar", "toplam_has", "odeme_has", "odedigimiz_has", "tahsil_edilen_has", "odeyecegimiz_has", "tahsil_edilecek_has", "net_bakiye_has", "odenen_has", "odenen_gram", "odenen_milyem", "hesaplanan_has"]);

const content = document.querySelector("#content");
const search = document.querySelector("#search");
let editing = null;
const tableLayoutObserver = new ResizeObserver(() => requestAnimationFrame(fitPageTable));

// Dükkânın bugünü: sunucunun saat dilimi (oturum açılırken alınır), yoksa tarayıcının yerel tarihi.
const today = () => state.serverToday || new Date().toLocaleDateString("en-CA");
const normalize = (value) => String(value || "").toLocaleLowerCase("tr-TR").replaceAll("\u0131", "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const parseNum = (value) => Number(String(value || "0").replace(",", ".")) || 0;
const paymentDisplayValue = (value) => parseNum(value) > 0 ? String(value).replace(".", ",") : "";

function cleanDecimalInput(input) {
  const before = input.value;
  if (before.includes("-")) {
    input.value = "";
    return;
  }
  input.value = before.replace(/[^0-9.,]/g, "");
}

function positiveValue(input, label, allowEmpty = false) {
  const raw = String(input.value || "").trim();
  if (!raw) {
    if (allowEmpty) return null;
    throw new Error(`${label} girin.`);
  }
  if (raw.includes("-")) throw new Error(`${label} negatif olamaz.`);
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} 0'dan b\u00fcy\u00fck olmal\u0131.`);
  return value;
}

function attachDecimalGuard(input) {
  input.addEventListener("input", () => cleanDecimalInput(input));
  input.addEventListener("focus", () => { if (parseNum(input.value) === 0) input.value = ""; });
}

// Keep decimal/group separators consistent in desktop WebViews as well as browsers.
function formatTurkishNumber(value, minimumDigits = 0, maximumDigits = 2) {
  const parts = (Math.trunc(Number(value) * 10 ** maximumDigits + Math.sign(Number(value)) * 1e-8) / 10 ** maximumDigits).toFixed(maximumDigits).split(".");
  let fraction = parts[1] || "";
  while (fraction.length > minimumDigits && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const integer = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return integer + (fraction ? "," + fraction : "");
}

const DATE_FIELDS = new Set(["tarih", "son_islem_tarihi", "teslim_tarihi", "teslim_edildi", "iade_tarihi", "soz_tarihi", "donus_tarihi", "gunluk_tarih"]);

function formatValue(key, value) {
  if (value === null || value === undefined || value === "") return "";
  if (DATE_FIELDS.has(key)) return trDate(value);
  if (key === "odeme_tipi") return paymentLabel(value);
  if (key === "adet" && !Number(value)) return "";
  if (key === "yon") return value === "ODEME" ? "Tedarik\u00e7iye \u00d6deme" : "M\u00fc\u015fteriden Tahsilat";
  if (key === "net_bakiye_has") return `${Number(value) > 0 ? "+" : ""}${formatTurkishNumber(value)}`;
  if (key === "tl") return `${formatTurkishNumber(value, 2, 2)} \u20ba`;
  if (moneyFields.has(key)) return formatTurkishNumber(value, 2, 2);
  if (numberFields.has(key)) return formatTurkishNumber(value);
  return String(value);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  } catch {
    throw new Error("Sunucuya ula\u015f\u0131lamad\u0131.");
  }
  const body = await response.json().catch(() => ({ status: "error", message: "", detail: "", data: null }));
  if (response.status === 401) { window.location.href = "/login"; return null; }
  // TL hesab\u0131 eksiye d\u00fc\u015fecekse sunucu kayd\u0131 durdurur; kullan\u0131c\u0131 onaylarsa ayn\u0131 istek onayla yeniden g\u00f6nderilir.
  if (response.status === 409 && body.kod === "EKSI_BAKIYE" && typeof options.body === "string") {
    if (!(await showConfirm(String(body.message).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]), "Evet, kaydet", "Vazge\u00e7"))) throw new Error("Kay\u0131t yap\u0131lmad\u0131.");
    return api(path, { ...options, body: JSON.stringify({ ...JSON.parse(options.body), eksi_onay: true }) });
  }
  const serverMessage = body.message || body.detail;
  const statusMessages = {
    404: "Sunucu endpointi bulunamad\u0131.",
    405: "Sunucu bu i\u015flem metodunu desteklemiyor. Uygulamay\u0131 yeniden ba\u015flat\u0131n ve endpointleri kontrol edin.",
  };
  // Sunucunun kendi mesajı varsa (ör. "Bu barkoda ait etiket yok") o gösterilir.
  if (!response.ok || body.status === "error") throw new Error((body.status === "error" && serverMessage) || statusMessages[response.status] || serverMessage || "\u0130\u015flem yap\u0131lamad\u0131.");
  return body.data;
}

function showMessage(text, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast-error" : "toast-info"}`;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-show"), 10);
  setTimeout(() => { toast.classList.remove("toast-show"); setTimeout(() => toast.remove(), 250); }, 3200);
}

function showConfirm(message, okText = "Tamam", cancelText = "\u0130ptal") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay confirm-show";
    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.innerHTML = `<p class="confirm-message">${message}</p>`;
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.className = "confirm-btn confirm-cancel";
    cancel.type = "button";
    cancel.textContent = cancelText;
    cancel.onclick = () => { overlay.remove(); resolve(false); };
    const ok = document.createElement("button");
    ok.className = `confirm-btn confirm-ok ${normalize(okText) === "sil" ? "confirm-danger" : ""}`;
    ok.type = "button";
    ok.textContent = okText;
    ok.onclick = () => { overlay.remove(); resolve(true); };
    actions.append(cancel, ok);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function openNote(text, heading = "Not") {
  const overlay = document.createElement("div"); overlay.className = "modal note-modal";
  const box = document.createElement("div"); box.className = "modal-box note-dialog";
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", heading);
  const title = document.createElement("h2"); title.textContent = heading;
  const body = document.createElement("p"); body.className = "note-full"; body.textContent = text;
  const close = document.createElement("button"); close.type = "button"; close.className = "secondary"; close.textContent = "Kapat";
  const previous = document.activeElement;
  const dismiss = () => { overlay.remove(); previous?.focus(); };
  close.onclick = dismiss; overlay.onclick = event => { if (event.target === overlay) dismiss(); };
  overlay.onkeydown = event => { if (event.key === "Escape") dismiss(); if (event.key === "Tab") { event.preventDefault(); close.focus(); } };
  box.append(title, body, close); overlay.appendChild(box); document.body.appendChild(overlay); close.focus();
}

async function openSettings() {
  if (document.querySelector(".settings-modal")) return;
  const previous = document.activeElement;
  const overlay = document.createElement("div"); overlay.className = "modal settings-modal";
  const box = document.createElement("div"); box.className = "modal-box settings-box";
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Ayarlar");
  const title = document.createElement("h2"); title.textContent = "Ayarlar";
  const intro = document.createElement("p"); intro.className = "settings-intro"; intro.textContent = "G\u00f6r\u00fcn\u00fcm ve yedekleme tercihleri";
  const form = document.createElement("form"); form.className = "settings-form";
  const theme = document.createElement("select"); theme.name = "theme";
  [["light", "A\u00e7\u0131k"], ["dark", "Koyu"]].forEach(([value, text]) => theme.add(new Option(text, value)));
  theme.value = document.documentElement.dataset.theme;
  let backupAvailable = false;
  let initialFrequency;
  const frequency = document.createElement("select"); frequency.name = "backup_frequency"; frequency.disabled = true;
  [["daily", "G\u00fcnde bir (ilk a\u00e7\u0131l\u0131\u015fta)"], ["startup", "Her a\u00e7\u0131l\u0131\u015fta"]].forEach(([value, text]) => frequency.add(new Option(text, value)));
  function field(text, input) { const label = document.createElement("label"); label.className = "field"; label.append(text, input); return label; }
  const last = document.createElement("p"); last.className = "hint"; last.textContent = "Y\u00fckleniyor...";
  const about = document.createElement("p"); about.className = "settings-about";
  const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = "Otomatik yedek uygulama a\u00e7\u0131l\u0131\u015f\u0131nda al\u0131n\u0131r. S\u0131kl\u0131k tercihi sonraki a\u00e7\u0131l\u0131\u015fta uygulan\u0131r; mevcut yedekler de\u011fi\u015ftirilmez.";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary"; cancel.textContent = "\u0130ptal";
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Kaydet"; save.disabled = true;
  const dismiss = () => { overlay.remove(); if (previous?.isConnected) previous.focus(); };
  cancel.onclick = dismiss; overlay.onclick = event => { if (event.target === overlay) dismiss(); };
  overlay.onkeydown = event => {
    if (event.key === "Escape") dismiss();
    if (event.key === "Tab") {
      const controls = [...box.querySelectorAll("select, button:not(:disabled)")];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  };
  const actions = document.createElement("div"); actions.className = "form-bottom-actions"; actions.append(cancel, save);
  form.append(field("G\u00f6r\u00fcn\u00fcm", theme), field("Otomatik yedekleme", frequency), hint, last, about, actions);
  if (currentUser?.role === "admin") {
    const danger = document.createElement("section"); danger.className = "settings-danger";
    const dt = document.createElement("h3"); dt.textContent = "Verileri s\u0131f\u0131rla";
    const dp = document.createElement("p"); dp.className = "hint";
    dp.textContent = "T\u00fcm sat\u0131\u015f, al\u0131\u015f, hurda, cari, kasa hareketi, emanet, sipari\u015f ve etiket kay\u0131tlar\u0131 silinir. Kullan\u0131c\u0131lar, ayarlar, firma bilgileri ve kasa hesaplar\u0131 korunur. Silmeden \u00f6nce otomatik yedek al\u0131n\u0131r.";
    const db = document.createElement("button"); db.type = "button"; db.className = "danger-button"; db.textContent = "Verileri s\u0131f\u0131rla";
    db.onclick = () => { dismiss(); openResetData(); };
    danger.append(dt, dp, db); queueMicrotask(() => form.after(danger));
  }
  box.append(title, intro, form); overlay.appendChild(box); document.body.appendChild(overlay); theme.focus();
  try {
    const data = await api("/api/uygulama-ayarlari");
    if (!overlay.isConnected) return;
    frequency.value = data.backup_frequency;
    initialFrequency = data.backup_frequency; backupAvailable = true; frequency.disabled = false;
    last.textContent = `Son ba\u015far\u0131l\u0131 yedek: ${data.last_backup ? new Date(data.last_backup).toLocaleString("tr-TR") : "Hen\u00fcz yok"}`;
    about.textContent = `S\u00fcr\u00fcm: ${data.version}\n${data.update_info}`;
    save.disabled = false;
  } catch {
    last.textContent = "Yedekleme ayarlar\u0131na ula\u015f\u0131lamad\u0131. Uygulamay\u0131 tamamen kapat\u0131p yeniden a\u00e7\u0131n. Tema tercihinizi kaydedebilirsiniz.";
    hint.textContent = "Yedekleme tercihi bu oturumda de\u011fi\u015ftirilemez. Mevcut yedekleriniz korunur.";
    save.disabled = false;
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (save.disabled) return; save.disabled = true;
    try {
      if (backupAvailable && frequency.value !== initialFrequency) {
        await api("/api/uygulama-ayarlari", {method:"PUT", body:JSON.stringify({backup_frequency:frequency.value})});
      }
      if (!overlay.isConnected) return;
      if (document.documentElement.dataset.theme !== theme.value) document.querySelector("#themeToggle").click();
      dismiss(); showMessage(backupAvailable ? "Ayarlar kaydedildi." : "G\u00f6r\u00fcn\u00fcm kaydedildi. Yedekleme tercihi de\u011fi\u015ftirilmedi.");
    } catch { if (overlay.isConnected) { save.disabled = false; last.textContent = "Yedekleme tercihi kaydedilemedi. Uygulamay\u0131 yeniden a\u00e7\u0131p tekrar deneyin."; } }
  };
}

/** Yönetici parolasıyla tüm işlem verilerini siler (kullanıcılar ve ayarlar kalır). */
function openResetData() {
  const { box, close } = openModal("Verileri s\u0131f\u0131rla", "kasa-modal reset-modal");
  const warn = h("p", { class: "reset-warning", text: "Bu i\u015flem t\u00fcm sat\u0131\u015f, al\u0131\u015f, hurda, cari, kasa, emanet, sipari\u015f ve etiket kay\u0131tlar\u0131n\u0131 siler. Kullan\u0131c\u0131lar, ayarlar, firma bilgileri ve kasa hesaplar\u0131 kal\u0131r." });
  const note = h("p", { class: "hint", text: "Silmeden \u00f6nce otomatik yedek al\u0131n\u0131r. Yanl\u0131\u015fl\u0131kla s\u0131f\u0131rlarsan\u0131z sa\u011f \u00fcstteki di\u015fli men\u00fcs\u00fcndeki \"Yedekler ve geri y\u00fckleme\" penceresinden \"S\u0131f\u0131rlama \u00f6ncesi\" yede\u011fini geri y\u00fckleyebilirsiniz." });
  const parola = h("input", { type: "password", name: "parola", autocomplete: "current-password", required: true });
  const onay = h("input", { name: "onay", autocomplete: "off", placeholder: "SIFIRLA" });
  const go = h("button", { type: "submit", class: "danger-button", text: "Verileri s\u0131f\u0131rla", disabled: true });
  onay.addEventListener("input", () => { go.disabled = onay.value.trim().toLocaleUpperCase("tr-TR") !== "SIFIRLA"; });
  const form = h("form", { class: "settings-form" }, warn, labeled("Y\u00f6netici parolas\u0131", parola), labeled("Onaylamak i\u00e7in SIFIRLA yaz\u0131n", onay), note,
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Vazge\u00e7", onclick: close }), go));
  form.onsubmit = async (event) => {
    event.preventDefault(); if (go.disabled) return; go.disabled = true;
    try {
      await api("/api/verileri-sifirla", { method: "POST", body: JSON.stringify({ parola: parola.value }) });
      close();
      showMessage("T\u00fcm veriler s\u0131f\u0131rland\u0131. \u00d6nceki hali yedekte duruyor.");
      await Promise.all([refreshSuggestions(), loadKasaAccounts()]).catch(() => {});
      render();
    } catch (error) { showMessage(error.message, true); parola.select(); go.disabled = false; }
  };
  box.append(form);
  parola.focus();
}

let currentUser = null;
const ROLE_LABELS = { admin: "Yönetici", staff: "Personel", viewer: "İzleyici" };

async function openAccount() {
  if (document.querySelector(".account-modal")) return;
  const previous = document.activeElement;
  const overlay = document.createElement("div"); overlay.className = "modal settings-modal account-modal";
  const box = document.createElement("div"); box.className = "modal-box settings-box account-box";
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Hesap ve kullanıcılar");
  const title = document.createElement("h2"); title.textContent = "Hesap ve kullanıcılar";
  const intro = document.createElement("p"); intro.className = "settings-intro";
  intro.textContent = currentUser ? `${currentUser.name} (${currentUser.email}) · ${ROLE_LABELS[currentUser.role] || currentUser.role}` : "";
  const dismiss = () => { overlay.remove(); if (previous?.isConnected) previous.focus(); };
  overlay.onclick = event => { if (event.target === overlay) dismiss(); };
  overlay.onkeydown = event => { if (event.key === "Escape") dismiss(); };
  const field = (text, input) => { const label = document.createElement("label"); label.className = "field"; label.append(text, input); return label; };
  const input = (type, name, autocomplete) => { const el = document.createElement("input"); el.type = type; el.name = name; if (autocomplete) el.autocomplete = autocomplete; el.required = true; return el; };

  const pwForm = document.createElement("form"); pwForm.className = "settings-form";
  const current = input("password", "current_password", "current-password");
  const next = input("password", "new_password", "new-password");
  const pwSave = document.createElement("button"); pwSave.type = "submit"; pwSave.textContent = "Parolayı değiştir";
  const pwActions = document.createElement("div"); pwActions.className = "form-bottom-actions"; pwActions.append(pwSave);
  pwForm.append(field("Mevcut parola", current), field("Yeni parola (en az 8 karakter)", next), pwActions);
  pwForm.onsubmit = async event => {
    event.preventDefault(); pwSave.disabled = true;
    try { await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current.value, new_password: next.value }) }); current.value = next.value = ""; showMessage("Parola değiştirildi."); }
    catch (error) { showMessage(error.message, true); }
    finally { pwSave.disabled = false; }
  };

  const close = document.createElement("button"); close.type = "button"; close.className = "secondary"; close.textContent = "Kapat"; close.onclick = dismiss;
  const closeRow = document.createElement("div"); closeRow.className = "form-bottom-actions"; closeRow.append(close);
  box.append(title, intro, pwForm);

  if (currentUser?.role === "admin") {
    const usersTitle = document.createElement("h3"); usersTitle.className = "account-subtitle"; usersTitle.textContent = "Kullanıcılar";
    const list = document.createElement("div"); list.className = "account-users";
    const addForm = document.createElement("form"); addForm.className = "settings-form account-add";
    const name = input("text", "name", "off"); const email = input("email", "email", "off"); const password = input("password", "password", "new-password");
    const role = document.createElement("select"); Object.entries(ROLE_LABELS).forEach(([value, text]) => role.add(new Option(text, value))); role.value = "staff";
    const add = document.createElement("button"); add.type = "submit"; add.textContent = "Kullanıcı ekle";
    const addActions = document.createElement("div"); addActions.className = "form-bottom-actions"; addActions.append(add);
    addForm.append(field("Ad Soyad", name), field("E-posta", email), field("Parola", password), field("Rol", role), addActions);
    const loadUsers = async () => {
      const rows = await api("/api/auth/users");
      list.replaceChildren(...rows.map(row => {
        const item = document.createElement("div"); item.className = "account-user";
        const text = document.createElement("span"); text.textContent = `${row.name} · ${row.email}`;
        const sel = document.createElement("select"); Object.entries(ROLE_LABELS).forEach(([value, label]) => sel.add(new Option(label, value))); sel.value = row.role;
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "secondary"; toggle.textContent = row.is_active ? "Pasif yap" : "Aktif yap";
        const isSelf = row.id === currentUser.id; sel.disabled = toggle.disabled = isSelf;
        if (!row.is_active) item.classList.add("inactive");
        const update = async changes => { try { await api(`/api/auth/users/${row.id}`, { method: "PUT", body: JSON.stringify(changes) }); await loadUsers(); } catch (error) { showMessage(error.message, true); await loadUsers(); } };
        sel.onchange = () => update({ role: sel.value });
        toggle.onclick = () => update({ is_active: !row.is_active });
        // Parolasını unutan personel için yönetici yeni parola belirler; kişi sonra kendisi değiştirebilir.
        const reset = document.createElement("button"); reset.type = "button"; reset.className = "secondary"; reset.textContent = "Parola"; reset.title = "Yeni parola belirle"; reset.hidden = isSelf;
        reset.onclick = () => {
          const { box: dialog, close } = openModal(`${row.name} için yeni parola`);
          const f = h("form", { class: "settings-form" });
          const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 8, required: true });
          f.append(h("p", { class: "hint", text: "En az 8 karakter. Kişinin açık oturumları kapanır; yeni parolayla giriş yapar." }), labeled("Yeni parola", pw),
            h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "İptal", onclick: close }), h("button", { type: "submit", text: "Kaydet" })));
          f.onsubmit = async (event) => {
            event.preventDefault();
            try { await api(`/api/auth/users/${row.id}/parola`, { method: "POST", body: JSON.stringify({ new_password: pw.value }) }); close(); showMessage("Parola yenilendi."); await loadUsers(); }
            catch (error) { showMessage(error.message, true); }
          };
          dialog.append(f); pw.focus();
        };
        item.append(text, sel, toggle, reset); return item;
      }));
    };
    addForm.onsubmit = async event => {
      event.preventDefault(); add.disabled = true;
      try { await api("/api/auth/users", { method: "POST", body: JSON.stringify({ name: name.value, email: email.value, password: password.value, role: role.value }) }); name.value = email.value = password.value = ""; showMessage("Kullanıcı eklendi."); await loadUsers(); }
      catch (error) { showMessage(error.message, true); }
      finally { add.disabled = false; }
    };
    box.append(usersTitle, list, addForm);
    loadUsers().catch(error => showMessage(error.message, true));
  }
  box.append(closeRow);
  overlay.appendChild(box); document.body.appendChild(overlay); current.focus();
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  window.location.href = "/login";
}

/* Günün has fiyatı: canlı kaynak, yoksa elle girilen fiyat. Formlara öneri olarak dolar. */
function renderPriceButton() {
  const button = document.querySelector("#priceBtn");
  if (!button) return;
  const price = state.price;
  button.textContent = price ? `HAS ${formatValue("has_fiyati", price.satis)} ₺` : "HAS FİYATI GİR";
  button.title = price ? `${price.kaynak === "canli" ? `Canlı fiyat${price.saglayici ? ` (${price.saglayici})` : ""}` : "Elle girilen fiyat"} · Alış ${formatValue("has_fiyati", price.alis)} ₺ / Satış ${formatValue("has_fiyati", price.satis)} ₺${price.guncelleme ? ` · ${price.guncelleme}` : ""}` : "Günün has fiyatını girin";
  button.classList.toggle("price-live", price?.kaynak === "canli");
}

async function loadPrice() {
  const [fiyat, urunler] = await Promise.allSettled([api("/api/altin-fiyati"), api("/api/pano/urunler")]);
  if (fiyat.status === "fulfilled") { state.price = fiyat.value.fiyat; state.kurlar = fiyat.value.kurlar || {}; } else state.price = null;
  state.urunFiyat = urunler.status === "fulfilled" ? urunler.value || {} : {};
  renderPriceButton();
  renderRateTicker();
  if (typeof refreshPriceTiles === "function") refreshPriceTiles();
  document.querySelectorAll("input[data-canli]").forEach(setLivePrice);
}

/**
 * Has fiyatı alanı canlı fiyatı izler: kullanıcı elle bir değer yazana kadar her
 * fiyat yenilemesinde güncellenir. Alan boşaltılırsa yeniden izlemeye başlar.
 * `side` "alis", "satis" ya da bunlardan birini döndüren fonksiyondur. `product`
 * verilirse ve {value, note} döndürürse (ör. çeyrek seçiliyken) has fiyatı yerine o kullanılır.
 */
function followLivePrice(input, side, product = null) {
  input.dataset.canli = "1";
  input._canliSide = side;
  input._canliUrun = product;
  if (product) { input._canliNot = h("small", { class: "live-price-note" }); input.after(input._canliNot); }
  input.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    if (input.value.trim()) input.dataset.elle = "1"; else delete input.dataset.elle;
  });
  setLivePrice(input);
}

function setLivePrice(input) {
  if (!input.dataset.canli) return;
  const side = typeof input._canliSide === "function" ? input._canliSide() : input._canliSide;
  const product = input._canliUrun?.();
  if (input._canliNot) input._canliNot.textContent = product?.note || "";
  if (input.dataset.elle) return;
  const value = product ? product.value : state.price?.[side];
  if (!value) return;
  const text = String(value).replace(".", ",");
  if (input.value === text) return;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Canlı fiyat kaynağı (yönetici): AltınAPI anahtarı girilirse fiyat Harem Altın ile
 * aynı piyasa verisinden, girilmezse Truncgil Finans'tan okunur.
 */
function priceSourceSection() {
  const section = h("section", { class: "price-source" });
  const status = h("p", { class: "hint", text: "Kaynak okunuyor..." });
  const key = h("input", { type: "password", autocomplete: "off", placeholder: "hapi_...", "aria-label": "AltınAPI anahtarı" });
  const save = h("button", { type: "button", text: "Anahtarı kaydet" });
  const remove = h("button", { type: "button", class: "secondary", text: "Anahtarı kaldır", hidden: true });
  const show = async () => {
    try {
      const d = await api("/api/altin-fiyati/kaynak");
      const harem = d.harem && !d.harem.ok && d.saglayici !== "Harem Altın" ? ` Harem Altın'a bağlanılamadı${d.harem.hata ? ` (${d.harem.hata})` : ""}.` : "";
      status.textContent = `Şu anki kaynak: ${d.saglayici || "canlı fiyat alınamıyor"}.${harem}${d.anahtar_var ? ` Kayıtlı anahtar ····${d.anahtar_son}.` : " Anahtar girilmedi."}`;
      remove.hidden = !d.anahtar_var;
    } catch (error) { status.textContent = error.message; }
  };
  const send = async (anahtar) => {
    save.disabled = remove.disabled = true;
    try { const r = await api("/api/altin-fiyati/kaynak", { method: "PUT", body: JSON.stringify({ anahtar }) }); key.value = ""; showMessage(r?.anahtar_var ? "Anahtar kaydedildi; fiyat AltınAPI'den okunuyor." : "Anahtar kaldırıldı; fiyat Truncgil Finans'tan okunacak."); await loadPrice(); await show(); }
    catch (error) { showMessage(error.message, true); }
    finally { save.disabled = remove.disabled = false; }
  };
  save.onclick = () => { if (key.value.trim()) send(key.value.trim()); else key.focus(); };
  remove.onclick = () => send("");
  section.append(h("h3", { class: "account-subtitle", text: "Canlı fiyat kaynağı" }),
    h("p", { class: "hint", text: "Program önce Harem Altın'ın canlı akışını kullanır; akış gelmezse Truncgil Finans'a geçer. İsterseniz ikinci bir yedek kaynak olarak altinapi.com anahtarı girebilirsiniz (isteğe bağlı)." }),
    status, h("label", { class: "field" }, "AltınAPI anahtarı", key), h("div", { class: "form-bottom-actions" }, remove, save));
  show();
  return section;
}

/**
 * Fiyat farkı (yönetici): canlı has fiyatına ve altın ürünlerine yüzde eklenir veya
 * düşülür. Formlar, ana ekran ve fiyat panosu farklı fiyatı gösterir; elle girilen
 * fiyat, döviz ve metaller etkilenmez.
 */
function priceAdjustSection(onSaved) {
  const section = h("section", { class: "price-source price-adjust" });
  // Eksi işaretine izin verilir (alışta fiyat düşürmek için); diğer sayı alanları eksiyi siler.
  const pct = (name) => {
    const el = h("input", { name, inputMode: "text", placeholder: "0" });
    el.addEventListener("input", () => { const v = el.value.replace(/[^0-9,.-]/g, ""); el.value = (v.startsWith("-") ? "-" : "") + v.replace(/-/g, ""); });
    return el;
  };
  const alis = pct("ayar_alis"); const satis = pct("ayar_satis");
  const preview = h("p", { class: "hint" });
  const save = h("button", { type: "button", text: "Farkı kaydet" });
  const reset = h("button", { type: "button", class: "secondary", text: "Farkı kaldır" });
  let raw = null;
  const num = (el) => Number(String(el.value || "0").replace(",", ".")) || 0;
  const show = () => {
    const a = num(alis), s = num(satis);
    const parts = [`Alış ×${(1 + a / 100).toFixed(4).replace(".", ",")}`, `Satış ×${(1 + s / 100).toFixed(4).replace(".", ",")}`];
    if (raw) parts.push(`Örnek: piyasa ${formatValue("has_fiyati", raw.alis)} / ${formatValue("has_fiyati", raw.satis)} ₺ → ${formatValue("has_fiyati", raw.alis * (1 + a / 100))} / ${formatValue("has_fiyati", raw.satis * (1 + s / 100))} ₺`);
    preview.textContent = parts.join(" · ");
  };
  alis.addEventListener("input", show); satis.addEventListener("input", show);
  const load = async () => {
    try {
      const data = await api("/api/altin-fiyati");
      raw = data.canli_ham;
      const v = (x) => (x ? String(x).replace(".", ",") : "");
      alis.value = v(data.fiyat_ayari?.alis); satis.value = v(data.fiyat_ayari?.satis);
      show();
    } catch (error) { preview.textContent = error.message; }
  };
  const send = async (body) => {
    save.disabled = reset.disabled = true;
    try { await api("/api/altin-fiyati/ayar", { method: "PUT", body: JSON.stringify(body) }); await load(); await loadPrice(); if (onSaved) await onSaved(); showMessage("Fiyat farkı kaydedildi."); }
    catch (error) { showMessage(error.message, true); }
    finally { save.disabled = reset.disabled = false; }
  };
  save.onclick = () => send({ alis: num(alis), satis: num(satis) });
  reset.onclick = () => send({ alis: 0, satis: 0 });
  section.append(h("h3", { class: "account-subtitle", text: "Fiyat farkı (%)" }),
    h("p", { class: "hint", text: "Canlı has fiyatına ve altın ürünlerine (çeyrek, bilezik...) uygulanır; formlar, ana ekran ve fiyat panosu bu fiyatı gösterir. Ör. satış 1,5 yazılırsa piyasa satışı %1,5 artar; alış -0,5 yazılırsa piyasa alışı %0,5 düşer. Elle girilen fiyat, döviz ve metaller değişmez." }),
    h("div", { class: "price-rates" }, h("label", { class: "field" }, "Alış farkı (%)", alis), h("label", { class: "field" }, "Satış farkı (%)", satis)),
    preview, h("div", { class: "form-bottom-actions" }, reset, save));
  load();
  return section;
}

async function openPriceDialog() {
  if (document.querySelector(".price-modal")) return;
  const overlay = document.createElement("div"); overlay.className = "modal settings-modal price-modal";
  const box = document.createElement("div"); box.className = "modal-box settings-box";
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Has fiyatı");
  const title = document.createElement("h2"); title.textContent = "Has fiyatı (TL/gr)";
  const intro = document.createElement("p"); intro.className = "settings-intro"; intro.textContent = "Yükleniyor...";
  const form = document.createElement("form"); form.className = "settings-form";
  const field = (text, input) => { const label = document.createElement("label"); label.className = "field"; label.append(text, input); return label; };
  const input = (name) => { const el = document.createElement("input"); el.name = name; el.inputMode = "decimal"; attachDecimalGuard(el); return el; };
  const alis = input("alis"); const satis = input("satis");
  const rateInputs = ["USD", "EUR"].map((cur) => [cur, input(`${cur}_alis`), input(`${cur}_satis`)]);
  const hint = document.createElement("p"); hint.className = "hint";
  hint.textContent = "Canlı fiyat alınamadığında burada girdiğiniz fiyat kullanılır. Fiyat sadece formlara öneri olarak gelir; her kayıtta değiştirebilirsiniz.";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary"; cancel.textContent = "Kapat";
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Elle fiyatı kaydet";
  // Elle girilen fiyatı siler; alanlar ve formlar yeniden canlı fiyatı gösterir.
  const toLive = document.createElement("button"); toLive.type = "button"; toLive.className = "secondary"; toLive.textContent = "Canlı fiyata dön";
  const actions = document.createElement("div"); actions.className = "form-bottom-actions"; actions.append(cancel, toLive, save);
  const rateBox = document.createElement("div"); rateBox.className = "price-rates";
  rateInputs.forEach(([cur, a, b]) => rateBox.append(field(`${cur} alış (TL)`, a), field(`${cur} satış (TL)`, b)));
  form.append(field("Alış (TL/gr has)", alis), field("Satış (TL/gr has)", satis), rateBox, hint, actions);
  box.append(title, intro, form);
  if (isAdmin()) box.append(priceAdjustSection(() => fill()), saleSettingSection(), priceSourceSection());
  overlay.appendChild(box); document.body.appendChild(overlay);
  const dismiss = () => overlay.remove();
  cancel.onclick = dismiss; overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
  overlay.onkeydown = (e) => { if (e.key === "Escape") dismiss(); };
  const fill = async () => {
    const data = await api("/api/altin-fiyati");
    const live = data.canli; const manual = data.manuel;
    const ayar = data.fiyat_ayari || {};
    const farkli = live && data.canli_ham && (ayar.alis || ayar.satis);
    intro.textContent = live
      ? `Canlı fiyat (${live.saglayici || live.ad}${live.guncelleme ? `, ${live.guncelleme}` : ""}): alış ${formatValue("has_fiyati", live.alis)} ₺, satış ${formatValue("has_fiyati", live.satis)} ₺${farkli ? ` (piyasa ${formatValue("has_fiyati", data.canli_ham.alis)} / ${formatValue("has_fiyati", data.canli_ham.satis)} ₺, fark alış %${String(ayar.alis).replace(".", ",")} satış %${String(ayar.satis).replace(".", ",")})` : ""}`
      : manual ? "Canlı fiyat şu an alınamadı; elle girilen fiyat kullanılıyor." : "Canlı fiyat şu an alınamadı ve elle fiyat girilmedi.";
    if (live && manual) intro.textContent += ` · Elle girilen: alış ${formatValue("has_fiyati", manual.alis)} ₺, satış ${formatValue("has_fiyati", manual.satis)} ₺ (canlı fiyat kesilirse kullanılır)`;
    const show = (el, v) => { el.value = v ? String(v).replace(".", ",") : ""; };
    const source = manual || live;
    show(alis, source?.alis); show(satis, source?.satis);
    rateInputs.forEach(([cur, a, b]) => { const rate = data.manuel_kurlar?.[cur] || data.kurlar?.[cur]; show(a, rate?.alis); show(b, rate?.satis); });
  };
  try { await fill(); } catch (error) { intro.textContent = error.message; }
  toLive.onclick = async () => {
    toLive.disabled = true;
    try { await api("/api/altin-fiyati", { method: "DELETE" }); await fill(); await loadPrice(); showMessage("Elle girilen fiyat silindi; canlı fiyat kullanılıyor."); }
    catch (error) { showMessage(error.message, true); }
    finally { toLive.disabled = false; }
  };
  alis.focus();
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    try {
      const kurlar = Object.fromEntries(rateInputs.map(([cur, a, b]) => [cur, { alis: a.value, satis: b.value }]));
      await api("/api/altin-fiyati", { method: "PUT", body: JSON.stringify({ alis: alis.value, satis: satis.value, kurlar }) });
      await loadPrice(); dismiss(); showMessage("Has fiyatı kaydedildi.");
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
}

async function refreshSuggestions() {
  try {
    const data = await api("/api/suggestions");
    data.products = (data.products || []).filter((item) => !normalize(item).includes("hurda"));
    state.suggestions = data;
  } catch { /* keep defaults */ }
}

function attachAutocomplete(input, source) {
  if (input._autocompleteAttached) return;
  input._autocompleteAttached = true;
  // A single custom list owns suggestions; no native datalist is mounted.
  input.removeAttribute("list");
  const box = document.createElement("div");
  box.className = "suggest-box hidden";
  box.id = `suggest-${source}-${input.name}`;
  box.setAttribute("role", "listbox");
  input.parentElement.appendChild(box);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", box.id);
  input.setAttribute("aria-expanded", "false");
  let active = -1;
  const close = () => {
    box.classList.add("hidden"); active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const select = value => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const open = () => {
    // M\u00fc\u015fteri/tedarik\u00e7i alan\u0131nda t\u00fcm cariler \u00f6nerilir; ayn\u0131 ki\u015fi iki kez a\u00e7\u0131lmas\u0131n.
    const pool = ["customers", "suppliers"].includes(source) ? [...(state.suggestions[source] || []), ...(state.suggestions.people || [])] : (state.suggestions[source] || []);
    const values = [...new Map(pool.map(value => [normalize(value), value])).values()];
    const needle = normalize(input.value);
    const starts = item => (normalize(item).startsWith(needle) ? 0 : 1);
    const matches = values.filter(item => !needle || normalize(item).includes(needle)).sort((a, b) => starts(a) - starts(b));
    box.replaceChildren(); active = -1;
    input.removeAttribute("aria-activedescendant");
    if (!matches.length) { close(); return; }
    matches.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = item; btn.tabIndex = -1;
      btn.id = `${box.id}-${index}`; btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", "false");
      btn.addEventListener("pointerdown", event => event.preventDefault());
      btn.addEventListener("click", () => select(item));
      box.appendChild(btn);
    });
    box.scrollTop = 0;
    box.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", open);
  input.addEventListener("focus", open);
  input.addEventListener("click", () => { if (box.classList.contains("hidden")) open(); });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") { close(); return; }
    if (event.key === "Enter" && !box.classList.contains("hidden")) {
      event.preventDefault();
      if (active >= 0) select(box.children[active].textContent);
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    if (box.classList.contains("hidden")) open();
    if (!box.children.length) return;
    active = (active + (event.key === "ArrowDown" ? 1 : (active < 0 ? 0 : -1)) + box.children.length) % box.children.length;
    [...box.children].forEach((option, index) => option.setAttribute("aria-selected", String(index === active)));
    input.setAttribute("aria-activedescendant", box.children[active].id);
    box.children[active].scrollIntoView({ block: "nearest" });
  });
}
function fieldElement(name, type, source, readonly) {
  if (type === "hidden") { const input = document.createElement("input"); input.type = "hidden"; return input; }
  if (type === "textarea") { const input = document.createElement("textarea"); input.rows = 1; input.maxLength = 500; return input; }
  if (type === "select") {
    const input = document.createElement("select");
    const values = Array.isArray(source) ? source : (state.suggestions[source] || []); values.forEach((value) => { const opt = document.createElement("option"); opt.value = value; opt.textContent = value; input.appendChild(opt); });
    return input;
  }
  const input = document.createElement("input");
  input.type = type === "decimal" || type === "autocomplete" ? "text" : type;
  if (type === "decimal") input.inputMode = "decimal";
  if (type === "autocomplete") input.autocomplete = "off";
  if (type === "number") input.min = "0";
  if (readonly) input.readOnly = true;
  if (["gram", "milyem", "satis_milyem"].includes(name)) input.required = true;
  return input;
}

/**
 * İşçilik birimi: TL ya da milyem. Milyemde iki kutu birlikte görünür ve birbirini
 * günceller: milyem yazılırsa gram × milyem / 1000 has, has fiyatıyla TL'ye çevrilir;
 * pazarlıkta TL tutarı elle değiştirilirse milyem geri hesaplanır. Kayıt yine TL
 * tutarıyla saklanır. Son seçim bu bilgisayarda hatırlanır; düzenlemede kayıt TL
 * olduğu için TL açılır.
 */
const ISCILIK_BIRIM_KEY = "iscilik_birim";
function attachIscilikUnit(form, isEditing, onChange) {
  const tl = form.elements.iscilik;
  const wrap = form.querySelector('[data-field="iscilik"]');
  if (!tl || !wrap) return;
  let mode = "TL";
  if (!isEditing) { try { mode = localStorage.getItem(ISCILIK_BIRIM_KEY) === "MILYEM" ? "MILYEM" : "TL"; } catch { /* varsayılan TL */ } }
  // Son elle yazılan kutu esas alınır; gram ya da has fiyatı değişince öteki yeniden hesaplanır.
  let source = "milyem";
  const milyem = document.createElement("input");
  milyem.type = "text"; milyem.name = "iscilik_milyem"; milyem.inputMode = "decimal"; milyem.placeholder = "Milyem";
  milyem.setAttribute("aria-label", "İşçilik (milyem)");
  attachDecimalGuard(milyem);
  const hint = document.createElement("small"); hint.className = "hint iscilik-hint";
  const toggle = document.createElement("span"); toggle.className = "unit-toggle";
  const btn = (value, text) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "secondary"; b.textContent = text; b.dataset.unit = value;
    b.onclick = () => setMode(value, true);
    return b;
  };
  toggle.append(btn("TL", "TL"), btn("MILYEM", "Milyem"));
  const head = document.createElement("span"); head.className = "iscilik-head";
  head.append("İşçilik", toggle);
  wrap.firstChild.replaceWith(head);
  const row = document.createElement("span"); row.className = "iscilik-row";
  tl.replaceWith(row); row.append(milyem, tl); row.after(hint);
  // Düğmeler etiketin içinde: etikete tıklamak düğmeye değil kutuya gitsin.
  tl.id ||= `iscilik-${Math.random().toString(36).slice(2)}`; milyem.id = `${tl.id}-m`;
  const text = (v, digits) => (v ? String(Math.round(v * 10 ** digits) / 10 ** digits).replace(".", ",") : "");
  const sync = () => {
    if (mode !== "MILYEM") { hint.textContent = ""; return; }
    const gram = parseNum(form.elements.gram?.value);
    const fiyat = parseNum(form.elements.has_fiyati?.value);
    if (source === "milyem") tl.value = text(gram * parseNum(milyem.value) / 1000 * fiyat, 2);
    else milyem.value = gram && fiyat ? text(parseNum(tl.value) / fiyat / gram * 1000, 2) : "";
    const has = gram * parseNum(milyem.value) / 1000;
    hint.textContent = has ? `${formatTurkishNumber(has, 0, 3)} has = ${formatValue("toplam_tutar", parseNum(tl.value))} \u20ba` : "";
  };
  function setMode(value, user) {
    mode = value;
    if (user) { try { localStorage.setItem(ISCILIK_BIRIM_KEY, value); } catch { /* yalnız bu oturum */ } }
    toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.unit === mode));
    milyem.hidden = mode !== "MILYEM";
    tl.placeholder = mode === "MILYEM" ? "TL" : "";
    wrap.htmlFor = mode === "MILYEM" ? milyem.id : tl.id;
    if (mode === "MILYEM") source = tl.value.trim() ? "tl" : "milyem";
    onChange();
  }
  milyem.addEventListener("input", () => { source = "milyem"; onChange(); });
  tl.addEventListener("input", () => { source = "tl"; }, true);
  form._syncIscilik = sync;
  setMode(mode, false);
}

function calcHas(form) {
  if (form.elements.has_override?.value.trim()) return parseNum(form.elements.has_override.value);
  const milyem = form.elements.satis_milyem ? parseNum(form.elements.satis_milyem.value) : parseNum(form.elements.milyem?.value);
  return parseNum(form.elements.gram.value) * milyem / 1000;
}

function ensureTransactionPaymentFields(form) {
  const defaults = { odeme_tipi: "ODEME_YOK", odenen_has: "0", odenen_gram: "0", odenen_milyem: "0" };
  Object.entries(defaults).forEach(([name, value]) => {
    if (!form.elements[name]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
  });
}

function paymentLabel(value) {
  return ({ ODEME_YOK: "Ödeme Yok", HAS: "Has ile Ödeme", ADET_GRAM_MILYEM: "Gram + Milyem", TAM_KAPAT: "Borcu Tam Kapat" })[value] || "deme Yok";
}

function calculatedTransactionPayment(form) {
  const tip = form.elements.odeme_tipi.value || "ODEME_YOK";
  if (tip === "HAS") return parseNum(form.elements.odenen_has.value);
  if (tip === "ADET_GRAM_MILYEM") return parseNum(form.elements.odenen_gram.value) * parseNum(form.elements.odenen_milyem.value) / 1000;
  if (tip === "TAM_KAPAT") return calcHas(form);
  return 0;
}

function syncTransactionPayment(form) {
  const tip = form.elements.odeme_tipi.value || "ODEME_YOK";
  if (tip === "ADET_GRAM_MILYEM" || tip === "TAM_KAPAT") form.elements.odenen_has.value = String(calculatedTransactionPayment(form));
  if (tip === "ODEME_YOK") {
    form.elements.odenen_has.value = "0";
    form.elements.odenen_gram.value = "0";
    form.elements.odenen_milyem.value = "0";
  }
  form._refreshPaymentSummary?.();
}

function attachPaymentButton(form) {
  ensureTransactionPaymentFields(form);
  const box = document.createElement("div");
  box.className = "payment-action-box";
  box.innerHTML = `
    <div><span>\u00d6deme Bilgisi</span><strong data-payment-summary>\u00d6deme Yok</strong></div>
    <button type="button" class="secondary payment-open-btn">\u00d6deme Ekle / D\u00fczenle</button>
  `;
  form._refreshPaymentSummary = () => {
    const paidHas = calculatedTransactionPayment(form);
    const text = `${paymentLabel(form.elements.odeme_tipi.value)}${paidHas ? ` - ${formatValue("has", paidHas)} has` : ""}`;
    box.querySelector("[data-payment-summary]").textContent = text;
  };
  box.querySelector("button").addEventListener("click", () => openTransactionPaymentModal(form));
  [form.elements.gram, form.elements.milyem, form.elements.satis_milyem].filter(Boolean).forEach((input) => input.addEventListener("input", () => syncTransactionPayment(form)));
  form._refreshPaymentSummary();
  attachKasaQuickPay(form, box);
  return box;
}

function modalField(label, input) {
  const wrap = document.createElement("label");
  wrap.className = "field field-main";
  wrap.append(label, input);
  return wrap;
}

function paymentInput(name, placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.value = "";
  input.placeholder = placeholder;
  return input;
}

function openTransactionPaymentModal(form) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const box = document.createElement("div");
  box.className = "modal-box payment-modal transaction-payment-modal";
  const title = document.createElement("h3");
  title.className = "modal-title";
  title.textContent = "\u00d6deme Bilgisi";

  let selectedPaymentType = form._kasa?.length ? "KASA" : (form.elements.odeme_tipi.value || "ODEME_YOK");
  const paymentTabs = document.createElement("div");
  paymentTabs.className = "payment-type-tabs";
  const paymentOptions = [
    ["ODEME_YOK", "\u00d6deme Yok"],
    ["HAS", "Has ile \u00d6deme"],
    ["ADET_GRAM_MILYEM", "Gram + Milyem"],
    ["TAM_KAPAT", "Borcu Tam Kapat"],
    ["KASA", "Nakit / Kart / Havale"],
  ];
  paymentOptions.forEach(([value, label]) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "payment-type-tab";
    tab.dataset.value = value;
    tab.textContent = label;
    tab.onclick = () => {
      selectedPaymentType = value;
      update();
    };
    paymentTabs.appendChild(tab);
  });

  const paidInput = document.createElement("input");
  paidInput.type = "text";
  paidInput.inputMode = "decimal";
  paidInput.value = paymentDisplayValue(form.elements.odenen_has.value);
  paidInput.placeholder = "\u00d6denen has";

  const gramInput = document.createElement("input");
  gramInput.type = "text";
  gramInput.inputMode = "decimal";
  gramInput.value = paymentDisplayValue(form.elements.odenen_gram.value);

  const milyemInput = document.createElement("input");
  milyemInput.type = "text";
  milyemInput.inputMode = "decimal";
  milyemInput.value = paymentDisplayValue(form.elements.odenen_milyem.value);

  const calculated = document.createElement("div");
  calculated.className = "has-preview payment-preview";
  calculated.innerHTML = `<span>Hesaplanan \u00d6denen Has</span><strong data-calculated-payment>0</strong>`;

  const paidField = modalField("\u00d6denen Has", paidInput);
  const gramField = modalField("Gram", gramInput);
  const milyemField = modalField("Milyem", milyemInput);
  paidField.classList.add("payment-fill-field", "transaction-paid-field");
  gramField.classList.add("payment-fill-field", "transaction-product-payment-field", "payment-gram-field");
  milyemField.classList.add("payment-fill-field", "transaction-product-payment-field", "payment-milyem-field");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "secondary";
  closeBtn.textContent = "\u0130ptal";
  closeBtn.onclick = () => overlay.remove();
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "\u00d6demeyi Uygula";

  const kasaPanel = transactionKasaPanel(form);
  const update = () => {
    const tip = selectedPaymentType;
    kasaPanel.panel.hidden = tip !== "KASA";
    [paidField, gramField, milyemField, calculated].forEach((el) => { el.hidden = tip === "KASA"; });
    paymentTabs.querySelectorAll(".payment-type-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.value === tip));
    paidField.classList.toggle("payment-inactive", tip !== "HAS");
    paidInput.disabled = tip !== "HAS";
    [gramField, milyemField].forEach((field) => field.classList.toggle("payment-inactive", tip !== "ADET_GRAM_MILYEM"));
    [gramInput, milyemInput].forEach((input) => input.disabled = tip !== "ADET_GRAM_MILYEM");
    calculated.classList.toggle("payment-inactive", tip === "HAS" || tip === "ODEME_YOK");
    let value = 0;
    if (tip === "HAS") value = parseNum(paidInput.value);
    if (tip === "ADET_GRAM_MILYEM") value = parseNum(gramInput.value) * parseNum(milyemInput.value) / 1000;
    if (tip === "TAM_KAPAT") value = calcHas(form);
    calculated.querySelector("[data-calculated-payment]").textContent = formatValue("has", value);
  };

  [paidInput, gramInput, milyemInput].forEach((input) => {
    attachDecimalGuard(input);
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
  saveBtn.onclick = () => {
    try {
      if (selectedPaymentType === "KASA") {
        applyKasaToForm(form, kasaPanel.editor.validate());
        overlay.remove();
        return;
      }
      form._kasa = [];
      form._kasaAuto = false;
      if (selectedPaymentType === "HAS") positiveValue(paidInput, "\u00d6denen has");
      if (selectedPaymentType === "ADET_GRAM_MILYEM") {
        positiveValue(gramInput, "Gram");
        positiveValue(milyemInput, "Milyem");
      }
      if (selectedPaymentType === "TAM_KAPAT" && calcHas(form) <= 0) throw new Error("Kapat\u0131lacak has bulunamad\u0131.");
      form.elements.odeme_tipi.value = selectedPaymentType;
        form.elements.odenen_gram.value = gramInput.value || "0";
      form.elements.odenen_milyem.value = milyemInput.value || "0";
      form.elements.odenen_has.value = selectedPaymentType === "HAS" ? paidInput.value : String(selectedPaymentType === "ODEME_YOK" ? 0 : (selectedPaymentType === "TAM_KAPAT" ? calcHas(form) : parseNum(gramInput.value) * parseNum(milyemInput.value) / 1000));
      syncTransactionPayment(form);
      form._refreshPaymentSummary?.();
      overlay.remove();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const actions = document.createElement("div");
  actions.className = "form-bottom-actions";
  actions.append(closeBtn, saveBtn);
  box.append(title, paymentTabs, paidField, gramField, milyemField, calculated, kasaPanel.panel, actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  update();
}function renderForm(type, hurdaMode = null) {
  const isEditing = editing?.type === type;
  const panel = document.createElement("section");
  panel.className = "panel form-panel";
  const form = document.createElement("form");
  form.className = "entry-form";
  ensureTransactionPaymentFields(form);

  if (type === "satis") form.appendChild(renderSelectAction("STOKTAN \u00dcR\u00dcN SE\u00c7", "Sat\u0131\u015f i\u00e7in stoktan \u00fcr\u00fcn se\u00e7in.", (label) => openPurchaseModal(form, label)));
  if (type === "hurda" && hurdaMode === "SATIS") form.appendChild(renderSelectAction("HURDA STOKTAN SE\u00c7", "Hurda sat\u0131\u015f i\u00e7in stoktan se\u00e7im yap\u0131n.", (label) => openHurdaPurchaseModal(form, label)));

  if (type === "satis" || (type === "hurda" && hurdaMode === "SATIS")) {
    const stockMode = document.createElement("input"); stockMode.type = "hidden"; stockMode.name = "stoktan"; stockMode.value = "true"; form.appendChild(stockMode);
  }

  // Both sale screens share the same visible fields; keep the scrap API names.
  const formFields = type === "hurda" && hurdaMode === "SATIS" ? [
    ...forms.hurda.filter(([, , inputType]) => inputType === "hidden"),
    ...forms.satis.filter(([, , inputType]) => inputType !== "hidden").map(field => {
      if (field[0] === "musteri") return ["kisi", field[1], field[2], "people"];
      if (field[0] === "satis_milyem") return ["milyem", ...field.slice(1)];
      return field;
    }),
  ] : forms[type];
  formFields.forEach(([name, label, inputType, source, readonly]) => {
    const input = fieldElement(name, inputType, source, readonly);
    input.name = name;
    if (inputType === "hidden") { form.appendChild(input); return; }
    const wrap = document.createElement("label");
    wrap.className = "field field-main";
    wrap.dataset.field = name;
    wrap.append(label, input);
    if (type === "hurda" && hurdaMode && name === "islem_turu") wrap.classList.add("hidden");
    if (name === "tarih") input.value = today();
    if (type === "hurda" && name === "cinsi") input.value = "HURDA";
    if (["cinsi", "ayar", "tedarikci", "musteri", "kisi"].includes(name)) input.required = true;
    form.appendChild(wrap);
    if (inputType === "autocomplete") attachAutocomplete(input, source);
  });

  if (type === "hurda" && hurdaMode && form.elements.islem_turu) form.elements.islem_turu.value = hurdaMode;

  if (type === "hurda") {
    const modeSelect = form.elements.islem_turu;
    const purchaseActions = form.querySelector(".purchase-actions");
    const updateHurdaMode = () => {
      const isSale = normalize(modeSelect.value).startsWith("satis");
      if (purchaseActions) purchaseActions.classList.toggle("hidden", !isSale);
      const milyemField = form.querySelector('[data-field="milyem"]');
      if (milyemField.firstChild) milyemField.firstChild.textContent = isSale ? "Sat\u0131\u015f Milyem" : "Al\u0131\u015f Milyem";
      if (form.elements.milyem) form.elements.milyem.placeholder = isSale ? "Sat\u0131\u015f milyem girin" : "Al\u0131\u015f milyem girin";
      if (!isSale) {
        state.selectedHurdaPurchase = null;
        if (form.elements.hurda_alis_id) form.elements.hurda_alis_id.value = "";
        if (form.elements.cinsi) form.elements.cinsi.readOnly = false;
        if (form.elements.ayar) form.elements.ayar.readOnly = false;
      } else {
        if (form.elements.cinsi) form.elements.cinsi.readOnly = true;
        if (form.elements.ayar) form.elements.ayar.readOnly = true;
      }
    };
    modeSelect.addEventListener("change", updateHurdaMode);
    updateHurdaMode();
  }
  const preview = document.createElement("div");
  preview.className = "has-preview";
  preview.innerHTML = "<span>Hesaplanan Has</span><strong data-has>0</strong><span>Gram</span><strong data-gram>0</strong><span>Tutar (TL)</span><strong data-tutar>0</strong>";
  const manualHas = document.createElement("input");
  manualHas.type = "text"; manualHas.name = "has_override"; manualHas.inputMode = "decimal";
  manualHas.placeholder = "Otomatik"; manualHas.setAttribute("aria-label", "Manuel has");
  manualHas.className = "manual-has-input"; attachDecimalGuard(manualHas);
  const manualLabel = document.createElement("label"); manualLabel.className = "manual-has-label";
  manualLabel.append("Manuel has", manualHas);
  const automatic = document.createElement("button"); automatic.type = "button"; automatic.className = "secondary has-auto";
  automatic.textContent = "Otomatik";
  automatic.title = "Elle yazılan hası siler; has yeniden gram × milyem ile hesaplanır.";
  automatic.onclick = () => { manualHas.value = ""; restoreAutomaticPurity(); updatePreview(); syncTransactionPayment(form); };
  preview.append(manualLabel, automatic);
  form.dataset.kasaYon = type === "satis" || (type === "hurda" && hurdaMode === "SATIS") ? "GIRIS" : "CIKIS";
  const payment = attachPaymentButton(form);
  {
    const summaryRow = document.createElement("div"); summaryRow.className = "sale-summary-row";
    summaryRow.append(preview, payment); form.appendChild(summaryRow);
  }
  const updatePreview = () => {
    // Otomatik düğmesi yalnızca elle has yazılmışken iş yapar.
    automatic.disabled = !manualHas.value.trim();
    updateStockMilyem(form);
    form._syncIscilik?.();
    preview.querySelector("[data-has]").textContent = formatValue("has", calcHas(form));
    preview.querySelector("[data-gram]").textContent = formatValue("gram", parseNum(form.elements.gram.value));
    const tutar = calcHas(form) * parseNum(form.elements.has_fiyati?.value) + parseNum(form.elements.iscilik?.value);
    preview.querySelector("[data-tutar]").textContent = `${formatValue("toplam_tutar", tutar)} \u20ba`;
    form._onTotalChange?.(Math.round(tutar * 100) / 100);
  };
  ["has_fiyati", "iscilik"].forEach((name) => {
    const input = form.elements[name];
    if (!input) return;
    attachDecimalGuard(input);
    input.addEventListener("input", updatePreview);
  });
  attachIscilikUnit(form, isEditing, updatePreview);
  // Yeni kayıtta has fiyatı canlı fiyatı izler (alışta alış, satışta satış fiyatı);
  // kullanıcı elle değiştirirse yazdığı değer korunur.
  const isSaleForm = type === "satis" || (type === "hurda" && hurdaMode === "SATIS");
  const purityInput = form.elements.satis_milyem || form.elements.milyem;
  if (!isEditing && form.elements.has_fiyati) {
    // Sarrafiye seçiliyse (çeyrek, yarım...) tutar panodaki adet fiyatıyla aynı çıkacak şekilde has fiyatı türetilir.
    const side = isSaleForm ? "satis" : "alis";
    followLivePrice(form.elements.has_fiyati, side, () => productHasPrice(form.elements.cinsi?.value, purityInput?.value, side));
    const refresh = () => setLivePrice(form.elements.has_fiyati);
    ["input", "change"].forEach((ev) => form.elements.cinsi?.addEventListener(ev, refresh));
    purityInput?.addEventListener("input", refresh);
  }
  let automaticPurity;
  function restoreAutomaticPurity() {
    if (automaticPurity !== undefined) purityInput.value = automaticPurity;
    automaticPurity = undefined; manualHas.setCustomValidity("");
  }
  function syncManualPurity() {
    manualHas.setCustomValidity("");
    if (!manualHas.value.trim()) { restoreAutomaticPurity(); return; }
    if (automaticPurity === undefined) automaticPurity = purityInput.value;
    const gram = parseNum(form.elements.gram.value);
    if (gram <= 0) { manualHas.setCustomValidity("Manuel has i\u00e7in gram s\u0131f\u0131rdan b\u00fcy\u00fck olmal\u0131."); return; }
    purityInput.value = String(parseNum(manualHas.value) * 1000 / gram);
  }
  form.elements.gram.addEventListener("input", () => { if (manualHas.value.trim()) syncManualPurity(); updatePreview(); syncTransactionPayment(form); });
  purityInput.addEventListener("input", () => { manualHas.value = ""; automaticPurity = undefined; manualHas.setCustomValidity(""); updatePreview(); syncTransactionPayment(form); });
  manualHas.addEventListener("input", () => { syncManualPurity(); updatePreview(); syncTransactionPayment(form); });
  form._updatePreview = updatePreview;
  attachSarrafiye(form, type === "alis" || (type === "hurda" && hurdaMode !== "SATIS"));
  updatePreview();

  const actions = document.createElement("div");
  actions.className = "form-bottom-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = isEditing ? "G\u00fcncelle" : "Kaydet";
  actions.appendChild(save);
  if (isEditing) {
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary"; cancel.textContent = "\u0130ptal";
    cancel.onclick = () => { editing = null; state.selectedPurchase = null; state.selectedHurdaPurchase = null; render(); };
    actions.appendChild(cancel);
  }
  form.appendChild(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form._syncIscilik?.();
    syncTransactionPayment(form);
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.has_override?.trim()) delete data.has_override;
    delete data.iscilik_milyem;
    if (form._kasa) data.kasa = form._kasa.map((k) => ({ hesap_id: k.hesap_id, tutar: String(k.tutar), kur: k.kur ? String(k.kur) : null }));
    if (type === "alis") { data.ek_masraf = 0; data.odenen = 0; }
    if (type === "satis") {
      data.stoktan = ["true", "1"].includes(String(data.stoktan));
      if (data.stoktan) {
        if (!state.selectedPurchase?.stoktan && !isEditing) { showMessage("Stoktan \u00fcr\u00fcn se\u00e7in.", true); return; }
        delete data.purchase_id; delete data.alis_id;
      } else {
        const selectedId = state.selectedPurchase?.id || data.purchase_id || data.alis_id;
        if (!selectedId) { showMessage("Sat\u0131\u015f i\u00e7in stoktan \u00fcr\u00fcn se\u00e7in.", true); return; }
        data.purchase_id = selectedId; data.alis_id = selectedId;
      }
      data.milyem = data.satis_milyem;
      data.ek_ucret = 0;
      data.indirim = 0;
      data.alinan = 0;
    }
    if (type === "hurda") {
      if (hurdaMode) data.islem_turu = hurdaMode;
      delete data.alis_milyem; // Display only; the linked purchase remains the source of cost.
      data.odenen_veya_alinan = 0;
      if (normalize(data.islem_turu).startsWith("satis")) {
        data.stoktan = ["true", "1"].includes(String(data.stoktan));
        if (data.stoktan) {
          if (!state.selectedHurdaPurchase?.stoktan && !isEditing) { showMessage("Hurda stoktan \u00fcr\u00fcn se\u00e7in.", true); return; }
          delete data.hurda_alis_id;
        } else {
          const selectedId = state.selectedHurdaPurchase?.id || data.hurda_alis_id;
          if (!selectedId) { showMessage("Hurda stoktan \u00fcr\u00fcn se\u00e7in.", true); return; }
          data.hurda_alis_id = selectedId;
        }
      } else {
        delete data.hurda_alis_id;
      }
    }
    const actionText = isEditing ? "g\u00fcncellemek" : "kaydetmek";
    const messages = { alis: `Bu al\u0131\u015f kayd\u0131n\u0131 ${actionText} istiyor musunuz`, satis: `Bu sat\u0131\u015f kayd\u0131n\u0131 ${actionText} istiyor musunuz`, hurda: `Bu hurda kayd\u0131n\u0131 ${actionText} istiyor musunuz` };
    if (!(await showConfirm(messages[type], isEditing ? "G\u00fcncelle" : "Kaydet", "\u0130ptal"))) return;
    let printAfter = null;
    try {
      if (isEditing) {
        await api(`/api/${type}/${editing.id}`, { method: "PUT", body: JSON.stringify(data) });
        showMessage(`${formViewMeta(type, hurdaMode).title} g\u00fcncellendi.`);
      } else {
        const saved = await api(`/api/${type}`, { method: "POST", body: JSON.stringify(data) });
        showMessage(`${formViewMeta(type, hurdaMode).title} kaydedildi. Has: ${formatValue("has", saved.has)}${saved.etiketler?.length ? ` · ${saved.etiketler.length} etiket` : ""}`);
        if (data.etiket_bas && saved.etiketler?.length && typeof openPrintLabels === "function") printAfter = saved.etiketler;
      }
      editing = null;
      state.selectedPurchase = null;
      state.selectedHurdaPurchase = null;
      await refreshSuggestions();
      render();
      if (printAfter) openPrintLabels(printAfter);
    } catch (error) { showMessage(error.message, true); }
  });

  panel.appendChild(form);
  return panel;
}

function formViewMeta(type, hurdaMode = null) {
  if (type === "hurda") return hurdaMode === "SATIS" ? views.hurda_satis : views.hurda_alis;
  return views[type] || { title: "Kay\u0131t" };
}
function renderSelectAction(text, note, onClick) {
  const wrap = document.createElement("div");
  wrap.className = "purchase-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-toggle filter-toggle-active";
  btn.textContent = text;
  const label = document.createElement("span");
  label.className = "purchase-note";
  label.textContent = note;
  btn.addEventListener("click", () => onClick(label));
  wrap.append(btn, label);
  return wrap;
}

function showSelectedPurchase(label, row, includeMilyem = false) {
  const remaining = document.createElement("strong");
  remaining.className = "purchase-remaining";
  remaining.textContent = `${row.kalan_gram} gr`;
  const prefix = `Se\u00e7ilen: ${row.cinsi} ${row.ayar} | ${includeMilyem ? `Al\u0131\u015f milyem ${row.milyem} | ` : ""}`;
  label.replaceChildren(document.createTextNode(`${prefix}Kalan `), remaining, document.createTextNode(` / ${row.kalan_has} has`));
}

function updateStockMilyem(form) {
  if (!["true", "1"].includes(String(form.elements.stoktan?.value))) return;
  const stock = form.elements.hurda_alis_id ? state.selectedHurdaPurchase : state.selectedPurchase;
  if (!stock?.kaynaklar || !form.elements.alis_milyem) return;
  const previous = form._stockEditSnapshot;
  if (previous && parseNum(form.elements.gram.value) === Number(previous.gram) && normalize(previous.cinsi) === normalize(form.elements.cinsi.value) && normalize(previous.ayar) === normalize(form.elements.ayar.value)) {
    form.elements.alis_milyem.value = previous.alis_milyem; return;
  }
  let needed = parseNum(form.elements.gram.value);
  if (needed <= 0) { form.elements.alis_milyem.value = stock.alis_milyem; return; }
  let total = 0, used = 0;
  for (const lot of stock.kaynaklar) {
    const take = Math.min(needed, Number(lot.gram)); total += take * Number(lot.milyem); used += take; needed -= take;
    if (needed <= 0) break;
  }
  form.elements.alis_milyem.value = used ? String(Math.round(total / used * 1000) / 1000) : "";
}

async function openStockModal(form, chosenLabel, scrap = false) {
  try {
    const excluded = editing?.type === (scrap ? "hurda" : "satis") ? `?exclude_sale_id=${editing.id}` : "";
    const rows = await api(`/api/stok/${scrap ? "hurda" : "normal"}/secenekler${excluded}`);
    if (!form.isConnected) return;
    if (!rows.length) { showMessage("Se\u00e7ilebilir stok yok.", true); return; }
    openSelectableModal(scrap ? "Hurda Stoktan Se\u00e7" : "Stoktan \u00dcr\u00fcn Se\u00e7", ["cinsi", "ayar", "kalan_gram", "kalan_has"], rows, row => {
      if (scrap) state.selectedHurdaPurchase = row; else state.selectedPurchase = row;
      form.elements.stoktan.value = "true";
      if (form.elements.purchase_id) form.elements.purchase_id.value = "";
      if (form.elements.alis_id) form.elements.alis_id.value = "";
      if (form.elements.hurda_alis_id) form.elements.hurda_alis_id.value = "";
      form.elements.cinsi.value = row.cinsi; form.elements.ayar.value = row.ayar;
      const saleMilyem = form.elements.satis_milyem || form.elements.milyem;
      saleMilyem.value = "";
      if (form.elements.has_fiyati) setLivePrice(form.elements.has_fiyati);
      showSelectedPurchase(chosenLabel, row); form._updatePreview?.();
      if (!scrap) suggestFromStock(form, row);
    });
  } catch (error) { showMessage(error.message, true); }
}

async function openPurchaseModal(form, chosenLabel) { return openStockModal(form, chosenLabel); }
async function openHurdaPurchaseModal(form, chosenLabel) { return openStockModal(form, chosenLabel, true); }

function openSelectableModal(titleText, cols, rows, onSelect) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const box = document.createElement("div");
  box.className = "modal-box modal-box-wide";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.innerHTML = `<h2>${titleText}</h2>`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "filter-clear";
  close.textContent = "Kapat";
  close.onclick = () => overlay.remove();
  title.appendChild(close);
  box.append(title, renderSelectableTable(cols, rows, (row) => { onSelect(row); overlay.remove(); }));
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function renderSelectableTable(cols, rows, onSelect) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  if (!rows.length) { wrap.innerHTML = '<div class="empty">Kay\u0131t yok.</div>'; return wrap; }
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>${cols.map((col) => `<th>${labels[col] || col}</th>`).join("")}<th>Se\u00e7</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      td.dataset.label = labels[col] || col;
      td.textContent = formatValue(col, row[col]);

      if (moneyFields.has(col) || numberFields.has(col)) td.className = "num";
      tr.appendChild(td);
    });
    const td = document.createElement("td");
    td.dataset.label = "Se\u00e7";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-toggle filter-toggle-active";
    btn.textContent = "Se\u00e7";
    btn.onclick = () => onSelect(row);
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function valueOrFallback(value, fallback) {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function enrichHurdaRows(rows) {
  const allRows = rows || [];
  const purchases = new Map(allRows.filter((row) => normalize(row.islem_turu).startsWith("alis")).map((row) => [Number(row.id), row]));
  const saleTotalsByPurchase = new Map();
  allRows.forEach((row) => {
    if (!normalize(row.islem_turu).startsWith("satis")) return;
    const purchaseId = Number(row.hurda_alis_id || 0);
    if (!purchaseId) return;
    const current = saleTotalsByPurchase.get(purchaseId) || { gram: 0, has: 0 };
    current.gram += parseNum(row.gram);
    current.has += parseNum(row.has);
    saleTotalsByPurchase.set(purchaseId, current);
  });

  return allRows.map((row) => {
    if (!normalize(row.islem_turu).startsWith("satis")) return row;
    const purchase = purchases.get(Number(row.hurda_alis_id));
    const totals = saleTotalsByPurchase.get(Number(row.hurda_alis_id)) || { gram: 0, has: 0 };
    const alisMilyem = Number(valueOrFallback(row.alis_milyem, purchase?.milyem || 0));
    const satisMilyem = Number(valueOrFallback(row.satis_milyem, row.milyem || 0));
    const milyemFarki = Number(valueOrFallback(row.milyem_farki, satisMilyem - alisMilyem));
    const milyemKari = Number(valueOrFallback(row.milyem_kari, parseNum(row.gram) * milyemFarki / 1000));
    const kalanGram = valueOrFallback(row.kalan_gram, purchase ? parseNum(purchase.gram) - totals.gram : "");
    const kalanHas = valueOrFallback(row.kalan_has, purchase ? parseNum(purchase.has) - totals.has : "");
    return {
      ...row,
      alis_milyem: alisMilyem,
      satis_milyem: satisMilyem,
      milyem_farki: milyemFarki,
      milyem_kari: milyemKari,
      has_kari: valueOrFallback(row.has_kari, milyemKari),
      kalan_gram: kalanGram,
      kalan_has: kalanHas,
    };
  });
}function filteredRows(rows) {
  const needle = normalize(state.search);
  if (!needle) return rows;
  return rows.filter((row) => normalize(Object.values(row).join(" ")).includes(needle));
}

function iconSvg(kind) {
  if (kind === "view") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  if (kind === "close") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>';
  if (kind === "edit") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L17.5 5.5a2.1 2.1 0 0 0-3 0L4 16v4Z"></path><path d="M13.5 7.5l3 3"></path></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>';
}

function columnLabel(type, col) {
  if (col === "net_bakiye_has") return "NET HAS BAK\u0130YES\u0130 (gr)";
  const label = labels[col] || col;
  const hasGram = col === "has" || col.endsWith("_has") || ["has_kari", "milyem_kari", "tahmini_kar", "tutar"].includes(col);
  return hasGram ? `${label} (gr)` : label;
}

function tableSummaryMetrics(type, rows) {
  const sum = value => rows.reduce((total, row) => total + value(row), 0);
  const quantity = key => sum(row => Number(row[key] || 0));
  if (["stok", "hurdaStok"].includes(type)) return [
    ["gram", "Toplam gram", quantity("kalan_gram"), "gr"],
    ["has", "Toplam has", quantity("kalan_has"), "has"],
  ];
  if (["alis", "hurdaAlis"].includes(type)) return [
    ["gram", "Al\u0131nan gram", quantity("gram"), "gr"],
    ["has", "Al\u0131\u015f has", quantity("has"), "has"],
  ];
  if (["satis", "hurdaSatis"].includes(type)) return [
    ["gram", "Sat\u0131lan gram", quantity("gram"), "gr"],
    ["profit", "Milyem k\u00e2r\u0131", quantity("milyem_kari"), "has"],
  ];
  if (["kisiCari", "musteriCari", "tedarikciCari"].includes(type)) return [
    ["receivable", "Alaca\u011f\u0131m\u0131z", sum(row => Math.max(Number(row.net_bakiye_has || 0), 0)), "has"],
    ["payable", "\u00d6deyece\u011fimiz", sum(row => Math.max(-Number(row.net_bakiye_has || 0), 0)), "has"],
  ];
  if (type === "cariOdeme") return [
    ["collected", "Tahsil edilen", sum(row => row.yon === "TAHSILAT" ? Number(row.odenen_has || 0) : 0), "has"],
    ["paid", "\u00d6denen", sum(row => row.yon === "ODEME" ? Number(row.odenen_has || 0) : 0), "has"],
  ];
  return [];
}

function renderTable(type, rows, title = "", applySearch = true) {
  const section = document.createElement("section");
  section.className = "table-section";
  if (["stok", "hurdaStok"].includes(type)) rows = (rows || []).filter(row => Number(row.kalan_gram) !== 0);
  rows = applySearch ? filteredRows(rows || []) : (rows || []);
  if (title) {
    const h = document.createElement("h2"); h.textContent = title;
    const metrics = tableSummaryMetrics(type, rows);
    if (metrics.length) {
      const header = document.createElement("div"); header.className = "stock-table-heading";
      const summary = document.createElement("div"); summary.className = "stock-heading-summary table-heading-summary";
      metrics.forEach(([key, label, total, unit]) => {
        const metric = document.createElement("span");
        const amount = document.createElement("strong"); amount.dataset.summaryMetric = key;
        if (["stok", "hurdaStok"].includes(type)) amount.dataset.stockTotal = key;
        amount.textContent = `${formatValue(unit === "gr" ? "gram" : "has", total)} ${unit}`;
        const caption = document.createElement("span"); caption.className = "stock-summary-label"; caption.textContent = `${label}:`;
        metric.append(caption, amount); summary.appendChild(metric);
      });
      header.append(h, summary); section.appendChild(header);
    } else section.appendChild(h);
    if (rows.length) h.appendChild(csvButton(type, rows, title));
  }
  section.dataset.tableType = type;
  if (["kisiCari", "musteriCari", "tedarikciCari", "cariOdeme"].includes(type)) section.classList.add("cari-table");
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  if (!rows.length) { wrap.innerHTML = '<div class="empty">Kay\u0131t yok.</div>'; section.appendChild(wrap); return section; }
  const cols = columns[type];
  const actionType = type === "hurdaAlis" || type === "hurdaSatis" ? "hurda" : type;
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr>${cols.map((col) => `<th>${columnLabel(type, col)}</th>`).join("")}${["giderler", "alis", "satis", "hurda", "hurdaAlis", "hurdaSatis", "kisiCari", "musteriCari", "tedarikciCari", "cariOdeme", "cariHistory"].includes(type) ? "<th>\u0130\u015flemler</th>" : ""}</tr></thead>`;
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      td.dataset.label = columnLabel(type, col);
      td.dataset.col = col;
      td.textContent = formatValue(col, row[col]);
      if (["not", "notlar"].includes(col)) {
        td.classList.add("note-cell"); td.textContent = "";
        if (row[col]) {
          const note = document.createElement("button"); note.type = "button"; note.className = "note-preview";
          note.textContent = String(row[col]); note.setAttribute("aria-label", "Notun tamam\u0131n\u0131 g\u00f6ster");
          note.onclick = () => openNote(String(row[col])); td.appendChild(note);
        }
      }
      if (moneyFields.has(col) || numberFields.has(col)) td.className = "num";
      if (["stok", "hurdaStok"].includes(type) && ["kalan_gram", "kalan_has"].includes(col)) td.classList.add("stock-priority");
      if (col === "net_bakiye_has") {
        td.title = Number(row[col]) > 0 ? "Alacağımız has gram" : Number(row[col]) < 0 ? "Ödeyeceğimiz has gram" : "Bakiye kapalı";
        td.classList.add("cari-net-balance", Number(row[col]) > 0 ? "pos" : Number(row[col]) < 0 ? "neg" : "balance-zero");
      } else if (["milyem_farki", "has_kari", "milyem_kari"].includes(col)) td.classList.add(Number(row[col]) >= 0 ? "pos" : "neg");
      tr.appendChild(td);
    });
    if (["kisiCari", "musteriCari", "tedarikciCari"].includes(type)) {
      const td = document.createElement("td");
      td.className = "actions-cell";
      td.dataset.label = "\u0130\u015flemler";
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "icon-btn icon-edit kebab-btn";
      menu.title = "Cari i\u015flemleri";
      menu.setAttribute("aria-label", "Cari i\u015flemleri");
      menu.textContent = "\u22ee";
      menu.onclick = () => openCariActions(row, state.cariData || { kisiler: [] });
      const detail = document.createElement("button"); detail.type = "button";
      detail.className = "icon-btn icon-detail cari-detail-btn"; detail.innerHTML = iconSvg("view");
      detail.title = "Cari detay\u0131n\u0131 g\u00f6ster"; detail.setAttribute("aria-label", detail.title);
      detail.onclick = () => openCariDetail(row.isim || row.musteri_adi || row.tedarikci_adi);
      td.append(detail, cariKartButton(row), menu);
      tr.appendChild(td);
    }
    if (type === "cariOdeme") {
      const td = document.createElement("td");
      td.className = "actions-cell";
      td.dataset.label = "\u0130\u015flemler";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon-btn icon-edit";
      edit.title = "\u00d6demeyi d\u00fczenle";
      edit.innerHTML = iconSvg("edit");
      edit.onclick = () => openCariPaymentModal(state.cariData || { kisiler: [] }, row.isim, row);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn icon-delete";
      del.title = "\u00d6demeyi sil";
      del.innerHTML = iconSvg("delete");
      del.onclick = async () => { if (await showConfirm("Bu cari \u00f6deme kayd\u0131 silinsin mi", "Sil", "\u0130ptal")) { try { await api(`/api/cari/odeme/${row.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } };
      const detail = document.createElement("button"); detail.type = "button";
      detail.className = "icon-btn icon-detail cari-detail-btn"; detail.innerHTML = iconSvg("view");
      detail.title = "Cari detay\u0131n\u0131 g\u00f6ster"; detail.setAttribute("aria-label", detail.title);
      detail.onclick = () => openCariDetail(row.isim);
      td.append(detail, printButton("cari", row), edit, del);
      tr.appendChild(td);
    }
    if (["giderler", "alis", "satis", "hurda", "hurdaAlis", "hurdaSatis"].includes(type)) {
      const td = document.createElement("td");
      td.className = "actions-cell";
      td.dataset.label = "\u0130\u015flemler";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon-btn icon-edit";
      edit.title = "D\u00fczenle";
      edit.setAttribute("aria-label", "D\u00fczenle");
      edit.innerHTML = iconSvg("edit");
      edit.onclick = () => startEdit(actionType, row);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn icon-delete";
      del.title = "Sil";
      del.setAttribute("aria-label", "Sil");
      del.innerHTML = iconSvg("delete");
      del.onclick = async () => { if (await showConfirm("Bu kayd\u0131 silmek istedi\u011finize emin misiniz", "Sil", "\u0130ptal")) { try { await api(`/api/${actionType}/${row.id}`, { method: "DELETE" }); render(); } catch (error) { showMessage(error.message, true); } } };
      if (actionType !== "giderler") td.append(printButton(actionType, row));
      td.append(edit, del);
      tr.appendChild(td);
    }
    if (type === "cariHistory" && row.openRecord) {
      const td = document.createElement("td"); td.className = "actions-cell";
      const go = document.createElement("button"); go.type = "button"; go.className = "icon-btn";
      go.innerHTML = iconSvg("edit"); go.title = "As\u0131l kayd\u0131 a\u00e7"; go.setAttribute("aria-label", go.title);
      go.onclick = row.openRecord; td.appendChild(go); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

async function startEdit(type, row) {
  editing = { type, id: row.id };
  state.selectedPurchase = null;
  state.selectedHurdaPurchase = null;
  await render();
  setTimeout(async () => {
    const form = document.querySelector(".entry-form");
    if (!form || editing?.type !== type || editing?.id !== row.id) return;
    Object.entries(row).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ""; });
    form.elements.islem_turu?.dispatchEvent(new Event("change"));
    if (form.elements.notlar) form.elements.notlar.value = row.notlar ?? row.not ?? "";
    if (type === "satis") {
      const selectedId = row.purchase_id || row.alis_id;
      state.selectedPurchase = selectedId ? { id: selectedId, has_fiyati: row.has_fiyati || 0 } : null;
      form.elements.purchase_id.value = selectedId || "";
      form.elements.alis_id.value = selectedId || "";
      form.elements.satis_milyem.value = row.satis_milyem || row.milyem || "";
    }
    if (form.elements.has_override) {
      form.elements.has_override.value = row.has_override ?? "";
      form._updatePreview?.();
    }
    if (type !== "giderler") syncTransactionPayment(form);
    if (type === "giderler") form._expenseSync?.(row);
    if (type === "hurda") {
      const selectedHurdaId = row.hurda_alis_id || "";
      state.selectedHurdaPurchase = selectedHurdaId ? { id: selectedHurdaId } : null;
      if (form.elements.hurda_alis_id) form.elements.hurda_alis_id.value = selectedHurdaId;
    }
    if (row.stoktan) form._stockEditSnapshot = row;
    if (row.stoktan && (type === "satis" || (type === "hurda" && row.islem_turu === "SATIS"))) {
      try {
        const options = await api(`/api/stok/${type === "hurda" ? "hurda" : "normal"}/secenekler?exclude_sale_id=${row.id}`);
        if (document.querySelector(".entry-form") !== form || editing?.id !== row.id) return;
        const stock = options.find(option => normalize(option.cinsi) === normalize(row.cinsi) && normalize(option.ayar) === normalize(row.ayar));
        if (stock) {
          if (type === "hurda") state.selectedHurdaPurchase = stock; else state.selectedPurchase = stock;
          showSelectedPurchase(form.querySelector(".purchase-note"), stock);
        }
      } catch (error) { showMessage(error.message, true); }
    }
    form._kasa = (row.kasa_odemeleri || []).map((k) => ({ hesap_id: k.hesap_id, tutar: k.tutar, kur: k.kur }));
    form._updatePreview?.();
    form._refreshPaymentSummary?.();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
}

function renderTabs(options, active, onChange) {
  const tabs = document.createElement("div");
  tabs.className = "page-tabs";
  options.forEach(([value, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `page-tab ${active === value ? "active" : ""}`;
    btn.textContent = label;
    btn.onclick = () => onChange(value);
    tabs.appendChild(btn);
  });
  return tabs;
}

function renderCards(cards) {
  const wrap = document.createElement("div");
  wrap.className = "cards";
  cards.forEach(([label, value, key, tone]) => {
    const card = document.createElement("article");
    card.className = `card tone-${tone || "neutral"}`;
    card.innerHTML = `<span>${label}</span><strong>${formatValue(key, value)}</strong>`;
    wrap.appendChild(card);
  });
  return wrap;
}

function renderMetricCard(label, value, key, tone = "neutral", note = "") {
  const card = document.createElement("article");
  card.className = `metric-card tone-${tone}`;
  card.innerHTML = `<span>${label}</span><strong>${formatValue(key, value)}</strong>${note ? `<small>${note}</small>` : ""}`;
  return card;
}

function renderDashboardPanel(title, subtitle, cards) {
  const group = document.createElement("section");
  group.className = "dashboard-panel";
  const head = document.createElement("div");
  head.className = "dashboard-panel-head";
  head.innerHTML = `<h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}`;
  const grid = document.createElement("div");
  grid.className = "dashboard-panel-grid";
  cards.forEach((card) => grid.appendChild(renderMetricCard(...card)));
  group.append(head, grid);
  return group;
}

async function downloadAllData() {
  if (!(await showConfirm("T\u00fcm verileri JSON olarak indirmek istiyor musunuz", "D\u0131\u015fa Aktar", "\u0130ptal"))) return;
  try {
    const data = await api("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kuyumcu_disa_aktarim_${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage("T\u00fcm veriler JSON olarak indirildi.");
  } catch (error) {
    showMessage(error.message || "D\u0131\u015fa aktarma yap\u0131lamad\u0131.", true);
  }
}

async function createDatabaseBackup() {
  try {
    const result = await api("/api/backup", { method: "POST" });
    showMessage(`Yedek oluşturuldu: ${result.file}`);
  } catch (error) {
    showMessage(error.message || "Yedek oluşturulamadı.", true);
  }
}

async function restoreLatestDatabaseBackup() {
  const confirmed = await showConfirm(
    "En son veritabanı yedeği geri yüklenecek. Mevcut veriler önce ayrıca yedeklenecek. Devam edilsin mi",
    "Geri Yükle",
    "İptal",
  );
  if (!confirmed) return;
  try {
    const result = await api("/api/restore-latest", { method: "POST" });
    showMessage(`Yedek geri yüklendi: ${result.restored_from}`);
    await refreshSuggestions();
    await render();
  } catch (error) {
    showMessage(error.message || "Yedek geri yüklenemedi.", true);
  }
}

function renderCariPaymentForm(data) {
  const panel = document.createElement("section");
  panel.className = "panel form-panel cari-payment-panel";
  const form = document.createElement("form");
  form.className = "entry-form cari-payment-form";
  const people = data.kisiler || [];
  let selectedPaymentType = "HAS";

  const makeField = (labelText, input) => {
    const label = document.createElement("label");
    label.className = "field field-main";
    label.append(labelText, input);
    return label;
  };

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.name = "tarih";
  dateInput.value = today();

  const personSelect = document.createElement("select");
  personSelect.name = "isim";
  personSelect.required = true;
  personSelect.innerHTML = `<option value="">Cari ki\u015fi/firma se\u00e7</option>${people.map((row) => `<option value="${row.isim}">${row.isim} | Kalan ${formatValue("has", row.kalan_has)} has</option>`).join("")}`;

  const directionSelect = document.createElement("select");
  directionSelect.name = "yon";
  directionSelect.innerHTML = '<option value="TAHSILAT">M\u00fc\u015fteriden Tahsilat</option><option value="ODEME">Tedarik\u00e7iye \u00d6deme</option>';

  const typeInput = document.createElement("input");
  typeInput.type = "hidden";
  typeInput.name = "odeme_tipi";
  typeInput.value = selectedPaymentType;

  const paymentTabs = document.createElement("div");
  paymentTabs.className = "payment-type-tabs cari-payment-tabs";
  [
    ["HAS", "Has ile \u00d6deme"],
    ["ADET_GRAM_MILYEM", "Gram + Milyem"],
    ["TAM_KAPAT", "Borcu Tam Kapat"],
    ["PARA", "TL / D\u00f6viz ile"],
  ].forEach(([value, label]) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "payment-type-tab";
    tab.dataset.value = value;
    tab.textContent = label;
    tab.onclick = () => {
      selectedPaymentType = value;
      typeInput.value = value;
      updateMode();
    };
    paymentTabs.appendChild(tab);
  });

  const paidInput = document.createElement("input");
  paidInput.name = "odenen_has";
  paidInput.inputMode = "decimal";
  paidInput.placeholder = "\u00d6denen has";

  const gramInput = document.createElement("input");
  gramInput.name = "gram";
  gramInput.inputMode = "decimal";
  gramInput.placeholder = "Gram";

  const milyemInput = document.createElement("input");
  milyemInput.name = "milyem";
  milyemInput.inputMode = "decimal";
  milyemInput.placeholder = "Milyem";

  const calcBox = document.createElement("div");
  calcBox.className = "has-preview cari-payment-preview field-note";
  calcBox.innerHTML = `<div class="cari-has-card"><span>Hesaplanan Has</span><strong data-calc-has>0</strong></div><div class="cari-has-card"><span>Kalan Has</span><strong data-kalan-has>0</strong></div>`;

  const noteInput = document.createElement("textarea");
  noteInput.name = "notlar";
  noteInput.rows = 1;
  noteInput.maxLength = 500;

  const paidField = makeField("\u00d6denen Has", paidInput);
  const gramField = makeField("Gram", gramInput);
  const milyemField = makeField("Milyem", milyemInput);
  paidField.classList.add("payment-fill-field", "cari-paid-field");
  gramField.classList.add("payment-fill-field", "cari-product-payment-field", "payment-gram-field");
  milyemField.classList.add("payment-fill-field", "cari-product-payment-field", "payment-milyem-field");
  const noteField = makeField("Not", noteInput);
  noteField.classList.add("field-note", "cari-note-field");

  // TL / döviz ile ödeme: kasaya yazılır, has fiyatıyla has'a çevrilir.
  const priceInput = document.createElement("input");
  priceInput.inputMode = "decimal"; priceInput.placeholder = "Has fiyat\u0131 (TL/gr)";
  attachDecimalGuard(priceInput);
  const priceField = makeField("Has Fiyat\u0131 (TL/gr)", priceInput);
  priceField.classList.add("cari-price-field");
  const kasaBox = document.createElement("div");
  kasaBox.className = "cari-kasa-box";
  let kasaEditor = null;
  let hadKasa = false;
  const kasaYon = () => directionSelect.value === "ODEME" ? "CIKIS" : "GIRIS";
  const setKasa = (items) => {
    kasaEditor = kasaRowsEditor(items, kasaYon(), () => updateMode());
    kasaBox.replaceChildren(kasaEditor.element);
  };
  followLivePrice(priceInput, () => directionSelect.value === "ODEME" ? "alis" : "satis");
  form._setKasa = (items) => { hadKasa = items.length > 0; setKasa(items); };

  form.append(
    (() => { const field = makeField("Tarih", dateInput); field.classList.add("cari-date-field"); return field; })(),
    (() => { const field = makeField("Cari Ki\u015fi / Firma", personSelect); field.classList.add("cari-person-field"); return field; })(),
    makeField("\u0130\u015flem Y\u00f6n\u00fc", directionSelect),
    typeInput,
    paymentTabs,
    paidField,
    gramField,
    milyemField,
    kasaBox,
    priceField,
    calcBox,
    noteField,
  );

  const actions = document.createElement("div");
  actions.className = "form-bottom-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "\u00d6deme Ekle";
  actions.appendChild(save);
  form.appendChild(actions);

  const selectedCari = () => people.find((row) => normalize(row.isim) === normalize(personSelect.value));
  const selectedCariKalanHas = () => parseNum(selectedCari()?.kalan_has);
  const calculatedHas = () => {
    if (selectedPaymentType === "PARA") return kasaEditor && parseNum(priceInput.value) > 0 ? Math.round(kasaEditor.totalTL() / parseNum(priceInput.value) * 1000) / 1000 : 0;
    if (selectedPaymentType === "ADET_GRAM_MILYEM") return parseNum(gramInput.value) * parseNum(milyemInput.value) / 1000;
    if (selectedPaymentType === "TAM_KAPAT") return Math.abs(selectedCariKalanHas());
    return parseNum(paidInput.value);
  };
  function updateMode() {
    const para = selectedPaymentType === "PARA";
    if (para && !kasaEditor) setKasa([]);
    kasaBox.hidden = priceField.hidden = !para;
    paidField.hidden = gramField.hidden = milyemField.hidden = para;
    paymentTabs.querySelectorAll(".payment-type-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.value === selectedPaymentType));
    paidField.classList.toggle("payment-inactive", selectedPaymentType !== "HAS");
    paidInput.disabled = selectedPaymentType !== "HAS";
    [gramField, milyemField].forEach((field) => field.classList.toggle("payment-inactive", selectedPaymentType !== "ADET_GRAM_MILYEM"));
    [gramInput, milyemInput].forEach((input) => input.disabled = selectedPaymentType !== "ADET_GRAM_MILYEM");
    calcBox.classList.toggle("payment-inactive", selectedPaymentType === "HAS");
    if (para) calcBox.classList.remove("payment-inactive");
    if (selectedPaymentType === "TAM_KAPAT") paidInput.value = formatValue("has", Math.abs(selectedCariKalanHas())).replaceAll(".", "").replace(",", ".");
    calcBox.querySelector("[data-calc-has]").textContent = formatValue("has", calculatedHas());
    const projected = selectedCariKalanHas() + (directionSelect.value === "ODEME" ? calculatedHas() : -calculatedHas());
    calcBox.querySelector("[data-kalan-has]").textContent = formatValue("net_bakiye_has", projected);
  }

  [paidInput, gramInput, milyemInput].forEach(attachDecimalGuard);
  [personSelect, directionSelect, paidInput, gramInput, milyemInput, priceInput].forEach((input) => input.addEventListener("input", updateMode));
  directionSelect.addEventListener("change", () => setLivePrice(priceInput));
  personSelect.addEventListener("change", () => {
    directionSelect.value = selectedCariKalanHas() < 0 ? "ODEME" : "TAHSILAT";
    setLivePrice(priceInput);
    updateMode();
  });
  updateMode();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!personSelect.value) { showMessage("Cari ki\u015fi/firma se\u00e7in.", true); return; }
    try {
      if (selectedPaymentType === "HAS") positiveValue(paidInput, "\u00d6denen has");
      if (selectedPaymentType === "ADET_GRAM_MILYEM") {
        positiveValue(gramInput, "Gram");
        positiveValue(milyemInput, "Milyem");
      }
      if (selectedPaymentType === "TAM_KAPAT" && calculatedHas() <= 0) throw new Error("Kapat\u0131lacak has bulunamad\u0131.");
      if (selectedPaymentType === "PARA") {
        kasaEditor.validate();
        if (!(parseNum(priceInput.value) > 0)) throw new Error("Has fiyat\u0131n\u0131 girin.");
      }
    } catch (error) {
      showMessage(error.message, true);
      return;
    }
    typeInput.value = selectedPaymentType === "PARA" ? "HAS" : selectedPaymentType;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (selectedPaymentType === "PARA") {
      payload.odenen_has = String(calculatedHas());
      payload.kasa = kasaEditor.validate().map((k) => ({ hesap_id: k.hesap_id, tutar: String(k.tutar), kur: k.kur ? String(k.kur) : null }));
    } else if (hadKasa) payload.kasa = [];
    if (payload.odeme_tipi === "ADET_GRAM_MILYEM") payload.odenen_has = String(calculatedHas());
    if (payload.odeme_tipi === "TAM_KAPAT") payload.odenen_has = String(calculatedHas());
    if (!(await showConfirm("Cari \u00f6deme kaydedilsin mi", "Kaydet", "\u0130ptal"))) return;
    try {
      const editId = form.dataset.editPaymentId;
      await api(editId ? `/api/cari/odeme/${editId}` : "/api/cari/odeme", { method: editId ? "PUT" : "POST", body: JSON.stringify(payload) });
      showMessage(editId ? "Cari \u00f6deme g\u00fcncellendi." : "Cari \u00f6deme kaydedildi.");
      render();
    } catch (error) { showMessage(error.message, true); }
  });

  panel.appendChild(form);
  return panel;
}
function openCariPaymentModal(data, personName = "", payment = null) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const box = document.createElement("div");
  box.className = "modal-box payment-modal cari-person-modal";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.innerHTML = `<h2>${payment ? "\u00d6deme Bilgisini D\u00fczenle" : "\u00d6deme Bilgisi"}</h2>`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-btn cari-dialog-close";
  close.innerHTML = iconSvg("close");
  close.title = "Kapat"; close.setAttribute("aria-label", "Kapat");
  close.onclick = () => overlay.remove();
  title.appendChild(close);
  const panel = renderCariPaymentForm(data);
  const form = panel.querySelector("form");
  box.append(title, panel);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  if (personName && form.elements.isim) {
    form.elements.isim.value = personName;
    form.elements.isim.dispatchEvent(new Event("change"));
  }
  if (payment) {
    form.elements.tarih.value = payment.tarih || today();
    form.elements.isim.value = payment.isim || personName;
    form.elements.notlar.value = payment.not || payment.notlar || "";
    form.elements.odenen_has.value = paymentDisplayValue(payment.odenen_has);
    form.elements.gram.value = paymentDisplayValue(payment.gram);
    form.elements.milyem.value = paymentDisplayValue(payment.milyem);
    form.elements.yon.value = payment.yon || "TAHSILAT";
    if (payment.kasa_odemeleri?.length) {
      form._setKasa(payment.kasa_odemeleri.map((k) => ({ hesap_id: k.hesap_id, tutar: k.tutar, kur: k.kur })));
      const tl = payment.kasa_odemeleri.reduce((sum, k) => sum + k.tutar * (k.kur || 1), 0);
      const priceField = form.querySelector(".cari-price-field input");
      priceField.dataset.elle = "1"; // düzenlenen kaydın fiyatı canlı fiyatla değişmez
      if (payment.odenen_has > 0) priceField.value = String(Math.round(tl / payment.odenen_has * 100) / 100).replace(".", ",");
    }
    const tab = form.querySelector(`.payment-type-tab[data-value="${payment.kasa_odemeleri?.length ? "PARA" : (payment.odeme_tipi || "HAS")}"]`);
    tab.click();
    const save = form.querySelector('button[type="submit"]');
    if (save) save.textContent = "\u00d6demeyi G\u00fcncelle";
    form.dataset.editPaymentId = payment.id;
  }

  form.addEventListener("submit", () => setTimeout(() => overlay.remove(), 150), true);
}

function renameCariPerson(oldName) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const box = document.createElement("div");
  box.className = "modal-box cari-rename-modal";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.innerHTML = `<h2>\u0130sim De\u011fi\u015ftir</h2><p>${oldName}</p>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldName;
  input.className = "rename-input";
  input.placeholder = "Yeni cari ad\u0131";
  const actions = document.createElement("div");
  actions.className = "form-bottom-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "\u0130ptal";
  cancel.onclick = () => overlay.remove();
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "G\u00fcncelle";
  save.onclick = async () => {
    const yeni = input.value.trim();
    if (!yeni) { showMessage("Yeni cari ad\u0131 girin.", true); return; }
    if (normalize(yeni) === normalize(oldName)) { overlay.remove(); return; }
    if (!(await showConfirm("Cari ad\u0131 g\u00fcncellensin mi", "G\u00fcncelle", "\u0130ptal"))) return;
    try {
      await api("/api/cari/kisi", { method: "PUT", body: JSON.stringify({ eski_isim: oldName, yeni_isim: yeni }) });
      showMessage("Cari ad\u0131 g\u00fcncellendi.");
      overlay.remove();
      render();
    } catch (error) { showMessage(error.message, true); }
  };
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") save.click(); });
  actions.append(cancel, save);
  box.append(title, input, actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus();
  input.select();
}

async function deleteCariPerson(name) {
  if (!(await showConfirm(`${name} carisini ve ba\u011fl\u0131 kay\u0131tlar\u0131 silmek istiyor musunuz`, "Sil", "\u0130ptal"))) return;
  try {
    await api("/api/cari/kisi/sil", { method: "POST", body: JSON.stringify({ isim: name }) });
    showMessage("Cari silindi.");
    render();
  } catch (error) { showMessage(error.message, true); }
}

async function openCariDetail(name) {
  if (document.querySelector(".cari-detail-modal")) return;
  const opener = document.activeElement;
  const overlay = document.createElement("div"); overlay.className = "modal cari-detail-modal";
  const box = document.createElement("div"); box.className = "modal-box cari-detail-box";
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", `${name} cari detay\u0131`); box.tabIndex = -1;
  const head = document.createElement("div"); head.className = "modal-title";
  const title = document.createElement("h2"); title.textContent = name;
  const close = document.createElement("button"); close.type = "button"; close.className = "icon-btn cari-detail-close"; close.innerHTML = iconSvg("close");
  close.title = "Kapat"; close.setAttribute("aria-label", "Cari detay\u0131n\u0131 kapat");
  const dismiss = () => { overlay.remove(); if (opener?.isConnected) opener.focus(); };
  const help = document.createElement("button"); help.type = "button"; help.className = "icon-btn cari-detail-help";
  help.textContent = "?"; help.title = "Cari bakiye a\u00e7\u0131klamas\u0131"; help.setAttribute("aria-label", help.title); help.disabled = true;
  close.onclick = dismiss; head.append(title, close, help);
  const body = document.createElement("div"); body.className = "cari-detail-body"; body.textContent = "\u0130\u015flemler y\u00fckleniyor...";
  box.append(head, body); overlay.appendChild(box); document.body.appendChild(overlay); close.focus();
  overlay.addEventListener("click", event => { if (event.target === overlay) dismiss(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    if (event.key === "Tab") {
      const focusable = [...box.querySelectorAll("button, [href], input, select, textarea, [tabindex='0']")];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  try {
    const [purchases, sales, scrap, accounts] = await Promise.all([api("/api/alis"), api("/api/satis"), api("/api/hurda"), api("/api/cari")]);
    if (!overlay.isConnected) return;
    const person = (accounts.kisiler || []).find(row => normalize(row.isim) === normalize(name));
    if (!person) throw new Error("Cari bulunamad\u0131.");
    const history = [];
    const addTransactions = (rows, nameKey, isSale, source) => rows.filter(row => normalize(row[nameKey]) === normalize(name)).forEach(row => {
      history.push({ tarih: row.tarih, hareket: isSale ? "Sat\u0131\u015f" : "Al\u0131\u015f", kaynak: source, gram: row.gram, has: row.has, not: row.not ?? row.notlar ?? "", id: row.id });
      if (Number(row.odenen_has) > 0) history.push({ tarih: row.tarih, hareket: isSale ? "Tahsilat" : "\u00d6deme", kaynak: `${source} #${row.id}`, gram: null, has: row.odenen_has, not: "\u0130\u015flem s\u0131ras\u0131nda", id: row.id });
    });
    addTransactions(purchases || [], "tedarikci", false, "Normal");
    addTransactions(sales || [], "musteri", true, "Normal");
    addTransactions((scrap.kayitlar || []).filter(row => normalize(row.islem_turu) === "alis"), "kisi", false, "Hurda");
    addTransactions((scrap.kayitlar || []).filter(row => normalize(row.islem_turu) === "satis"), "kisi", true, "Hurda");
    (accounts.odemeler || []).filter(row => normalize(row.isim) === normalize(name)).forEach(row => history.push({ tarih: row.tarih, hareket: row.yon === "ODEME" ? "\u00d6deme" : "Tahsilat", kaynak: "Cari", gram: null, has: row.odenen_has, not: row.not ?? row.notlar ?? "", id: row.id }));
    history.forEach(item => {
      const source = item.kaynak.split(" #")[0];
      let type, record, view;
      if (source === "Cari") {
        record = accounts.odemeler.find(row => row.id === item.id);
        item.openRecord = () => { close.click(); openCariPaymentModal(accounts, name, record); };
        return;
      }
      if (source === "Hurda") {
        type = "hurda"; record = scrap.kayitlar.find(row => row.id === item.id);
        view = record.islem_turu === "SATIS" ? "hurda_satis" : "hurda_alis";
      } else {
        type = ["Sat\u0131\u015f", "Tahsilat"].includes(item.hareket) ? "satis" : "alis";
        record = (type === "satis" ? sales : purchases).find(row => row.id === item.id); view = type;
      }
      item.openRecord = () => {
        close.click(); state.view = view; state.search = ""; search.value = "";
        document.querySelectorAll(".nav").forEach(button => button.classList.toggle("active", button.dataset.view === view));
        startEdit(type, record);
      };
    });
    history.sort((a, b) => String(b.tarih).localeCompare(String(a.tarih)) || Number(b.id) - Number(a.id));
    const balance = document.createElement("p"); balance.className = `cari-detail-balance ${person.net_bakiye_has > 0 ? "pos" : person.net_bakiye_has < 0 ? "neg" : "balance-zero"}`;
    balance.textContent = `Net Has Bakiyesi: ${formatValue("net_bakiye_has", person.net_bakiye_has)} has gram`;
    const totals = renderCards([["Sat\u0131\u015f Has", person.toplam_satis_has, "has"], ["Al\u0131\u015f Has", person.toplam_alis_has, "has"], ["Tahsilat Has", person.tahsil_edilen_has, "has"], ["\u00d6deme Has", person.odedigimiz_has, "has"]]);
    const difference = document.createElement("p");
    difference.textContent = `Alış–satış farkı: ${formatValue("has", person.toplam_satis_has)} − ${formatValue("has", person.toplam_alis_has)} = ${formatValue("net_bakiye_has", person.toplam_satis_has - person.toplam_alis_has)} has gram`;
    const formula = document.createElement("p");
    formula.textContent = `Net bakiye = satış − alış − tahsilat + ödeme: ${formatValue("has", person.toplam_satis_has)} − ${formatValue("has", person.toplam_alis_has)} − ${formatValue("has", person.tahsil_edilen_has)} + ${formatValue("has", person.odedigimiz_has)} = ${formatValue("net_bakiye_has", person.net_bakiye_has)} has gram`;
    const direction = document.createElement("p");
    direction.textContent = person.net_bakiye_has > 0 ? "Pozitif bakiye: karşı taraftan alacağımız has." : person.net_bakiye_has < 0 ? "Negatif bakiye: karşı tarafa ödeyeceğimiz has." : "Cari bakiyesi kapalı.";
    help.disabled = false;
    help.onclick = () => openNote([difference.textContent, formula.textContent, direction.textContent].join("\n\n"), "Cari bakiye a\u00e7\u0131klamas\u0131");
    body.replaceChildren(balance, totals, renderTable("cariHistory", history, "\u0130\u015flem Ge\u00e7mi\u015fi", false));
  } catch (error) { if (overlay.isConnected) body.textContent = error.message; }
}

function openCariActions(row, data) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const box = document.createElement("div");
  box.className = "modal-box cari-actions-modal";
  const title = document.createElement("div");
  title.className = "modal-title cari-actions-title";
  title.innerHTML = `<h2>${row.isim}</h2><p>Sat\u0131\u015f ${formatValue("has", row.toplam_satis_has)} | Al\u0131\u015f ${formatValue("has", row.toplam_alis_has)} | Net ${formatValue("net_bakiye_has", row.net_bakiye_has)} has</p>`;
  const actions = document.createElement("div");
  actions.className = "cari-action-list";
  const items = [
    ["Cari Kart\u0131 (T\u00fcr, Telefon, Vade)", () => openCariKart(row.isim)],
    ["\u00d6deme Bilgilerini De\u011fi\u015ftir", () => openCariPaymentModal(data, row.isim)],
    ["\u0130sim De\u011fi\u015ftir", () => renameCariPerson(row.isim)],
    ["Ki\u015fiyi Sil", () => deleteCariPerson(row.isim), "danger"],
  ];
  items.forEach(([label, fn, tone]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cari-action-btn ${tone || ""}`;
    btn.textContent = label;
    btn.onclick = () => { overlay.remove(); fn(); };
    actions.appendChild(btn);
    if (tone === "danger") {
      const note = document.createElement("small");
      note.className = "cari-danger-note";
      note.textContent = "Dikkat: Bu ki\u015fiye ba\u011fl\u0131 al\u0131\u015f, sat\u0131\u015f, hurda ve \u00f6deme kay\u0131tlar\u0131 da silinir.";
      actions.appendChild(note);
    }
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-btn cari-dialog-close";
  close.innerHTML = iconSvg("close");
  close.title = "Kapat"; close.setAttribute("aria-label", "Kapat");
  close.onclick = () => overlay.remove();
  title.appendChild(close);
  box.append(title, actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
function renderProfitSummary(data) {
  const panel = document.createElement("aside"); panel.className = "expense-profit-summary";
  const title = document.createElement("h2"); title.textContent = "Milyem K\u00e2r\u0131 \u00d6zeti";
  const note = document.createElement("p"); note.textContent = "T\u00fcm zamanlar \u00b7 Normal + hurda \u00b7 Has";
  panel.append(title, note);
  [["Toplam Milyem K\u00e2r\u0131", data.genel_milyem_kari, "neutral"],
   ["Toplam Gider", data.toplam_gider, "warn"],
   ["Kalan Net K\u00e2r", data.net_kar, data.net_kar < 0 ? "warn" : "good"]].forEach(([label, value, tone]) => {
    const card = renderMetricCard(label, value, "has", tone);
    card.classList.add("expense-summary-card"); panel.appendChild(card);
  });
  const formula = document.createElement("small"); formula.textContent = "Net k\u00e2r = toplam milyem k\u00e2r\u0131 \u2212 giderler"; panel.appendChild(formula);
  return panel;
}

/**
 * Gider formu: tutar TL girilir, has karşılığı günün has alış fiyatıyla hesaplanır
 * (kâr hesabı has esaslıdır). Ödendiği hesap seçilirse kasaya bağlı çıkış yazılır.
 * Altınla ödenen gider için birim "Has" seçilip doğrudan has girilir.
 */
function renderExpenseForm() {
  const isEdit = editing?.type === "giderler";
  const panel = h("section", { class: "panel form-panel expense-form-panel" });
  panel.append(h("h2", { text: isEdit ? "Gideri düzenle" : "Yeni gider" }),
    h("p", { class: "hint", text: "Gideri ödediğiniz TL tutarıyla girin; program günün has fiyatıyla has karşılığını hesaplar ve kârdan düşer. Ödendiği hesabı seçerseniz kasadan da düşülür." }));
  const form = h("form", { class: "entry-form expense-form" });
  const tarih = h("input", { type: "date", name: "tarih", required: true, value: today() });
  const birim = h("div", { class: "payment-type-tabs expense-unit", role: "tablist" });
  let unit = "TL";
  const tl = decimalInput("tl_tutar", "0,00");
  const fiyat = decimalInput("has_fiyati", "Günün has fiyatı");
  followLivePrice(fiyat, "alis");
  const hasInput = decimalInput("tutar", "0,000");
  const hasOut = h("b", { text: "0" });
  const hesap = h("select", { name: "hesap_id" }, h("option", { value: "", text: "Kasaya yazma" }),
    ...(state.kasaHesaplar || []).filter((a) => a.aktif && a.para_birimi === "TRY").map((a) => h("option", { value: a.id, text: a.ad })));
  if (!isEdit) { const nakit = (state.kasaHesaplar || []).find((a) => a.aktif && a.para_birimi === "TRY" && a.tur === "NAKIT"); if (nakit) hesap.value = String(nakit.id); }
  const kategori = h("input", { name: "kategori", required: true, list: "expenseCategories", autocomplete: "off" });
  const list = h("datalist", { id: "expenseCategories" }, ...["Yemek", "Kira", "Elektrik / su / doğalgaz", "Çalışan ödemesi", "Araç / yakıt", "Kargo / ulaşım", "Uçak bileti", "Konaklama", "Kişisel", "Diğer işletme giderleri"].map((v) => h("option", { value: v })));
  const notlar = h("textarea", { name: "notlar", rows: 2, maxlength: 500, placeholder: "Giderle ilgili kısa bir not..." });
  const tlFields = [labeled("Ödenen tutar (TL)", tl), labeled("Has fiyatı (TL/gr)", fiyat), h("div", { class: "field field-main expense-has" }, h("span", { text: "Has karşılığı" }), h("strong", {}, hasOut, " gr has")), labeled("Ödendiği hesap", hesap)];
  const hasFields = [labeled("Gider (has, gr)", hasInput)];
  const update = () => {
    const value = readAmount(tl.value); const price = readAmount(fiyat.value);
    hasOut.textContent = value > 0 && price > 0 ? formatTurkishNumber(value / price, 0, 3) : "0";
  };
  const setUnit = (next) => {
    unit = next;
    birim.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === unit));
    tlFields.forEach((f) => { f.hidden = unit !== "TL"; }); hasFields.forEach((f) => { f.hidden = unit !== "HAS"; });
    tl.required = unit === "TL"; hasInput.required = unit === "HAS";
  };
  [["TL", "TL ile ödendi"], ["HAS", "Altınla (has) ödendi"]].forEach(([value, text]) => birim.append(h("button", { type: "button", class: "payment-type-tab", dataset: { value }, text, onclick: () => setUnit(value) })));
  [tl, fiyat].forEach((i) => i.addEventListener("input", update));
  form.append(h("div", { class: "expense-unit-row" }, birim), labeled("Tarih", tarih), ...tlFields, ...hasFields, labeled("Kategori", kategori), list, labeled("Açıklama / not", notlar, "expense-note"));
  setUnit("TL");
  // Düzenlemede kayıt forma doldurulduktan sonra birim ve hesap seçilir.
  form._expenseSync = (row) => {
    setUnit(row.tl_tutar ? "TL" : "HAS");
    tl.value = row.tl_tutar ? String(row.tl_tutar).replace(".", ",") : "";
    fiyat.dataset.elle = "1"; // düzenlenen giderin fiyatı canlı fiyatla değişmez
    fiyat.value = row.has_fiyati ? String(row.has_fiyati).replace(".", ",") : fiyat.value;
    hasInput.value = row.tutar ? String(row.tutar).replace(".", ",") : "";
    hesap.value = String(row.kasa_odemeleri?.[0]?.hesap_id ?? "");
    update();
  };
  const save = h("button", { type: "submit", text: isEdit ? "Güncelle" : "Kaydet" });
  const cancel = h("button", { type: "button", class: "secondary", text: "İptal", onclick: () => { editing = null; render(); } });
  form.append(h("div", { class: "form-bottom-actions" }, save, cancel));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = { tarih: tarih.value, kategori: kategori.value, notlar: notlar.value };
    if (unit === "TL") {
      const value = readAmount(tl.value);
      data.tl_tutar = String(value); data.has_fiyati = fiyat.value ? String(readAmount(fiyat.value)) : "";
      data.kasa = hesap.value ? [{ hesap_id: Number(hesap.value), tutar: String(value) }] : [];
    } else {
      data.tutar = String(readAmount(hasInput.value)); data.kasa = [];
    }
    const id = isEdit ? editing.id : null;
    save.disabled = true;
    try {
      await api(`/api/giderler${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
      editing = null; await render(); showMessage(unit === "TL" && data.kasa.length ? "Gider kaydedildi ve kasadan düşüldü." : "Gider kaydedildi.");
    } catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  panel.appendChild(form); return panel;
}

function renderDashboard(data) {
  const root = document.createElement("div");
  root.className = "dashboard-root dashboard-restored";

  const hero = document.createElement("section");
  hero.className = "dashboard-hero";
  const heroMetrics = document.createElement("div");
  heroMetrics.className = "dashboard-hero-metrics";
  [
    ["Genel Milyem K\u00e2r\u0131", data.genel_urun_kari, "has", "good", "Normal sat\u0131\u015flardan"],
    ["G\u00fcnl\u00fck Milyem K\u00e2r\u0131", data.gunluk_urun_kari, "has", "good", data.gunluk_tarih ? `Tarih: ${trDate(data.gunluk_tarih)}` : "G\u00fcnl\u00fck hareket"],
    ["Normal Stok Has", data.normal_stok_has, "has", "neutral", "\u00dcr\u00fcn sto\u011fu"],
    ["Hurda Kalan Has", data.hurda_kalan_has, "has", "accent", "Hurda sto\u011fu"],
  ].forEach((card) => heroMetrics.appendChild(renderMetricCard(...card)));
  hero.appendChild(heroMetrics);

  const topGroups = document.createElement("div");
  topGroups.className = "dashboard-groups dashboard-groups-polished dashboard-groups-top";
  const bottomGroups = document.createElement("div");
  bottomGroups.className = "dashboard-groups dashboard-groups-polished dashboard-groups-bottom";
  const stock = renderDashboardPanel("Stok \u00d6zeti", "", []);
  stock.classList.add("dashboard-stock-summary");
  const stockGrid = stock.querySelector(".dashboard-panel-grid");
  stockGrid.className = "dashboard-stock-sections";
  [
    ["Normal stok", [
      ["Normal Stok Gram", data.normal_stok_gram, "gram", "neutral"],
      ["Normal Stok Has", data.normal_stok_has, "has", "accent"],
    ]],
    ["Hurda", [
      ["Hurda Stok Gram", data.hurda_kalan_gram, "gram", "neutral"],
      ["Hurda Kalan Has", data.hurda_kalan_has, "has", "accent"],
      ["Hurda Milyem K\u00e2r\u0131", data.hurda_milyem_kari, "has", "good"],
      ["Hurda Al\u0131\u015f Has", data.hurda_alis_has_toplami, "has", "neutral"],
      ["Hurda Sat\u0131\u015f Has", data.hurda_satis_has_toplami, "has", "accent"],
      ["Hurda Kayd\u0131", data.hurda_adedi, "", "neutral"],
    ]],
  ].forEach(([title, cards]) => {
    const section = document.createElement("section");
    const heading = document.createElement("h3"); heading.textContent = title;
    const metrics = document.createElement("div"); metrics.className = "dashboard-stock-metrics";
    cards.forEach(card => metrics.appendChild(renderMetricCard(...card)));
    section.append(heading, metrics); stockGrid.appendChild(section);
  });
  const totalStock = document.createElement("p"); totalStock.className = "dashboard-stock-footnote";
  const totalLabel = document.createElement("span"); totalLabel.textContent = "Toplam Stok Has";
  const totalValue = document.createElement("strong"); totalValue.textContent = formatValue("has", data.toplam_stok_has);
  totalStock.append(totalLabel, totalValue); stock.appendChild(totalStock);
  const cari = renderDashboardPanel("Cari \u00d6zeti", "", [
    ["Kar\u015f\u0131 Taraftan Alaca\u011f\u0131m\u0131z Has", data.net_cari_alacak_has, "has", "good"],
    ["Bizim \u00d6deyece\u011fimiz Has", data.net_cari_borc_has, "has", data.net_cari_borc_has ? "warn" : "neutral"],
    ["Bize Bor\u00e7lu Cari", data.alacakli_cari_sayisi, "", "neutral"],
    ["Bizim Bor\u00e7lu Oldu\u011fumuz Cari", data.borclu_cari_sayisi, "", "neutral"],
  ]);
  cari.classList.add("dashboard-cari-summary");
  topGroups.append(stock, cari);
  bottomGroups.append(
    renderDashboardPanel("Gider \u00d6zeti", "", [
      ["Toplam Milyem K\u00e2r\u0131", data.genel_milyem_kari, "has", "neutral", "Normal + hurda"],
      ["Toplam Gider", data.toplam_gider, "has", "warn"],
      ["Kalan Net K\u00e2r", data.net_kar, "has", data.net_kar < 0 ? "warn" : "good", "Giderler d\u00fc\u015f\u00fcld\u00fckten sonra"],
    ]),
    renderDashboardPanel("TL \u00d6zeti", "Girilen has fiyatlar\u0131na g\u00f6re", [
      ["Toplam Sat\u0131\u015f", data.toplam_satis, "tl", "neutral"],
      ["Toplam Al\u0131\u015f", data.toplam_alis, "tl", "neutral"],
      ["Br\u00fct K\u00e2r", data.toplam_tl_kar, "tl", data.toplam_tl_kar < 0 ? "warn" : "good", "Normal + hurda sat\u0131\u015f, komisyon \u00f6ncesi"],
      ["G\u00fcnl\u00fck K\u00e2r", data.gunluk_tl_kar, "tl", data.gunluk_tl_kar < 0 ? "warn" : "good", data.gunluk_tarih ? `Tarih: ${trDate(data.gunluk_tarih)}` : ""],
      ["Stok De\u011feri (g\u00fcncel)", state.price ? data.toplam_stok_has * state.price.alis : null, "tl", "accent", state.price ? "Kalan has \u00d7 g\u00fcn\u00fcn al\u0131\u015f fiyat\u0131" : "Has fiyat\u0131 girilmedi"],
    ]),
    renderDashboardPanel("Uyar\u0131lar", "", [
      ["Stok Yetersiz Uyar\u0131s\u0131", data.uyari_sayisi, "", data.uyari_sayisi ? "warn" : "good", data.uyari_sayisi ? "Kontrol edin" : "Sorun yok"],
    ])
  );

  // Döviz alış/satışı has esaslı değildir; gerçekleşen kârı TL özetine ayrıca eklenir.
  const tlGrid = bottomGroups.querySelectorAll(".dashboard-panel-grid")[1];
  // POS komisyonu k\u00e2r de\u011fildir; net k\u00e2rdan d\u00fc\u015f\u00fcl\u00fcr.
  Promise.all([api("/api/doviz/ozet?baslangic=2000-01-01"), api("/api/kasa/komisyon?baslangic=2000-01-01")]).then(([z, k]) => {
    const kar = z.dovizler.reduce((t, x) => t + x.kar_tl, 0);
    const doviz = z.dovizler.some((x) => x.islem);
    if (doviz) tlGrid?.appendChild(renderMetricCard("D\u00f6viz K\u00e2r\u0131", kar, "tl", kar < 0 ? "warn" : "good", "Ger\u00e7ekle\u015fen, ortalama maliyetle"));
    if (k.komisyon_tl) tlGrid?.appendChild(renderMetricCard("POS Komisyonu", -k.komisyon_tl, "tl", "warn", "Bankan\u0131n kesti\u011fi; k\u00e2ra dahil de\u011fil"));
    if (doviz || k.komisyon_tl) {
      const net = Math.round((data.toplam_tl_kar + kar - k.komisyon_tl) * 100) / 100;
      tlGrid?.appendChild(renderMetricCard("Net K\u00e2r", net, "tl", net < 0 ? "warn" : "good", "Al\u0131m-sat\u0131m + d\u00f6viz \u2212 komisyon, giderler hari\u00e7"));
    }
  }).catch(() => {});
  root.append(hero, topGroups, bottomGroups);
  root.prepend(renderDashboardToday(data));
  return root;
}
let renderVersion = 0;
async function render() {
  const version = ++renderVersion;
  const view = state.view;
  document.querySelector(".app").dataset.view = view;
  const rendered = document.createDocumentFragment();
  const meta = views[view];
  document.querySelector("#pageTitle").textContent = meta.title;
  document.querySelector("#pageSubtitle").textContent = meta.subtitle;
  content.replaceChildren();
  try {
    if (extraViews[view]) { rendered.appendChild(await extraViews[view]()); return; }
    if (view === "dashboard") {
      const dashboard = await api("/api/dashboard");
      rendered.appendChild(renderDashboard(dashboard));
      return;
    }
    if (view === "giderler") {
      const [rows, summary] = await Promise.all([api("/api/giderler"), api("/api/dashboard"), loadKasaAccounts()]);
      const layout = document.createElement("div"); layout.className = "expenses-layout form-summary-layout";
      const main = document.createElement("div"); main.className = "expenses-main";
      main.appendChild(renderExpenseForm());
      layout.append(main, renderProfitSummary(summary), renderTable("giderler", rows, "Gider Kay\u0131tlar\u0131")); rendered.appendChild(layout);
      return;
    }
    if (view === "cari") {
      const [data] = await Promise.all([api("/api/cari"), loadCariKartlar()]);
      decorateCari(data);
      state.cariData = data;
      const filters = [["all", "T\u00dcM\u00dc"], ["musteri", "M\u00dc\u015eTER\u0130LER"], ["tedarikci", "TEDAR\u0130K\u00c7\u0130LER"], ["atolye", "AT\u00d6LYE / TOPTANCI"], ["odeme", "\u00d6DEMELER"]];
      if (!filters.some(([key]) => key === state.cariFilter)) state.cariFilter = "all";
      const tabs = renderTabs(filters, state.cariFilter, value => { state.cariFilter = value; render(); });
      tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Cari filtreleri");
      [...tabs.children].forEach((button, index) => {
        button.dataset.filter = filters[index][0]; button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(filters[index][0] === state.cariFilter));
      });
      rendered.appendChild(cariToolbar(tabs));
      const selected = {
        all: ["kisiCari", data.kisiler, "Genel Cari \u00d6zeti"],
        musteri: ["musteriCari", data.musteriler, "M\u00fc\u015fteriler"],
        tedarikci: ["tedarikciCari", data.tedarikciler, "Tedarik\u00e7iler"],
        atolye: ["kisiCari", data.atolyeler, "At\u00f6lye ve Toptanc\u0131lar"],
        odeme: ["cariOdeme", data.odemeler, "Cari \u00d6demeleri"],
      }[state.cariFilter];
      rendered.appendChild(renderTable(selected[0], selected[1] || [], selected[2]));
      return;
    }
    if (view === "stok") {
      const [normal, hurda] = await Promise.all([api("/api/stok/normal"), api("/api/stok/hurda")]);
      rendered.appendChild(renderTabs([["normal", "NORMAL STOK"], ["hurda", "HURDA STOK"], ["doviz", "DÖVİZ"]], state.stokFilter, (value) => { state.stokFilter = value; render(); }));
      if (state.stokFilter === "doviz" && typeof renderDovizStock === "function") { rendered.appendChild(await renderDovizStock()); return; }
      const withCount = (normal || []).map((row) => { const preset = sarrafiyeOf(row.cinsi); return preset ? { ...row, adet_tahmini: Math.round(row.kalan_gram / preset[1] * 10) / 10 } : row; });
      rendered.appendChild(state.stokFilter === "hurda" ? renderTable("hurdaStok", hurda || [], "Hurda Stok") : renderTable("stok", withCount, "Normal Stok"));
      return;
    }
    if (["alis", "satis"].includes(view)) {
      rendered.appendChild(renderForm(view));
      rendered.appendChild(renderTable(view, await api(`/api/${view}`), `${views[view].title} Kayıtları`));
      return;
    }
    if (["hurda_alis", "hurda_satis"].includes(view)) {
      const isSale = view === "hurda_satis";
      rendered.appendChild(renderForm("hurda", isSale ? "SATIS" : "ALIS"));
      const data = await api("/api/hurda");
      const allHurdaRows = enrichHurdaRows(data.kayitlar || []);
      const hurdaRows = allHurdaRows.filter((row) => normalize(row.islem_turu).startsWith(isSale ? "satis" : "alis"));
      rendered.appendChild(renderTable(isSale ? "hurdaSatis" : "hurdaAlis", hurdaRows, isSale ? "Hurda Sat\u0131\u015f Kay\u0131tlar\u0131" : "Hurda Al\u0131\u015f Kay\u0131tlar\u0131"));
      return;
    }
    rendered.appendChild(renderTable(view, await api(`/api/${view}`), `${views[view].title} Kayıtları`));
  } catch (error) { if (version === renderVersion) showMessage(error.message, true); }
  finally { if (version === renderVersion) { content.replaceChildren(rendered); requestAnimationFrame(() => {
      tableLayoutObserver.disconnect();
      content.querySelectorAll(".form-panel, .page-tabs").forEach(element => tableLayoutObserver.observe(element));
      fitPageTable();
    }); } }
}

document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.view = button.dataset.view;
  editing = null;
  search.value = "";
  state.search = "";
  render();
}));

search.addEventListener("input", () => { state.search = search.value; render(); });


document.querySelector("#exportBtn").addEventListener("click", downloadAllData);
document.querySelector("#settingsBtn").addEventListener("click", openSettings);
document.querySelector("#backupBtn").addEventListener("click", () => createDatabaseBackup());
document.querySelector("#restoreBtn").addEventListener("click", () => (typeof openBackups === "function" ? openBackups() : restoreLatestDatabaseBackup()));
document.querySelector("#accountBtn").addEventListener("click", openAccount);
document.querySelector("#priceBtn").addEventListener("click", openPriceDialog);
document.querySelector("#logoutBtn").addEventListener("click", logout);
document.querySelector("#sidebarLogout")?.addEventListener("click", logout);

const dataMenu = document.querySelector("#dataMenu");
document.addEventListener("click", event => {
  if (!dataMenu.contains(event.target) || event.target.closest(".toolbar-menu-panel button")) dataMenu.open = false;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && dataMenu.open) {
    dataMenu.open = false; dataMenu.querySelector("summary").focus();
  }
});

api("/api/session").then((session) => {
  if (!session?.authenticated) { window.location.href = "/login"; return; }
  currentUser = session.user;
  const userName = document.querySelector("#sidebarUserName");
  if (userName) { userName.textContent = currentUser?.name || ""; document.querySelector("#sidebarUserRole").textContent = ROLE_LABELS[currentUser?.role] || ""; }
  if (session.today) state.serverToday = session.today;
  if (currentUser?.role === "viewer") document.body.classList.add("role-viewer");
  loadPrice().then(() => { if (state.view === "dashboard") render(); });
  // Üst çubuktaki fiyat ve kurlar 10 saniyede bir yenilenir; sunucu Harem'i 15 saniyede bir,
  // diğer kaynakları 30 saniyede bir arka planda okur, istek dış kaynağı beklemez.
  setInterval(() => { if (!document.hidden) loadPrice(); }, 10 * 1000);
  Promise.all([refreshSuggestions(), loadKasaAccounts()]).then(render);
}).catch((error) => showMessage(error.message, true));

// Size the records area from its actual position, after forms and filters.
function fitPageTable() {
  const section = content.querySelector(":scope > .table-section, :scope > .expenses-layout > .table-section");
  if (!section) return;
  const wrap = section.querySelector(".table-wrap");
  if (!wrap) return;
  // Dikey tablette ve telefonda sayfanın kendisi kayar; tablo doğal boyunda kalır.
  if (window.innerWidth <= 680 || !/auto|scroll/.test(getComputedStyle(content).overflowY)) { wrap.style.removeProperty("height"); return; }
  const trailingSpace = section.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom + parseFloat(getComputedStyle(section).marginBottom || 0);
  const available = content.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - content.scrollTop - trailingSpace - 8;
  wrap.style.height = `${Math.max(100, available)}px`;
}
window.addEventListener("resize", fitPageTable);
