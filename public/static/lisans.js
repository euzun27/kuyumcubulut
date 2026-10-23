/*
 * Masaüstü sürümün lisansı: üst çubukta deneme / lisans durumu ve lisans
 * penceresi (makine kodu, anahtar girişi). Bulut sürümünde /api/lisans
 * olmadığı için hiçbir şey göstermez.
 */

let licenseState = null;

async function loadLicense() {
  try {
    const r = await fetch("/api/lisans", { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    licenseState = (await r.json()).data || null;
  } catch { licenseState = null; }
  renderLicensePill();
  return licenseState;
}

function renderLicensePill() {
  let pill = document.querySelector("#licensePill");
  const s = licenseState;
  if (!s || (s.durum === "lisansli" && (s.kalan_gun === null || s.kalan_gun > 30))) { pill?.remove(); return; }
  if (!pill) {
    pill = h("button", { id: "licensePill", type: "button", class: "backup-pill license-pill", onclick: () => openLicense() });
    document.querySelector("#dataMenu")?.before(pill);
  }
  pill.classList.toggle("license-expired", s.durum === "bitti");
  pill.textContent = s.durum === "bitti" ? "Lisans gerekli" : s.durum === "deneme" ? `Deneme: ${s.kalan_gun} gün kaldı` : `Lisans: ${s.kalan_gun} gün kaldı`;
  pill.title = s.mesaj;
}

async function openLicense() {
  const s = (await loadLicense()) || licenseState;
  if (!s) return;
  const { box, close } = openModal("Lisans", "kasa-modal license-modal");
  const tone = s.durum === "lisansli" ? "ok" : s.durum === "deneme" ? "trial" : "expired";
  const code = h("code", { class: "license-code", text: s.makine_kodu });
  const copy = h("button", { type: "button", class: "secondary", text: "Kopyala", onclick: async () => {
    try { await navigator.clipboard.writeText(s.makine_kodu); copy.textContent = "Kopyalandı"; } catch { window.getSelection()?.selectAllChildren(code); }
  } });
  const input = h("textarea", { class: "license-input", rows: 4, placeholder: "DT1-… ile başlayan lisans anahtarını buraya yapıştırın", spellcheck: "false" });
  const error = h("p", { class: "license-error", role: "alert" });
  const activate = h("button", { type: "submit", text: "Etkinleştir" });
  const form = h("form", { class: "license-form" },
    h("label", { class: "field" }, s.durum === "lisansli" ? "Yeni lisans anahtarı (yenileme için)" : "Lisans anahtarı", input), error,
    h("div", { class: "form-bottom-actions" }, activate));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (!input.value.trim()) { error.textContent = "Lisans anahtarını yapıştırın."; return; }
    activate.disabled = true;
    try {
      const r = await fetch("/api/lisans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ anahtar: input.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status === "error") throw new Error(j.message || "Lisans etkinleştirilemedi.");
      showMessage(j.message || "Lisans etkinleştirildi.");
      close();
      await loadLicense();
    } catch (e) { error.textContent = e.message; } finally { activate.disabled = false; }
  });
  box.append(h("div", { class: "license-body" },
    h("div", { class: `license-status ${tone}` }, h("strong", { text: s.durum === "lisansli" ? "Lisanslı" : s.durum === "deneme" ? "Deneme sürümü" : "Lisans gerekli" }), h("span", { text: s.mesaj })),
    h("section", { class: "backup-section" },
      h("h3", { text: "Bu bilgisayarın makine kodu" }),
      h("div", { class: "license-code-row" }, code, copy),
      h("p", { class: "hint", text: "Lisans almak için bu kodu Dünyatek Bilişim'e iletin; size bu bilgisayara özel bir lisans anahtarı gönderilir. Anahtar başka bilgisayarda çalışmaz." })),
    h("section", { class: "backup-section" }, form),
    h("p", { class: "license-contact" }, h("b", { text: "Dünyatek Bilişim" }), " · 0342 361 01 18 · 0535 926 49 50 · info@dunyatek.com")));
  (s.durum === "lisansli" ? copy : input).focus();
}

/* Dişli menüye "LİSANS" düğmesi (yalnızca masaüstü sürümde). */
loadLicense().then((s) => {
  if (!s) return;
  const before = document.querySelector("#logoutBtn");
  if (before && !document.querySelector("#licenseBtn")) before.before(h("button", { id: "licenseBtn", type: "button", class: "top-export-button", text: "LİSANS", onclick: () => openLicense() }));
  if (s.durum === "bitti" && !sessionStorage.getItem("lisansUyarisi")) {
    try { sessionStorage.setItem("lisansUyarisi", "1"); } catch { /* yok say */ }
    openLicense();
  }
});
