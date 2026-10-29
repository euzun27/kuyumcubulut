/* ------------------------------------------------------------------ */
/* Önerilen satış fiyatı                                               */
/* ------------------------------------------------------------------ */

/**
 * Önerilen fiyat = Gram × (Maliyet milyemi + Kâr milyemi) ÷ 1000 × güncel satış has fiyatı,
 * sonra ayardaki adıma yuvarlanır. Maliyet milyemi alıştan gelir (işçilik ve masraf dahil;
 * ör. 11,61 gr 57.155,72 TL'ye 6.435,15 has fiyatıyla alındıysa 765). Satış milyemi ayarın
 * milyemi kalır, aradaki fark İşçilik kutusuna yazılır; kullanıcı fiyatı değiştirebilir.
 */
let saleSettingCache = null;

async function loadSaleSetting(force = false) {
  if (!force && saleSettingCache && Date.now() - saleSettingCache.at < 60000) return saleSettingCache.data;
  const data = await api("/api/altin-fiyati/satis-ayari");
  saleSettingCache = { data, at: Date.now() };
  return data;
}

function profitMilyem(ayar, cinsi) {
  const key = Object.keys(ayar.cinsler || {}).find((name) => normalize(name) === normalize(cinsi));
  return Number(key === undefined ? ayar.varsayilan : ayar.cinsler[key]) || 0;
}

function roundSalePrice(value, ayar) {
  const step = Number(ayar.adim) || 0;
  if (!step) return Math.round(value * 100) / 100;
  return (ayar.yuvarlama === "YAKIN" ? Math.round(value / step) : Math.ceil(value / step - 1e-9)) * step;
}

/**
 * Satış formuna önerilen fiyat kutusu. info: { cinsi, milyem (ayar milyemi), maliyet_milyem
 * (bilinmiyorsa null), ek_iscilik (maliyette işçilik yoksa etiketteki TL), etiket_fiyat }.
 * Has fiyatı ya da gram değişince öneri yenilenir; İşçilik elle değiştirilmediyse o da güncellenir.
 */
