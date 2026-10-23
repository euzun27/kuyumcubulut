/*
 * Grafikler ve dashboard performans bölümü: SVG çizgi grafik (artı imleçli
 * ipucu), yatay çubuk grafik, mini eğri (sparkline) ve önceki döneme göre
 * değişim gösteren göstergeler. Veriler /api/rapor'dan gelir.
 * Renkler styles.css içindeki --viz-* değişkenlerindedir (açık/koyu tema).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v)); });
  children.flat().filter(Boolean).forEach((c) => node.append(c));
  return node;
}

const VIZ_SERIES = {
  satis: { label: "Satış", color: "var(--viz-satis)" },
  alis: { label: "Alış", color: "var(--viz-alis)" },
  kar: { label: "Kâr", color: "var(--viz-kar)" },
};

/** 1.234 -> "1,2 b", 2.500.000 -> "2,5 mn" */
function vizCompact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${formatTurkishNumber(v / 1e6, 0, a >= 1e7 ? 0 : 1)} mn`;
  if (a >= 1e3) return `${formatTurkishNumber(v / 1e3, 0, a >= 1e4 ? 0 : 1)} b`;
  return formatTurkishNumber(v, 0, a < 10 && a % 1 ? 2 : 0);
}

function vizNiceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

const vizDate = (iso, opts = { day: "numeric", month: "short" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("tr-TR", opts);

let vizTipNode = null;
function vizTip() {
  if (!vizTipNode) { vizTipNode = h("div", { class: "viz-tip", role: "status", "aria-live": "polite" }); document.body.append(vizTipNode); }
  return vizTipNode;
}
function vizTipShow(x, y, title, rows) {
  const tip = vizTip();
  tip.replaceChildren(h("div", { class: "viz-tip-title", text: title }), ...rows.map((r) => h("div", { class: "viz-tip-row" },
    h("i", { class: `viz-key ${r.bar ? "bar" : ""}`, style: `--c:${r.color}` }), h("strong", { text: r.value }), h("span", { text: r.label }))));
  tip.classList.add("show");
  const w = tip.offsetWidth, ht = tip.offsetHeight;
  let left = x + 14, top = y - ht - 10;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top < 8) top = y + 16;
  tip.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
}
function vizTipHide() { vizTipNode?.classList.remove("show"); }

/**
 * Çizgi grafik. rows: [{tarih, ...}], series: [{key, kind: "satis"|"alis"|"kar"}],
 * fmt: değeri tam yazar (ipucu), short: eksen için kısa yazar.
 */
function lineChart(rows, { series, fmt, short = vizCompact, height = 260, area = 0, label = "Grafik" }) {
  const root = h("div", { class: "viz-line" });
  const hidden = new Set();
  const legend = h("div", { class: "viz-legend" }, ...series.map((s) => h("button", {
    type: "button", class: "viz-legend-item", "aria-pressed": "true", title: "Göster / gizle",
    onclick: (e) => {
      const btn = e.currentTarget;
      if (hidden.has(s.key)) hidden.delete(s.key); else if (hidden.size < series.length - 1) hidden.add(s.key); else return;
      btn.setAttribute("aria-pressed", String(!hidden.has(s.key)));
      lastWidth = 0; draw();
    },
  }, h("i", { class: "viz-key", style: `--c:${VIZ_SERIES[s.kind].color}` }), s.label || VIZ_SERIES[s.kind].label)));
  const holder = h("div", { class: "viz-svg-holder" });
  root.append(legend, holder);
  const values = (r, s) => Number(r[s.key]) || 0;
  let lastWidth = 0;
  const allSeries = series;
  const draw = () => {
    const width = Math.max(280, Math.floor(holder.clientWidth || 600));
    if (width === lastWidth && holder.firstChild) return;
    lastWidth = width;
    const series = allSeries.filter((s) => !hidden.has(s.key));
    const all = rows.flatMap((r) => series.map((s) => values(r, s)));
    const ticks = vizNiceTicks(Math.min(0, ...all), Math.max(0, ...all));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const left = Math.max(...ticks.map((t) => short(t).length)) * 6.6 + 14;
    const m = { top: 14, right: 18, bottom: 28, left };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const n = rows.length;
    const xAt = (i) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const yAt = (v) => m.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "viz-svg", role: "img", "aria-label": label, tabindex: 0 });
    const grid = svgEl("g", { class: "viz-grid" });
    ticks.forEach((t) => {
      grid.append(svgEl("line", { x1: m.left, x2: width - m.right, y1: yAt(t), y2: yAt(t), class: t === 0 ? "viz-base" : "" }));
      const tx = svgEl("text", { x: m.left - 8, y: yAt(t) + 4, "text-anchor": "end", class: "viz-tick" }); tx.textContent = short(t); grid.append(tx);
    });
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    rows.forEach((r, i) => {
      if (i % every && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every * 0.6) return;
      const tx = svgEl("text", { x: xAt(i), y: height - 8, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "viz-tick" });
      tx.textContent = vizDate(r.tarih); grid.append(tx);
    });
    svg.append(grid);
    series.forEach((s, si) => {
      const color = VIZ_SERIES[s.kind].color;
      const pts = rows.map((r, i) => [xAt(i), yAt(values(r, s))]);
      const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
      if (s === allSeries[area] && n > 1) svg.append(svgEl("path", { d: `${d}L${xAt(n - 1)},${yAt(Math.max(0, y0))}L${xAt(0)},${yAt(Math.max(0, y0))}Z`, class: "viz-area", style: `fill:${color}` }));
      if (n > 1) svg.append(svgEl("path", { d, class: "viz-path", style: `stroke:${color}` }));
      const [lx, ly] = pts[n - 1] || [0, 0];
      if (n) svg.append(svgEl("circle", { cx: lx, cy: ly, r: 4, class: "viz-dot", style: `fill:${color}` }));
    });
    const cross = svgEl("line", { y1: m.top, y2: m.top + ih, class: "viz-cross" });
    const marks = series.map((s) => svgEl("circle", { r: 4.5, class: "viz-dot viz-hover-dot", style: `fill:${VIZ_SERIES[s.kind].color}` }));
    const hover = svgEl("g", { class: "viz-hover" }, cross, ...marks);
    const hit = svgEl("rect", { x: m.left - 10, y: 0, width: iw + 20, height, fill: "transparent" });
    svg.append(hover, hit);
    let active = n - 1;
    const show = (i, clientX, clientY) => {
      if (!n) return;
      active = Math.max(0, Math.min(n - 1, i));
      const r = rows[active];
      cross.setAttribute("x1", xAt(active)); cross.setAttribute("x2", xAt(active));
      marks.forEach((mk, si) => { mk.setAttribute("cx", xAt(active)); mk.setAttribute("cy", yAt(values(r, series[si]))); });
      hover.classList.add("on");
      const box = svg.getBoundingClientRect();
      vizTipShow(clientX ?? box.left + xAt(active), clientY ?? box.top + m.top + 20, r.tarih_bitis ? `${vizDate(r.tarih, { day: "numeric", month: "long" })} – ${vizDate(r.tarih_bitis, { day: "numeric", month: "long" })}` : vizDate(r.tarih, { weekday: "short", day: "numeric", month: "long" }),
        series.map((s) => ({ color: VIZ_SERIES[s.kind].color, value: fmt(values(r, s)), label: s.label || VIZ_SERIES[s.kind].label })));
    };
    const indexAt = (clientX) => { const box = svg.getBoundingClientRect(); return n <= 1 ? 0 : Math.round(((clientX - box.left - m.left) / iw) * (n - 1)); };
    hit.addEventListener("pointermove", (e) => show(indexAt(e.clientX), e.clientX, e.clientY));
    hit.addEventListener("pointerleave", () => { hover.classList.remove("on"); vizTipHide(); });
    svg.addEventListener("focus", () => show(active));
    svg.addEventListener("blur", () => { hover.classList.remove("on"); vizTipHide(); });
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show(active + (e.key === "ArrowRight" ? 1 : -1)); }
    });
    holder.replaceChildren(svg);
  };
  if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(holder);
  requestAnimationFrame(draw);
  return root;
}

/** Yatay çubuklar: rows [{ad, deger, alt?}] */
function hBars(rows, { fmt, kind = "satis", empty = "Kayıt yok." }) {
  const list = h("div", { class: "viz-bars", role: "list" });
  if (!rows.length) { list.append(h("div", { class: "empty", text: empty })); return list; }
  const max = Math.max(...rows.map((r) => Math.abs(r.deger)), 1);
  rows.forEach((r) => {
    const item = h("div", { class: "viz-bar-row", role: "listitem", tabindex: 0 },
      h("span", { class: "viz-bar-label", text: r.ad, title: r.ad }),
      h("span", { class: "viz-bar-track" }, h("i", { style: `width:${Math.max(1.5, (Math.abs(r.deger) / max) * 100)}%;--c:${VIZ_SERIES[kind].color}` })),
      h("span", { class: "viz-bar-value", text: fmt(r.deger) }));
    const tip = (x, y) => vizTipShow(x, y, r.ad, [{ color: VIZ_SERIES[kind].color, value: fmt(r.deger), label: r.alt || "", bar: true }]);
    item.addEventListener("pointermove", (e) => tip(e.clientX, e.clientY));
    item.addEventListener("pointerleave", vizTipHide);
    item.addEventListener("focus", () => { const b = item.getBoundingClientRect(); tip(b.left + b.width / 2, b.top); });
    item.addEventListener("blur", vizTipHide);
    list.append(item);
  });
  return list;
}

function sparkline(values, kind = "satis") {
  const w = 200, ht = 30, n = values.length;
  if (n < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i) => 2 + (i / (n - 1)) * (w - 6);
  const y = (v) => ht - 4 - ((v - min) / (max - min || 1)) * (ht - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return svgEl("svg", { class: "viz-spark", height: ht, viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: "none", "aria-hidden": "true" },
    svgEl("path", { d, class: "viz-spark-path" }),
    svgEl("circle", { cx: x(n - 1), cy: y(values[n - 1]), r: 3, style: `fill:${VIZ_SERIES[kind].color}`, class: "viz-spark-dot" }));
}

/** Gösterge kutusu: değer, önceki döneme göre değişim, mini eğri. */
function kpiTile({ label, value, sub = "", cur, prev, goodUp = true, spark, kind = "satis", prevLabel = "önceki dönem" }) {
  const tile = h("article", { class: "kpi-tile" }, h("span", { class: "kpi-label", text: label }), h("strong", { class: "kpi-value", text: value }));
  const foot = h("div", { class: "kpi-foot" });
  if (prev !== undefined && cur !== undefined) {
    if (Math.abs(prev) < 1e-9) foot.append(h("span", { class: "kpi-delta flat", text: cur ? "Yeni" : "—" }));
    else {
      const pct = ((cur - prev) / Math.abs(prev)) * 100;
      const up = pct >= 0;
      const tone = Math.abs(pct) < 0.5 ? "flat" : up === goodUp ? "good" : "bad";
      foot.append(h("span", { class: `kpi-delta ${tone}`, title: `${prevLabel}: ${formatTurkishNumber(prev, 0, 2)}` },
        h("b", { text: Math.abs(pct) < 0.5 ? "■" : up ? "▲" : "▼", "aria-hidden": "true" }), ` %${formatTurkishNumber(Math.abs(pct), 0, Math.abs(pct) < 10 ? 1 : 0)}`));
      foot.append(h("span", { class: "kpi-sub", text: `${prevLabel}e göre` }));
      tile.title = `${prevLabel}: ${formatTurkishNumber(prev, 0, 2)}`;
    }
  }
  if (sub) tile.append(h("small", { class: "kpi-note", text: sub }));
  const s = spark && sparkline(spark, kind);
  if (s) tile.append(s);
  tile.append(foot);
  return tile;
}

/* ------------------------------------------------------------------ */
/* Dashboard performans bölümü                                         */
/* ------------------------------------------------------------------ */

const DASH_RANGES = [["7", "7 gün"], ["30", "30 gün"], ["90", "90 gün"], ["ay", "Bu ay"], ["yil", "Bu yıl"]];
state.dashAralik = (() => { try { return localStorage.getItem("dashAralik") || "30"; } catch { return "30"; } })();
state.dashBirim = null;

function isoShift(iso, days) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function dayDiff(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }

function dashRange(key) {
  const end = state.serverToday || today();
  let start;
  if (key === "ay") start = `${end.slice(0, 8)}01`;
  else if (key === "yil") start = `${end.slice(0, 4)}-01-01`;
  else start = isoShift(end, -(Number(key) - 1));
  const len = dayDiff(start, end) + 1;
  return { start, end, prevStart: isoShift(start, -len), prevEnd: isoShift(start, -1), len };
}

/** Rapordaki günleri aralığın her gününü içerecek şekilde doldurur. */
function fillDays(rows, start, end) {
  const map = new Map(rows.map((r) => [r.tarih, r]));
  const out = [];
  for (let d = start; d <= end; d = isoShift(d, 1)) out.push(map.get(d) || { tarih: d, satis_tl: 0, alis_tl: 0, kar_tl: 0, satis_has: 0, alis_has: 0, milyem_kari_has: 0, satis_gram: 0, satis_islem: 0 });
  return out;
}

/** Uzun aralıkta günlük gürültüyü azaltmak için haftalık toplar. */
function bucketDays(days) {
  if (days.length <= 62) return days;
  // Son hafta tam olsun diye sondan geriye doğru gruplanır.
  const out = [];
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end);
    const sum = { tarih: chunk[0].tarih, tarih_bitis: chunk[chunk.length - 1].tarih };
    Object.keys(chunk[0]).filter((k) => !k.startsWith("tarih")).forEach((k) => { sum[k] = chunk.reduce((t, d) => t + (Number(d[k]) || 0), 0); });
    out.unshift(sum);
  }
  return out;
}

function renderPerformance() {
  const panel = h("section", { class: "dashboard-panel perf-panel" });
  const head = h("div", { class: "perf-head" }, h("div", {}, h("h2", { text: "Performans" }), h("p", { class: "perf-range", text: "Yükleniyor…" })));
  const controls = h("div", { class: "perf-controls" });
  head.append(controls);
  const body = h("div", { class: "perf-body loading" });
  panel.append(head, body);
  const load = async () => {
    body.classList.add("loading");
    const r = dashRange(state.dashAralik);
    try {
      const [cur, prev] = await Promise.all([api(`/api/rapor?baslangic=${r.start}&bitis=${r.end}`), api(`/api/rapor?baslangic=${r.prevStart}&bitis=${r.prevEnd}`)]);
      drawPerformance(panel, head, controls, body, cur, prev, r, load);
    } catch (error) {
      body.replaceChildren(h("div", { class: "empty", text: error.message }));
    }
    body.classList.remove("loading");
  };
  load();
  return panel;
}

function drawPerformance(panel, head, controls, body, cur, prev, r, reload) {
  const o = cur.ozet, p = prev.ozet;
  const tlMode = state.dashBirim ? state.dashBirim === "tl" : (o.satis_tl + o.alis_tl + p.satis_tl) > 0;
  head.querySelector(".perf-range").textContent = `${vizDate(r.start, { day: "numeric", month: "long" })} – ${vizDate(r.end, { day: "numeric", month: "long", year: "numeric" })} · önceki ${r.len} günle karşılaştırma`;
  controls.replaceChildren(
    renderTabs(DASH_RANGES, state.dashAralik, (v) => { state.dashAralik = v; try { localStorage.setItem("dashAralik", v); } catch { /* yok */ } reload(); }),
    renderTabs([["tl", "TL"], ["has", "Has"]], tlMode ? "tl" : "has", (v) => { state.dashBirim = v; drawPerformance(panel, head, controls, body, cur, prev, r, reload); }));
  const days = fillDays(cur.gunler, r.start, r.end);
  const sparkDays = bucketDays(days);
  const hasFmt = (v) => `${formatValue("has", v)} has`;
  const fmt = tlMode ? fmtMoney : hasFmt;
  const kpis = h("div", { class: "kpi-row" },
    tlMode
      ? kpiTile({ label: "Ciro", value: fmtMoney(o.satis_tl + o.hurda_satis_tl), sub: `${o.satis_islem} satış · ort. sepet ${fmtMoney(o.ortalama_sepet_tl)}`, cur: o.satis_tl + o.hurda_satis_tl, prev: p.satis_tl + p.hurda_satis_tl, spark: sparkDays.map((d) => d.satis_tl), kind: "satis" })
      : kpiTile({ label: "Satılan has", value: hasFmt(o.satis_has), sub: `${o.satis_islem} satış`, cur: o.satis_has, prev: p.satis_has, spark: sparkDays.map((d) => d.satis_has), kind: "satis" }),
    tlMode
      ? kpiTile({ label: "Brüt kâr", value: fmtMoney(o.brut_kar_tl + o.hurda_kar_tl), sub: o.satis_tl ? `Kâr marjı %${formatTurkishNumber(((o.brut_kar_tl + o.hurda_kar_tl) / (o.satis_tl + o.hurda_satis_tl || 1)) * 100, 0, 1)}` : "", cur: o.brut_kar_tl + o.hurda_kar_tl, prev: p.brut_kar_tl + p.hurda_kar_tl, spark: sparkDays.map((d) => d.kar_tl), kind: "kar" })
      : kpiTile({ label: "Milyem kârı", value: hasFmt(o.milyem_kari_has), sub: "Satış milyemi − alış milyemi", cur: o.milyem_kari_has, prev: p.milyem_kari_has, spark: sparkDays.map((d) => d.milyem_kari_has), kind: "kar" }),
    kpiTile({ label: "Satılan gram", value: `${formatValue("gram", o.satis_gram)} gr`, sub: `${formatValue("has", o.satis_has)} has${o.satis_adet ? ` · ${formatTurkishNumber(o.satis_adet)} adet` : ""}`, cur: o.satis_gram, prev: p.satis_gram, spark: sparkDays.map((d) => d.satis_gram), kind: "satis" }),
    tlMode
      ? kpiTile({ label: "Alış", value: fmtMoney(o.alis_tl + o.hurda_alis_tl), sub: `${o.alis_islem} alış · ${formatValue("gram", o.alis_gram)} gr`, cur: o.alis_tl + o.hurda_alis_tl, prev: p.alis_tl + p.hurda_alis_tl, goodUp: false, spark: sparkDays.map((d) => d.alis_tl), kind: "alis" })
      : kpiTile({ label: "Alınan has", value: hasFmt(o.alis_has), sub: `${o.alis_islem} alış · ${formatValue("gram", o.alis_gram)} gr`, cur: o.alis_has, prev: p.alis_has, goodUp: false, spark: sparkDays.map((d) => d.alis_has), kind: "alis" }),
    kpiTile({ label: "Gider", value: hasFmt(o.gider_has), sub: state.price ? `≈ ${fmtMoney(o.gider_has * state.price.satis)}` : "", cur: o.gider_has, prev: p.gider_has, goodUp: false }));
  const chartRows = bucketDays(days);
  const weekly = chartRows !== days;
  const series = tlMode
    ? [{ key: "satis_tl", kind: "satis" }, { key: "alis_tl", kind: "alis" }, { key: "kar_tl", kind: "kar" }]
    : [{ key: "satis_has", kind: "satis" }, { key: "alis_has", kind: "alis" }, { key: "milyem_kari_has", kind: "kar", label: "Milyem kârı" }];
  const main = h("section", { class: "perf-card perf-main" },
    h("div", { class: "perf-card-head" }, h("h3", { text: weekly ? "Haftalık seyir" : "Günlük seyir" }), h("span", { text: tlMode ? "TL" : "Has (gr)" })),
    lineChart(chartRows, { series, fmt, short: tlMode ? vizCompact : (v) => formatTurkishNumber(v, 0, Math.abs(v) < 10 && v % 1 ? 1 : 0), area: 0, label: `${weekly ? "Haftalık" : "Günlük"} satış, alış ve kâr grafiği` }));
  const products = cur.urunler.slice().sort((a, b) => (tlMode ? b.tutar - a.tutar : b.has - a.has)).slice(0, 6)
    .map((u) => ({ ad: `${u.ad} ${u.ayar || ""}`.trim(), deger: tlMode ? u.tutar : u.has, alt: `${u.islem} satış · ${formatValue("gram", u.gram)} gr` }));
  const price = state.price?.alis || 0;
  const stock = cur.stok.map((s) => ({ ad: `${s.cinsi} ${s.ayar || ""}`.trim(), deger: Number(s.kalan_has) || 0, alt: `${formatValue("gram", s.kalan_gram)} gr${price ? ` · ≈ ${fmtMoney(s.kalan_has * price)}` : ""}` }))
    .sort((a, b) => b.deger - a.deger);
  const stockTop = stock.slice(0, 6);
  if (stock.length > 6) stockTop.push({ ad: `Diğer (${stock.length - 6})`, deger: stock.slice(6).reduce((t, s) => t + s.deger, 0), alt: "Kalan ürünler" });
  const stockTotal = stock.reduce((t, s) => t + s.deger, 0);
  const customers = cur.musteriler.slice(0, 5).map((m) => ({ ad: m.ad, deger: tlMode ? m.tutar : m.has, alt: `${m.islem} işlem · ${formatValue("gram", m.gram)} gr` }));
  const side = h("div", { class: "perf-side" },
    h("section", { class: "perf-card" }, h("div", { class: "perf-card-head" }, h("h3", { text: "En çok satan ürünler" }), h("span", { text: tlMode ? "Ciro" : "Has" })), hBars(products, { fmt: tlMode ? vizCompactMoney : hasFmt, kind: "satis", empty: "Bu dönemde satış yok." })),
    h("section", { class: "perf-card" }, h("div", { class: "perf-card-head" }, h("h3", { text: "Stok dağılımı" }), h("span", { text: `${formatValue("has", stockTotal)} has${price ? ` · ≈ ${vizCompactMoney(stockTotal * price)}` : ""}` })), hBars(stockTop, { fmt: hasFmt, kind: "alis", empty: "Stok yok." })));
  const customersCard = h("section", { class: "perf-card" }, h("div", { class: "perf-card-head" }, h("h3", { text: "En iyi müşteriler" }), h("button", { type: "button", class: "link-btn", text: "Tüm rapor", onclick: () => { state.raporOzel = [r.start, r.end]; state.raporAralik = "ozel"; goView("rapor"); } })), hBars(customers, { fmt: tlMode ? vizCompactMoney : hasFmt, kind: "kar", empty: "Bu dönemde satış yok." }));
  body.replaceChildren(kpis, h("div", { class: "perf-grid" }, h("div", { class: "perf-side" }, main, customersCard), side));
}

function vizCompactMoney(v) { return Math.abs(v) >= 1e4 ? `${vizCompact(v)} ₺` : fmtMoney(v); }

/* Dashboard'daki 7 günlük çubuk grafiğin yerine performans bölümü. */
renderWeekChart = function () { return renderPerformance(); };

/* Raporlar ekranındaki günlük grafik. */
reportChart = function (days) {
  const wrap = h("section", { class: "dashboard-panel perf-card perf-main report-chart" });
  const [start, end] = rangeOf(state.raporAralik);
  const filled = bucketDays(fillDays(days, start, end));
  const tlMode = days.some((d) => d.satis_tl || d.alis_tl);
  const fmt = tlMode ? fmtMoney : (v) => `${formatValue("has", v)} has`;
  wrap.append(h("div", { class: "perf-card-head" }, h("h3", { text: filled.length < fillDays(days, start, end).length ? "Haftalık seyir" : "Günlük seyir" }), h("span", { text: tlMode ? "TL" : "Has (gr)" })));
  if (!days.length) { wrap.append(h("div", { class: "empty", text: "Bu aralıkta işlem yok." })); return wrap; }
  wrap.append(lineChart(filled, {
    series: tlMode ? [{ key: "satis_tl", kind: "satis" }, { key: "alis_tl", kind: "alis" }, { key: "kar_tl", kind: "kar" }]
      : [{ key: "satis_has", kind: "satis" }, { key: "alis_has", kind: "alis" }, { key: "milyem_kari_has", kind: "kar", label: "Milyem kârı" }],
    fmt, short: tlMode ? vizCompact : (v) => formatTurkishNumber(v, 0, 1), label: "Satış, alış ve kâr grafiği",
  }));
  return wrap;
};

/* Dashboard alt bölümü: dönemden bağımsız genel durum başlığı. */
const renderDashboardBase = renderDashboard;
renderDashboard = function (data) {
  const root = renderDashboardBase(data);
  const hero = root.querySelector(".dashboard-hero");
  if (hero) hero.before(h("div", { class: "dash-section-head" }, h("h2", { text: "Genel durum" }), h("p", { text: "Tüm kayıtlara göre stok, cari, gider ve TL özeti" })));
  root.querySelectorAll(".dashboard-groups-bottom .dashboard-panel h2").forEach((t) => { if (t.textContent === "Uyarılar") t.textContent = "Stok kontrolü"; });
  return root;
};
