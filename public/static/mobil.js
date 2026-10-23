/*
 * Telefon ve tablet düzeni: üstte kısa başlık + menü düğmesi, menü yandan açılır;
 * telefonda altta sık kullanılan ekranlar için sabit çubuk. Ekranların kendisi
 * değişmez; buradaki düğmeler mevcut menü düğmelerine tıklar.
 */
(() => {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  const navButtons = () => [...document.querySelectorAll("nav .nav")];

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "menu-toggle";
  toggle.setAttribute("aria-label", "Menüyü aç");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  sidebar.querySelector(".brand")?.append(toggle);

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  document.body.append(backdrop);

  const setOpen = (open) => {
    document.documentElement.style.setProperty("--mobile-head", `${Math.round(sidebar.getBoundingClientRect().bottom)}px`);
    document.body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  };
  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("menu-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  navButtons().forEach((b) => b.addEventListener("click", () => setOpen(false)));

  // Alt çubuk: en sık kullanılan dört ekran + menü.
  const tabs = [
    ["dashboard", "Özet", '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>'],
    ["satis", "Satış", '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'],
    ["alis", "Alış", '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'],
    ["kasa", "Kasa", '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'],
  ];
  const bar = document.createElement("nav");
  bar.className = "bottom-nav";
  bar.setAttribute("aria-label", "Hızlı geçiş");
  const icon = (paths) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  for (const [view, label, paths] of tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.target = view;
    b.innerHTML = `${icon(paths)}<span>${label}</span>`;
    b.addEventListener("click", () => document.querySelector(`nav .nav[data-view="${view}"]`)?.click());
    bar.append(b);
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "bottom-more";
  more.innerHTML = `${icon('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>')}<span>Menü</span>`;
  more.addEventListener("click", () => setOpen(!document.body.classList.contains("menu-open")));
  bar.append(more);
  document.body.append(bar);

  // Etkin ekranı alt çubukta da işaretle.
  const sync = () => {
    const active = document.querySelector("nav .nav.active")?.dataset.view;
    let found = false;
    bar.querySelectorAll("button[data-target]").forEach((b) => {
      const on = b.dataset.target === active;
      found ||= on;
      b.classList.toggle("active", on);
    });
    more.classList.toggle("active", !found);
  };
  const observer = new MutationObserver(sync);
  navButtons().forEach((b) => observer.observe(b, { attributes: true, attributeFilter: ["class"] }));
  sync();
})();
