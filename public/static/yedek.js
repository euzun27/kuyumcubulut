/*
 * Bilgisayardaki yedek klasörü (DUNYATEK_BACKUP) ve yedek yönetimi.
 * Chrome / Edge'de kullanıcı bir kez klasör seçer (ör. Belgeler); içinde
 * DUNYATEK_BACKUP oluşturulur ve her yedek oraya .json dosyası olarak yazılır.
 * Tarayıcı klasörü hatırlar; açılışta izin varsa günün yedeği otomatik yazılır.
 * Klasör desteği olmayan tarayıcılarda yedek dosyası "İndirilenler"e iner.
 * Bilgisayara kurulan sürümde program her yedeği kendisi C:\DUNYATEK_BACKUP
 * klasörüne yazar; tarayıcıdan klasör seçmek gerekmez.
 */

const BACKUP_DIR_NAME = "DUNYATEK_BACKUP";
const fsSupported = typeof window.showDirectoryPicker === "function";
/* Kurulumlu (masaüstü) sürüm mü? */
let desktopEnv = null;
const envReady = api("/api/ortam").then((d) => (desktopEnv = d?.masaustu ? d : null)).catch(() => null);

const htmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/* Klasör tutamacı IndexedDB'de saklanır (tarayıcı kapanınca da hatırlanır). */
function kvStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("dunyatek", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const t = open.result.transaction("kv", mode);
      const req = fn(t.objectStore("kv"));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    };
  });
}
const loadDirHandle = () => kvStore("readonly", (s) => s.get("backupDir")).catch(() => null);
const saveDirHandle = (handle) => kvStore("readwrite", (s) => s.put(handle, "backupDir"));
const forgetDirHandle = () => kvStore("readwrite", (s) => s.delete("backupDir"));

async function dirPermission(handle, ask = false) {
  if (!handle) return "none";
  try {
    let state = await handle.queryPermission({ mode: "readwrite" });
    if (state !== "granted" && ask) state = await handle.requestPermission({ mode: "readwrite" });
    return state;
  } catch { return "denied"; }
}

/** Kullanıcıya klasör seçtirir; seçilen yerin içinde DUNYATEK_BACKUP açar. */
async function chooseBackupFolder() {
  const picked = await window.showDirectoryPicker({ id: "dunyatek-yedek", mode: "readwrite", startIn: "documents" });
  const dir = picked.name.toUpperCase() === BACKUP_DIR_NAME ? picked : await picked.getDirectoryHandle(BACKUP_DIR_NAME, { create: true });
  await saveDirHandle(dir);
  return { dir, parent: picked.name.toUpperCase() === BACKUP_DIR_NAME ? null : picked.name };
}

const backupFileName = (data) => `${data.name || "kuyumcu_yedek"}.json`;

async function writeBackupToFolder(dir, data) {
  const file = await dir.getFileHandle(backupFileName(data), { create: true });
  const w = await file.createWritable();
  await w.write(JSON.stringify(data));
  await w.close();
  return backupFileName(data);
}

function downloadBackupFile(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = h("a", { href: url, download: backupFileName(data) });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function folderFiles(dir) {
  const out = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== "file" || !/\.json$/i.test(entry.name)) continue;
    const f = await entry.getFile();
    out.push({ name: entry.name, size: f.size, date: f.lastModified, file: f });
  }
  return out.sort((a, b) => b.date - a.date);
}

/** Sunucudaki en son yedeği klasöre yazar (zaten varsa yazmaz). */
async function syncLatestToFolder(dir, { force = false } = {}) {
  const data = await api("/api/yedekler/son");
  if (!force) {
    try { await dir.getFileHandle(backupFileName(data)); return null; } catch { /* yok, yazılacak */ }
  }
  return writeBackupToFolder(dir, data);
}

