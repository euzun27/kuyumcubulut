/*
 * Tarihler her yerde gün.ay.yıl (gg.aa.yyyy) görünür.
 * Tarayıcının tarih kutusu (input type=date) bilgisayarın diline göre
 * ay/gün/yıl gösterebildiği için her tarih kutusu sayfaya eklenince
 * gg.aa.yyyy yazılan bir metin kutusuna ve takvim düğmesine çevrilir.
 * Takvim de programın kendisidir (Türkçe, pazartesiyle başlar) ve kutunun
 * hemen altında açılır; tarayıcının takvimi masaüstü penceresinde ekranın
 * köşesinde ve İngilizce açılabiliyordu.
 * Asıl kutu gizli kalır ve değeri yine YYYY-AA-GG'dir; bu yüzden formlar,
 * `.value` okuyan kodlar ve sunucu hiç değişmeden çalışır.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-10-21" -> "21.10.2026"; tarih değilse olduğu gibi. */
function trDate(value) {
  const m = ISO_DATE.exec(String(value ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value ?? "");
}

/** "21.10.2026", "21/10/2026", "21102026" -> "2026-10-21"; geçersizse null, boşsa "". */
function parseTrDate(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw) || /^(\d{2})(\d{2})(\d{4})$/.exec(raw);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>';

function enhanceDateInput(input) {
  if (input.dataset.trDate) return;
  input.dataset.trDate = "1";
  const initial = NATIVE_VALUE.get.call(input);
  const text = document.createElement("input");
  text.type = "text";
  text.className = `${input.className} tr-date-text`.trim();
  text.inputMode = "numeric";
  text.autocomplete = "off";
  text.placeholder = "gg.aa.yyyy";
  text.maxLength = 10;
  text.required = input.required;
  text.disabled = input.disabled;
  text.setAttribute("aria-label", input.getAttribute("aria-label") || "Tarih (gün.ay.yıl)");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tr-date-btn";
  button.title = "Takvimden seç";
  button.setAttribute("aria-label", "Takvimden seç");
  button.innerHTML = CALENDAR_ICON;
  button.disabled = input.disabled;
  const wrap = document.createElement("span");
  wrap.className = "tr-date";
  wrap.append(text, button);

  input.type = "hidden";
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => NATIVE_VALUE.get.call(input),
    set: (v) => { NATIVE_VALUE.set.call(input, v ?? ""); text.value = trDate(v); text.setCustomValidity(""); },
  });
  input.value = initial;
  input.after(wrap);

  const commit = (iso) => {
    if (iso === NATIVE_VALUE.get.call(input)) return;
    NATIVE_VALUE.set.call(input, iso);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const check = (final) => {
    const iso = parseTrDate(text.value);
    if (iso === null) {
      text.setCustomValidity(final ? "Tarihi gün.ay.yıl biçiminde girin (örn. 21.10.2026)." : "");
      if (final) text.reportValidity();
      return;
    }
    text.setCustomValidity("");
    if (final && iso) text.value = trDate(iso);
    commit(iso);
  };
  text.addEventListener("input", (event) => {
    // Yalnızca rakam yazılsa da noktalar kendiliğinden gelir: 21102026 -> 21.10.2026
    if (event.inputType && event.inputType.startsWith("delete")) return;
    const digits = text.value.replace(/\D/g, "").slice(0, 8);
    // "1.5.2026" gibi tek haneli gün/ay yazana dokunulmaz.
    if (/^[\d.]*$/.test(text.value) && !/(^|\.)\d\./.test(text.value)) text.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
    if (text.value.length === 10) check(false);
  });
  text.addEventListener("change", () => check(true));
  text.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    // Ok tuşlarıyla bir gün ileri / geri.
    const iso = parseTrDate(text.value) || (typeof today === "function" ? today() : new Date().toLocaleDateString("en-CA"));
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (event.key === "ArrowUp" ? 1 : -1));
    event.preventDefault();
    const next = date.toISOString().slice(0, 10);
    text.value = trDate(next);
    commit(next);
  });
  button.addEventListener("click", () => {
    if (openCalendar?.wrap === wrap) { closeCalendar(); return; }
    showCalendar(wrap, parseTrDate(text.value) || NATIVE_VALUE.get.call(input), (iso) => {
      text.value = trDate(iso); text.setCustomValidity(""); commit(iso); text.focus();
    });
  });
  new MutationObserver(() => { text.disabled = button.disabled = input.disabled; text.required = input.required; })
    .observe(input, { attributes: true, attributeFilter: ["disabled", "required"] });
}

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TR_DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
let openCalendar = null;

