/*
 * Fiyat panosu (TV): üst çubuktaki TV düğmesi panoyu ayrı bir pencerede açar;
 * pencere dükkândaki TV'ye veya ikinci ekrana taşınıp tam ekran yapılır.
 * Dişli menüdeki "FİYAT PANOSU (TV) AYARLARI" hangi satırların görüneceğini,
 * fiyatın piyasadan mı, has fiyatı x çarpandan mı, elle mi geleceğini belirler.
 */

const PANO_SOURCES = [["piyasa", "Piyasa"], ["hesap", "Has × çarpan"], ["elle", "Elle"]];
const PANO_UNITS = { gr: "TL/gr", adet: "TL/adet", kur: "TL" };
// Fiyatlarda "10.450" binlik ayraçla yazılmış sayılır (10450); ondalık için virgül kullanılır.
const panoPrice = (text) => { const t = String(text).trim(); return /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : readAmount(t); };
const numText = (v) => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));

function openPanoWindow() {
  // Ayrı pencere: TV'ye sürüklenip "Tam ekran" ile açılır. Pencere zaten açıksa öne gelir.
  const w = window.open("/pano", "dunyatek_pano", "popup,width=1280,height=720");
  if (!w) { showMessage("Pano penceresi açılamadı. Açılır pencere engelini kaldırın.", true); return; }
  w.focus();
}

async function openPanoSettings() {
  const { box, close } = openModal("Fiyat panosu (TV) ayarları", "pano-modal");
  let data;
  try { data = await api("/api/pano?hepsi=1"); } catch (error) { showMessage(error.message, true); close(); return; }
  const admin = isAdmin();
  const form = h("form", { class: "settings-form pano-settings" });
  const sourceText = { piyasa: "piyasa", hesap: "has × çarpan", elle: "elle", yok: "fiyat yok" };
  const rows = data.satirlar.map((r) => {
    const show = h("input", { type: "checkbox", checked: r.gorunur, disabled: !admin, "aria-label": `${r.ad} panoda görünsün` });
    const ad = h("input", { value: r.ad, maxlength: 40, disabled: !admin, "aria-label": "Panoda görünen ad" });
    const kaynak = h("select", { disabled: !admin, "aria-label": "Fiyat kaynağı" },
      ...PANO_SOURCES.filter(([k]) => k !== "hesap" || r.alis_carpan !== null).map(([k, t]) => h("option", { value: k, text: t, selected: r.kaynak === k })));
    const carpan = r.alis_carpan === null ? null : [decimalInput("alis_carpan"), decimalInput("satis_carpan")];
    if (carpan) { carpan[0].value = numText(r.alis_carpan); carpan[1].value = numText(r.satis_carpan); carpan.forEach((i) => { i.disabled = !admin; }); }
    const elle = [decimalInput("elle_alis", "Alış"), decimalInput("elle_satis", "Satış")];
    elle[0].value = numText(r.elle_alis); elle[1].value = numText(r.elle_satis); elle.forEach((i) => { i.disabled = !admin; });
    const sync = () => { elle.forEach((i) => { i.closest(".pano-elle").hidden = kaynak.value !== "elle"; }); };
    const now = h("small", { class: "cell-sub", text: r.alis === null ? "Fiyat yok" : `Şu an ${formatTurkishNumber(r.alis, 2, 2)} / ${formatTurkishNumber(r.satis, 2, 2)} ${PANO_UNITS[r.birim]} · ${sourceText[r.fiyat_kaynagi]}` });
    const line = h("div", { class: "pano-row" },
      h("label", { class: "pano-show" }, show),
      h("div", { class: "pano-name" }, ad, now),
      kaynak,
      carpan ? h("div", { class: "pano-carpan", title: "1 gram / 1 adet kaç gram has eder (alış / satış). Has × çarpan ve piyasada fiyat bulunamazsa kullanılır." }, h("span", { text: "Çarpan" }), carpan[0], carpan[1]) : h("div", { class: "pano-carpan muted", text: r.kod === "GUMUS" ? "Gümüş / Bakır fiyatından" : "Döviz kurundan" }),
      h("div", { class: "pano-elle" }, h("span", { text: "Elle" }), elle[0], elle[1]));
    kaynak.addEventListener("change", sync);
    setTimeout(sync, 0);
    return { r, show, ad, kaynak, carpan, elle, line };
  });
  const altYazi = h("input", { value: data.alt_yazi || "", maxlength: 200, disabled: !admin, placeholder: "Örn. Kredi kartına 6 taksit · Hafta içi 09:00 - 19:00" });
  form.append(
    h("p", { class: "hint", text: "Piyasa: canlı kaynaktaki ürün fiyatı; bulunamazsa has fiyatı × çarpan kullanılır. Has × çarpan: kendi kâr payınızla hesaplanır. Elle: yazdığınız fiyat değişmeden görünür." }),
    h("div", { class: "pano-list" }, ...rows.map((x) => x.line)),
    labeled("Kayan yazı (panonun altında)", altYazi));
  if (!admin) form.append(h("p", { class: "hint", text: "Pano ayarlarını yönetici değiştirebilir." }));
  const save = h("button", { type: "submit", text: "Kaydet", disabled: !admin });
  form.append(h("div", { class: "form-bottom-actions" },
    h("button", { type: "button", class: "secondary", text: "Panoyu aç", onclick: openPanoWindow }),
    h("button", { type: "button", class: "secondary", text: "Kapat", onclick: close }), save));
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true;
    const satirlar = rows.map((x) => ({
      kod: x.r.kod, ad: x.ad.value, gorunur: x.show.checked, kaynak: x.kaynak.value,
      alis_carpan: x.carpan ? x.carpan[0].value.replace(",", ".") : undefined,
      satis_carpan: x.carpan ? x.carpan[1].value.replace(",", ".") : undefined,
      elle_alis: x.elle[0].value ? panoPrice(x.elle[0].value) : null,
      elle_satis: x.elle[1].value ? panoPrice(x.elle[1].value) : null,
    }));
    try { await api("/api/pano", { method: "PUT", body: JSON.stringify({ satirlar, alt_yazi: altYazi.value }) }); close(); showMessage("Pano ayarları kaydedildi. Açık pano birkaç saniye içinde yenilenir."); }
    catch (error) { showMessage(error.message, true); save.disabled = false; }
  };
  box.append(form);
}

document.querySelector("#tvBtn")?.addEventListener("click", openPanoWindow);
document.querySelector("#panoBtn")?.addEventListener("click", () => { document.querySelector("#dataMenu")?.removeAttribute("open"); openPanoSettings(); });