async function restoreFromBackupFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("Dosya okunamadı; geçerli bir yedek dosyası seçin."); }
  if (data?.exported_at && !data?.tables) throw new Error("Bu dosya programın eski sürümüyle dışa aktarılmış; geri yüklenecek bilgileri içermiyor. Eski bilgisayarda programı güncelleyip \"Tüm verileri dışa aktar\" ile dosyayı yeniden alın (ya da Yedekler penceresinden yedeği indirin).");
  if (data?.app !== "dunyatek-kuyumcu" && !data?.tables) throw new Error("Bu dosya bir Dünyatek yedeği değil.");
  const when = data.created_at ? new Date(data.created_at).toLocaleString("tr-TR") : "tarihi bilinmiyor";
  if (!(await showConfirm(`<b>${htmlEsc(file.name)}</b> (${htmlEsc(when)}) geri yüklenecek. Şu anki veriler önce ayrıca yedeklenecek. Devam edilsin mi`, "Geri yükle", "İptal"))) return false;
  const result = await api("/api/yedek-dosyadan", { method: "POST", body: JSON.stringify({ ...data, name: file.name }) });
  showMessage(`Geri yüklendi: ${result.restored_from}`);
  await afterRestore();
  return true;
}

async function afterRestore() {
  await Promise.all([refreshSuggestions(), loadKasaAccounts()]).catch(() => {});
  render();
}

/* "Yedek al": sunucuda yedek alır, klasör bağlıysa oraya da yazar. */
createDatabaseBackup = async function () {
  try {
    const result = await api("/api/backup", { method: "POST" });
    if (await envReady) { showMessage(`Yedek alındı ve kaydedildi: ${desktopEnv.yedek_klasoru}\\${result.file}.json`); return; }
    const dir = await loadDirHandle();
    if (dir && (await dirPermission(dir, true)) === "granted") {
      const name = await writeBackupToFolder(dir, await api(`/api/yedekler/${result.id}`));
      showMessage(`Yedek alındı ve bilgisayara kaydedildi: ${BACKUP_DIR_NAME}\\${name}`);
    } else {
      showMessage(`Yedek alındı: ${result.file}. Bilgisayara da kaydetmek için Yedekler penceresinden klasör seçin.`);
    }
    updateBackupPill();
  } catch (error) {
    showMessage(error.message || "Yedek oluşturulamadı.", true);
  }
};

const REASON_LABEL = { manual: "Elle alınan", startup: "Girişte", pre_restore: "Geri yükleme öncesi", pre_reset: "Sıfırlama öncesi" };
const reasonText = (r) => REASON_LABEL[r] || (String(r).startsWith("daily_") ? "Günlük otomatik" : r);
const sizeText = (n) => n >= 1048576 ? `${formatTurkishNumber(n / 1048576, 0, 1)} MB` : `${formatTurkishNumber(Math.max(1, n / 1024), 0, 0)} KB`;