function closeCalendar() {
  if (!openCalendar) return;
  openCalendar.box.remove();
  document.removeEventListener("mousedown", openCalendar.outside, true);
  document.removeEventListener("keydown", openCalendar.key, true);
  window.removeEventListener("resize", closeCalendar);
  document.removeEventListener("scroll", openCalendar.scroll, true);
  openCalendar = null;
}

/** Kutunun altında Türkçe ay takvimi; seçilen gün onPick(YYYY-AA-GG) ile döner. */
function showCalendar(wrap, selectedIso, onPick) {
  closeCalendar();
  const todayIso = typeof today === "function" ? today() : new Date().toLocaleDateString("en-CA");
  const start = ISO_DATE.exec(selectedIso || "") ? selectedIso : todayIso;
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7)) - 1;
  const box = document.createElement("div");
  box.className = "tr-cal";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Takvim");
  const pick = (iso) => { closeCalendar(); onPick(iso); };
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const render = () => {
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "tr-cal-head";
    const nav = (label, delta) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tr-cal-nav"; b.textContent = label;
      b.setAttribute("aria-label", delta < 0 ? "Önceki ay" : "Sonraki ay");
      b.onclick = () => { month += delta; if (month < 0) { month = 11; year -= 1; } if (month > 11) { month = 0; year += 1; } render(); };
      return b;
    };
    const title = document.createElement("strong");
    title.textContent = `${TR_MONTHS[month]} ${year}`;
    head.append(nav("‹", -1), title, nav("›", 1));
    const grid = document.createElement("div");
    grid.className = "tr-cal-grid";
    TR_DAYS.forEach((name) => { const s = document.createElement("span"); s.className = "tr-cal-dow"; s.textContent = name; grid.append(s); });
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (first.getUTCDay() + 6) % 7; // pazartesi = 0
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let i = 0; i < offset; i++) grid.append(document.createElement("span"));
    for (let day = 1; day <= days; day++) {
      const value = iso(year, month, day);
      const b = document.createElement("button");
      b.type = "button"; b.textContent = String(day);
      b.className = `tr-cal-day${value === selectedIso ? " selected" : ""}${value === todayIso ? " today" : ""}`;
      b.setAttribute("aria-label", trDate(value));
      b.onclick = () => pick(value);
      grid.append(b);
    }
    const foot = document.createElement("div");
    foot.className = "tr-cal-foot";
    const todayBtn = document.createElement("button");
    todayBtn.type = "button"; todayBtn.textContent = "Bugün"; todayBtn.onclick = () => pick(todayIso);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.textContent = "Kapat"; closeBtn.onclick = closeCalendar;
    foot.append(todayBtn, closeBtn);
    box.append(head, grid, foot);
  };
  render();
  document.body.append(box);
  // Kutunun altına, sığmazsa üstüne; pencereden taşmaz.
  const r = wrap.getBoundingClientRect();
  const w = box.offsetWidth; const hgt = box.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 4 + hgt <= window.innerHeight - 8;
  box.style.left = `${left}px`;
  box.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - hgt - 4)}px`;
  const outside = (e) => { if (!box.contains(e.target) && !wrap.contains(e.target)) closeCalendar(); };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeCalendar(); } };
  const scroll = (e) => { if (!box.contains(e.target)) closeCalendar(); };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("resize", closeCalendar);
  document.addEventListener("scroll", scroll, true);
  openCalendar = { box, wrap, outside, key, scroll };
}

function enhanceDateInputs(root) {
  if (root.matches?.('input[type="date"]')) enhanceDateInput(root);
  root.querySelectorAll?.('input[type="date"]').forEach(enhanceDateInput);
}

new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) {
    if (node.nodeType === 1) enhanceDateInputs(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("DOMContentLoaded", () => enhanceDateInputs(document.body));