async function attachSuggestedPrice(form, info) {
  form._suggestion?.remove();
  let ayar;
  try { ayar = await loadSaleSetting(); } catch { return; }
  if (!form.isConnected) return;
  const purity = form.elements.satis_milyem;
  const labor = form.elements.iscilik;
  if (!purity || !labor || !form.elements.has_fiyati) return;
  if (!parseNum(purity.value) && Number(info.milyem)) {
    purity.value = String(Math.round(Number(info.milyem) * 100) / 100).replace(".", ",");
    purity.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const kar = profitMilyem(ayar, info.cinsi);
  const knownCost = Number(info.maliyet_milyem) > 0;
  const costMilyem = knownCost ? Number(info.maliyet_milyem) : parseNum(purity.value);
  const extra = Number(info.ek_iscilik) || 0;
  const fixed = Number(info.etiket_fiyat) || 0;

  const value = h("strong", { class: "oneri-tutar" });
  const detail = h("small", { class: "oneri-detay" });
  const warn = h("small", { class: "oneri-uyari" });
  const applyBtn = h("button", { type: "button", class: "secondary", text: "Önerilen fiyatı uygula" });
  const box = h("div", { class: "oneri-fiyat", role: "status" },
    h("div", { class: "oneri-ust" }, h("span", { text: "Önerilen fiyat" }), value, applyBtn), detail, warn);
  form._suggestion = box;
  (form.querySelector(".barcode-bar") || form.firstChild)?.after(box);

  let auto = null;
  const calc = () => {
    const gram = parseNum(form.elements.gram.value);
    const has = parseNum(form.elements.has_fiyati.value);
    const cost = gram * costMilyem / 1000 * has + extra;
    const price = fixed || roundSalePrice(gram * (costMilyem + kar) / 1000 * has + extra, ayar);
    return { gram, has, cost, price };
  };
  const fill = () => {
    const { gram, has, price } = calc();
    if (!(gram > 0 && has > 0 && price > 0)) return;
    // Sunucu has'ı 3 haneye yuvarlar; kayıtlı tutar önerilen fiyata tam eşit çıksın.
    const gold = Math.round(gram * parseNum(purity.value)) / 1000 * has;
    const text = String(Math.max(0, Math.round((price - gold) * 100) / 100)).replace(".", ",");
    auto = text;
    if (labor.value === text) return;
    labor.value = text;
    labor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const show = () => {
    if (!box.isConnected) return;
    const { gram, has, cost, price } = calc();
    if (!(gram > 0 && has > 0)) { value.textContent = "—"; detail.textContent = "Gram ve has fiyatı girilince hesaplanır."; warn.textContent = ""; applyBtn.hidden = true; box.classList.remove("zarar"); return; }
    value.textContent = fmtMoney(price);
    const parts = fixed
      ? [`Etiket fiyatı`]
      : [`${formatTurkishNumber(gram, 0, 3)} gr × (maliyet ${formatTurkishNumber(costMilyem, 0, 2)} + kâr ${formatTurkishNumber(kar, 0, 2)} milyem) × ${formatValue("has_fiyati", has)} ₺`];
    if (extra) parts.push(`etiket işçiliği ${fmtMoney(extra)}`);
    if (!fixed && ayar.adim) parts.push(`${ayar.adim} TL'ye ${ayar.yuvarlama === "YAKIN" ? "yuvarlandı" : "yukarı yuvarlandı"}`);
    parts.push(knownCost ? `Maliyet ${fmtMoney(cost)}` : "Maliyet bilinmiyor; ayar milyemi esas alındı");
    detail.textContent = parts.join(" · ");
    const current = Math.round(calcHas(form) * 1000) / 1000 * has + parseNum(labor.value);
    const loss = knownCost && current + 0.005 < cost;
    box.classList.toggle("zarar", loss);
    warn.textContent = loss ? `Satış fiyatı (${fmtMoney(current)}) maliyetin ${fmtMoney(cost - current)} altında.` : "";
    applyBtn.hidden = Math.abs(current - price) < 0.01;
  };
  // Elle yazılmış işçilik korunur; boşsa ya da son öneriyse yeniden hesaplanır.
  const refresh = () => { if (labor.value === (auto ?? "") || (auto === null && !labor.value.trim())) fill(); show(); };
  applyBtn.onclick = () => { fill(); show(); };
  ["has_fiyati", "gram", "satis_milyem"].forEach((name) => form.elements[name]?.addEventListener("input", refresh));
  labor.addEventListener("input", show);
  form.elements.iscilik_milyem?.addEventListener("input", show);
  fill(); show();
}

/** Stoktan ürün seçilince (barkodsuz) FIFO sıradaki partinin maliyetiyle öneri. */
function suggestFromStock(form, row) {
  if (!form.elements.satis_milyem) return;
  attachSuggestedPrice(form, {
    cinsi: row.cinsi, milyem: row.alis_milyem, maliyet_milyem: row.maliyet_milyem, ek_iscilik: 0, etiket_fiyat: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Ayar: kâr milyemi ve yuvarlama (yönetici, Has fiyatı penceresinde)  */
/* ------------------------------------------------------------------ */

function saleSettingSection() {
  const section = h("section", { class: "price-source sale-setting" });
  const milyemInput = (value = "") => {
    const el = h("input", { inputMode: "text", placeholder: "0", value: value === "" ? "" : String(value).replace(".", ",") });
    el.addEventListener("input", () => { const v = el.value.replace(/[^0-9,.-]/g, ""); el.value = (v.startsWith("-") ? "-" : "") + v.replace(/-/g, ""); });
    return el;
  };
  const varsayilan = milyemInput();
  const rows = h("div", { class: "sale-setting-rows" });
  const adim = h("select", {}, ...[0, 10, 50, 100, 250, 500, 1000].map((s) => h("option", { value: String(s), text: s ? `${s} TL` : "Yuvarlama yok" })));
  const mod = h("select", {}, h("option", { value: "YUKARI", text: "Yukarı" }), h("option", { value: "YAKIN", text: "En yakın" }));
  const addRow = (cinsi = "", kar = "") => {
    const name = h("input", { name: `kar_cinsi_${rows.children.length}`, placeholder: "Cins (ör. BİLEZİK)", value: cinsi, autocomplete: "off" });
    const value = milyemInput(kar);
    const row = h("div", { class: "sale-setting-row" }, h("span", { class: "sale-setting-name" }, name), value,
      h("button", { type: "button", class: "secondary", text: "Sil", onclick: () => row.remove() }));
    rows.append(row);
    attachAutocomplete(name, "products");
  };
  const save = h("button", { type: "button", text: "Satış ayarını kaydet" });
  const num = (el) => Number(String(el.value || "0").replace(",", ".")) || 0;
  const load = async () => {
    const ayar = await loadSaleSetting(true);
    varsayilan.value = ayar.varsayilan ? String(ayar.varsayilan).replace(".", ",") : "";
    rows.replaceChildren();
    Object.entries(ayar.cinsler || {}).forEach(([cinsi, kar]) => addRow(cinsi, kar));
    adim.value = String(ayar.adim || 0); mod.value = ayar.yuvarlama || "YUKARI";
  };
  save.onclick = async () => {
    save.disabled = true;
    const cinsler = {};
    rows.querySelectorAll(".sale-setting-row").forEach((row) => {
      const [name, value] = row.querySelectorAll("input");
      if (name.value.trim()) cinsler[name.value.trim()] = num(value);
    });
    try {
      await api("/api/altin-fiyati/satis-ayari", { method: "PUT", body: JSON.stringify({ varsayilan: num(varsayilan), cinsler, adim: Number(adim.value), yuvarlama: mod.value }) });
      await load(); showMessage("Satış fiyatı ayarı kaydedildi.");
    } catch (error) { showMessage(error.message, true); }
    finally { save.disabled = false; }
  };
  section.append(h("h3", { class: "account-subtitle", text: "Önerilen satış fiyatı (kâr milyemi)" }),
    h("p", { class: "hint", text: "Barkod okutulunca ya da stoktan ürün seçilince satış formunda önerilen fiyat çıkar: Gram × (maliyet milyemi + kâr milyemi) ÷ 1000 × güncel satış has fiyatı. Maliyet milyemi alıştan gelir (işçilik dahil). Ör. maliyeti 765 olan bilezikte kâr 30 yazılırsa 795 milyem üzerinden fiyat verilir. Cinse özel kâr yazılmazsa varsayılan kullanılır." }),
    h("div", { class: "price-rates" }, h("label", { class: "field" }, "Varsayılan kâr (milyem)", varsayilan),
      h("label", { class: "field" }, "Yuvarlama adımı", adim), h("label", { class: "field" }, "Yuvarlama", mod)),
    h("strong", { class: "sale-setting-title", text: "Cinse özel kâr (milyem)" }), rows,
    h("div", { class: "form-bottom-actions" }, h("button", { type: "button", class: "secondary", text: "Cins ekle", onclick: () => addRow() }), save));
  load().catch((error) => showMessage(error.message, true));
  return section;
}
