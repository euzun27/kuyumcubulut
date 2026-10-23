(() => {
  const root = document.documentElement;
  const preferenceKey = "dunyatek-theme";
  let theme = "light";
  try { if (localStorage.getItem(preferenceKey) === "dark") theme = "dark"; } catch {}
  root.dataset.theme = theme;

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("#themeToggle");
    if (!toggle) return;
    const update = () => {
      const dark = root.dataset.theme === "dark";
      toggle.setAttribute("aria-pressed", String(dark));
      toggle.setAttribute("aria-label", dark ? "Açık temaya geç" : "Koyu temaya geç");
      toggle.title = dark ? "Açık temaya geç" : "Koyu temaya geç";
    };
    toggle.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(preferenceKey, root.dataset.theme); } catch {}
      update();
    });
    update();
  });
})();