/* Yedekler penceresi */
async function openBackups() {
  const { box, close } = openModal("Yedekler", "kasa-modal backups-modal");
  const admin = currentUser?.role === "admin";
  const body = h("div", { class: "backups-body" });
  box.append(body);
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0]; fileInput.value = "";
    if (!f) return;
    try { if (await restoreFromBackupFile(f)) close(); } catch (error) { showMessage(error.message, true); }
  });
  box.append(fileInput);

  const draw = async () => {
    body.replaceChildren(h("p", { class: "hint", text: "Yükleniyor…" }));
    const desktop = await envReady;
    const [list, dir, localFiles] = await Promise.all([api("/api/yedekler").catch(() => []), fsSupported && !desktop ? loadDirHandle() : null, desktop ? api("/api/yerel-yedekler").catch(() => []) : null]);
    const perm = await dirPermission(dir);

    // 1) Bilgisayardaki klasör
    const local = h("section", { class: "backup-section" }, h("h3", { text: "Bilgisayardaki yedek klasörü" }));
    if (desktop) {
      local.append(h("p", { class: "backup-folder" }, h("b", { text: `📁 ${desktop.yedek_klasoru}` }), ` · ${localFiles.length} yedek dosyası`),
        h("p", { class: "hint", text: "Program her yedeği bu klasöre otomatik yazar. Klasörü ayrıca USB belleğe veya buluta kopyalamanız önerilir." }),
        h("div", { class: "backup-actions" },
          h("button", { type: "button", text: "Şimdi yedek al", onclick: async () => { await createDatabaseBackup(); draw(); } }),
          h("button", { type: "button", class: "secondary", text: "Klasörü aç", onclick: () => api("/api/yerel-yedekler/klasoru-ac", { method: "POST" }).catch((error) => showMessage(error.message, true)) })));
      local.append(fileTable(localFiles.slice(0, 30).map((f) => ({ ad: f.name, tarih: new Date(f.modified), boyut: f.size, restore: async () => {
        if (!(await showConfirm(`<b>${htmlEsc(f.name)}</b> geri yüklenecek. Şu anki veriler önce ayrıca yedeklenecek. Devam edilsin mi`, "Geri yükle", "İptal"))) return;
        try { const r = await api("/api/yerel-yedekler/geri-yukle", { method: "POST", body: JSON.stringify({ name: f.name }) }); showMessage(`Geri yüklendi: ${r.restored_from}`); close(); await afterRestore(); } catch (error) { showMessage(error.message, true); }
      } })), "Klasörde yedek yok."));
      if (localFiles.length > 30) local.append(h("p", { class: "hint", text: `En yeni 30 dosya gösteriliyor (toplam ${localFiles.length}).` }));
    } else if (!fsSupported) {
      local.append(h("p", { class: "hint", text: "Bu tarayıcı klasöre doğrudan yazmayı desteklemiyor (Chrome veya Edge kullanın). Yedek dosyası \"İndirilenler\" klasörüne iner; oradan DUNYATEK_BACKUP klasörüne taşıyabilirsiniz." }));
    } else if (!dir) {
      local.append(h("p", { class: "hint", text: "Bir kez klasör seçin: açılan pencerede \"Belgeler\"i (veya C: içinde istediğiniz yeri) seçip onaylayın. İçinde DUNYATEK_BACKUP klasörü oluşturulur; her yedek oraya da kaydedilir ve oradan geri yüklenebilir." }),
        h("button", { type: "button", text: "Klasör seç", onclick: connect }));
    } else if (perm !== "granted") {
      local.append(h("p", { class: "hint", text: `${dir.name} klasörü seçili, ama tarayıcı bu oturum için izin istiyor.` }),
        h("div", { class: "backup-actions" },
          h("button", { type: "button", text: "İzin ver", onclick: async () => { if ((await dirPermission(dir, true)) === "granted") { await syncLatestToFolder(dir).catch(() => {}); updateBackupPill(); draw(); } } }),
          h("button", { type: "button", class: "secondary", text: "Başka klasör seç", onclick: connect })));
    } else {
      const files = await folderFiles(dir).catch(() => []);
      local.append(h("p", { class: "backup-folder" }, h("b", { text: `📁 ${dir.name}` }), ` · ${files.length} yedek dosyası`),
        h("div", { class: "backup-actions" },
          h("button", { type: "button", text: "Şimdi yedek al", onclick: async () => { await createDatabaseBackup(); draw(); } }),
          h("button", { type: "button", class: "secondary", text: "Klasörü değiştir", onclick: connect }),
          h("button", { type: "button", class: "secondary", text: "Bağlantıyı kaldır", onclick: async () => { await forgetDirHandle(); updateBackupPill(); draw(); } })));
      local.append(fileTable(files.slice(0, 30).map((f) => ({ ad: f.name, tarih: new Date(f.date), boyut: f.size, restore: () => restoreFromBackupFile(f.file).then((done) => done && close()) })), "Klasörde yedek yok."));
      if (files.length > 30) local.append(h("p", { class: "hint", text: `En yeni 30 dosya gösteriliyor (toplam ${files.length}).` }));
    }
    if (admin) local.append(h("button", { type: "button", class: "link-btn", text: "Başka bir yedek dosyasından geri yükle…", onclick: () => fileInput.click() }));

    // 2) Programdaki yedekler
    const server = h("section", { class: "backup-section" }, h("h3", { text: "Programdaki yedekler (son 14 gün)" }),
      h("p", { class: "hint", text: "Her gün ilk açılışta, \"Yedek al\" ile, geri yükleme ve sıfırlamadan önce otomatik alınır." }));
    server.append(fileTable(list.map((y) => ({
      ad: reasonText(y.reason), tarih: new Date(y.created_at), boyut: y.size,
      indir: async () => { try { const data = await api(`/api/yedekler/${y.id}`); const d = desktopEnv ? null : await loadDirHandle(); if (d && (await dirPermission(d, true)) === "granted") { showMessage(`Kaydedildi: ${BACKUP_DIR_NAME}\\${await writeBackupToFolder(d, data)}`); draw(); } else downloadBackupFile(data); } catch (error) { showMessage(error.message, true); } },
      restore: async () => {
        if (!(await showConfirm(`${htmlEsc(new Date(y.created_at).toLocaleString("tr-TR"))} tarihli yedek (${htmlEsc(reasonText(y.reason))}) geri yüklenecek. Şu anki veriler önce ayrıca yedeklenecek. Devam edilsin mi`, "Geri yükle", "İptal"))) return;
        try { const r = await api(`/api/yedekler/${y.id}/geri-yukle`, { method: "POST" }); showMessage(`Geri yüklendi: ${r.restored_from}`); close(); await afterRestore(); } catch (error) { showMessage(error.message, true); }
      },
    })), "Henüz yedek yok."));
    body.replaceChildren(local, server);
  };

  const fileTable = (rows, empty) => {
    if (!rows.length) return h("p", { class: "empty", text: empty });
    return h("div", { class: "backup-list" }, ...rows.map((r) => h("div", { class: "backup-row" },
      h("div", { class: "backup-info" }, h("strong", { text: r.tarih.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) }), h("small", { text: `${r.ad} · ${sizeText(r.boyut)}` })),
      h("div", { class: "backup-row-actions" },
        r.indir ? h("button", { type: "button", class: "secondary", text: fsSupported && !desktopEnv ? "Klasöre kaydet" : "İndir", onclick: r.indir }) : null,
        admin ? h("button", { type: "button", class: "secondary", text: "Geri yükle", onclick: r.restore }) : null))));
  };

  async function connect() {
    try {
      const { dir, parent } = await chooseBackupFolder();
      const written = await syncLatestToFolder(dir, { force: true }).catch(() => null);
      showMessage(`Yedek klasörü bağlandı: ${parent ? `${parent}\\` : ""}${dir.name}${written ? ` · ilk yedek yazıldı` : ""}`);
      updateBackupPill();
    } catch (error) {
      if (error?.name !== "AbortError") showMessage(error.message || "Klasör seçilemedi.", true);
    }
    draw();
  }
  draw();
}

/* Üst çubukta: klasör izni gerekiyorsa küçük uyarı düğmesi. */
async function updateBackupPill() {
  if (await envReady) return;
  let pill = document.querySelector("#backupPill");
  const dir = fsSupported ? await loadDirHandle() : null;
  const perm = await dirPermission(dir);
  if (!dir || perm === "granted") { pill?.remove(); return; }
  if (!pill) {
    pill = h("button", { id: "backupPill", type: "button", class: "backup-pill", title: "Bilgisayardaki yedek klasörüne yazmak için izin verin", text: "Yedek klasörü: izin ver",
      onclick: async () => {
        const d = await loadDirHandle();
        if ((await dirPermission(d, true)) === "granted") {
          try { const n = await syncLatestToFolder(d); showMessage(n ? `Günün yedeği kaydedildi: ${BACKUP_DIR_NAME}\\${n}` : "Yedek klasörü güncel."); } catch (error) { showMessage(error.message, true); }
        }
        updateBackupPill();
      } });
    document.querySelector("#dataMenu")?.before(pill);
  }
}

/* Açılışta: klasör bağlı ve izin varsa günün yedeğini sessizce yazar. */
async function autoFolderBackup() {
  if (!fsSupported || (await envReady)) return;
  const dir = await loadDirHandle();
  if (!dir) return;
  if ((await dirPermission(dir)) === "granted") {
    try { await syncLatestToFolder(dir); } catch (error) { console.warn("Klasöre yedek yazılamadı", error); }
  }
  updateBackupPill();
}

setTimeout(() => { autoFolderBackup().catch(() => {}); }, 2500);
