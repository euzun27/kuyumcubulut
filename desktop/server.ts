/**
 * Masaüstü (kurulumlu) sürümün sunucusu.
 *
 * Bulut sürümüyle aynı uygulamayı bilgisayarda, internetsiz çalıştırır:
 *   - Veritabanı:  <kurulum>\Veri\kuyumcu.sqlite (node:sqlite, D1 ile aynı şema)
 *   - Yedekler:    C:\DUNYATEK_BACKUP (her yedek ayrıca .json dosyası olarak yazılır)
 *   - Adres:       http://127.0.0.1:47800 (yalnızca bu bilgisayardan erişilir)
 *
 * `--ac` ile başlatılırsa tarayıcıyı da açar. Sunucu zaten çalışıyorsa yalnızca
 * tarayıcıyı açıp çıkar; böylece masaüstü simgesine her tıklamada aynı program açılır.
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/index';
import type { Bindings, LocalHost } from '../src/lib/db';
import { loadBackupData } from '../src/lib/backup';
import { startHaremStream } from '../src/lib/harem';
import { audit, setUserPassword } from '../src/lib/auth';
import { HttpError, today } from '../src/lib/validate';
import { anahtarCoz, durumHesapla, makineKodu, parolaKoduCoz, yazmaSerbest } from './lisans';
import { SqliteD1 } from './sqlite-d1';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'geliştirme';

const isWindows = process.platform === 'win32';
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = resolve(APP_DIR, '..');
const DATA_DIR = process.env.DUNYATEK_VERI || join(INSTALL_DIR, 'Veri');
const BACKUP_DIR = process.env.DUNYATEK_YEDEK || (isWindows ? 'C:\\DUNYATEK_BACKUP' : join(INSTALL_DIR, 'DUNYATEK_BACKUP'));
const PORT = Number(process.env.DUNYATEK_PORT || 47800);
const HOST = '127.0.0.1';
const URL_ = `http://localhost:${PORT}/`;
const LOG_FILE = join(DATA_DIR, 'sunucu.log');

mkdirSync(DATA_DIR, { recursive: true });
process.chdir(APP_DIR);

function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`;
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 5 * 1024 * 1024) renameSync(LOG_FILE, `${LOG_FILE}.1`);
    appendFileSync(LOG_FILE, line);
  } catch {
    /* günlük yazılamazsa sunucu yine çalışır */
  }
  if (process.stdout.isTTY) process.stdout.write(line);
}

/** Varsayılan tarayıcıyı açar; Windows'ta Edge varsa ayrı program penceresi olarak. */
function openBrowser() {
  if (process.argv.includes('--tarayici-acma')) return;
  if (isWindows) {
    const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((base) => join(base as string, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      .find((p) => existsSync(p));
    const child = edge
      ? spawn(edge, [`--app=${URL_}`, '--start-maximized'], { detached: true, stdio: 'ignore' })
      : spawn('cmd.exe', ['/c', 'start', '""', URL_], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => log('tarayıcı açılamadı', e));
    child.unref();
  } else {
    const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
}

/* Veritabanı */
const d1 = new SqliteD1(join(DATA_DIR, 'kuyumcu.sqlite'));
// Güncelleme veritabanı yapısını değiştirecekse önce o anki dosyanın kopyası yedek klasörüne alınır.
const pending = d1.pendingMigrations(join(APP_DIR, 'migrations'));
if (pending.length) {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const copy = join(BACKUP_DIR, `guncelleme_oncesi_${VERSION}_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    d1.copyTo(copy);
    log('güncelleme öncesi veritabanı kopyası:', copy);
  } catch (e) {
    log('güncelleme öncesi kopya alınamadı:', String(e));
  }
}
const applied = d1.migrateTracked(join(APP_DIR, 'migrations'));
if (applied.length) log('veritabanı güncellendi:', applied.join(', '));

/* Yedek klasörü */
const safeName = (name: string) => {
  const base = basename(name);
  if (base !== name || !/^[\w.\- ()]+\.json$/i.test(base)) throw new HttpError(400, 'Geçersiz dosya adı.');
  return join(BACKUP_DIR, base);
};

const local: LocalHost = {
  version: VERSION,
  backupDir: BACKUP_DIR,
  dataDir: DATA_DIR,
  async listBackupFiles() {
    if (!existsSync(BACKUP_DIR)) return [];
    return readdirSync(BACKUP_DIR)
      .filter((f) => /\.json$/i.test(f))
      .map((name) => {
        const st = statSync(join(BACKUP_DIR, name));
        return { name, size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  },
  async readBackupFile(name) {
    const path = safeName(name);
    if (!existsSync(path)) throw new HttpError(404, `${name} bulunamadı.`);
    return readFileSync(path, 'utf8');
  },
  openBackupDir() {
    mkdirSync(BACKUP_DIR, { recursive: true });
    if (isWindows) spawn('explorer.exe', [BACKUP_DIR], { detached: true, stdio: 'ignore' }).unref();
  },
};

/**
 * Programın içindeki yeni yedekleri klasöre .json olarak yazar. Her API
 * isteğinden sonra çalışır; yalnızca henüz yazılmamış yedekleri yazar.
 */
let mirroredUpTo = 0;
async function mirrorBackups() {
  const rows = (await d1.prepare(`SELECT * FROM yedekler WHERE id > ? ORDER BY id`).bind(mirroredUpTo).all()).results as any[];
  if (!rows.length) return;
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const row of rows) {
    const path = join(BACKUP_DIR, `${row.name}.json`);
    if (!existsSync(path)) {
      const data = await loadBackupData(d1 as any, row);
      const file = { app: 'dunyatek-kuyumcu', name: row.name, reason: row.reason, ...data, created_at: row.created_at };
      writeFileSync(`${path}.tmp`, JSON.stringify(file));
      renameSync(`${path}.tmp`, path);
    }
    mirroredUpTo = row.id;
  }
  pruneBackupFolder();
}

/**
 * Klasör sınırsız büyümesin: 90 günden eski yedek dosyalarını siler, ama en
 * yeni 30 dosyaya hiç dokunmaz. Yalnızca programın yazdığı kuyumcu_*.json silinir.
 */
let prunedDay = '';
function pruneBackupFolder() {
  const day = new Date().toISOString().slice(0, 10);
  if (prunedDay === day) return;
  prunedDay = day;
  const cutoff = Date.now() - 90 * 86400000;
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => /^kuyumcu_.*\.json$/i.test(f))
    .map((f) => ({ path: join(BACKUP_DIR, f), time: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const f of files.slice(30)) if (f.time < cutoff) unlinkSync(f.path);
}

/* Lisans */
function machineId() {
  if (process.env.DUNYATEK_MAKINE) return process.env.DUNYATEK_MAKINE;
  try {
    if (isWindows) {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      if (m) return m[1];
    } else if (existsSync('/etc/machine-id')) {
      return readFileSync('/etc/machine-id', 'utf8');
    }
  } catch (e) {
    log('makine kimliği okunamadı', e);
  }
  return hostname();
}
const MAKINE = makineKodu(machineId());

/** Deneme başlangıcı veritabanının dışında da tutulur; Veri klasörü silinince deneme yeniden başlamaz. */
const DENEME_DOSYASI = isWindows ? join(process.env.ProgramData || 'C:\\ProgramData', 'Dunyatek', 'kuyumcu-deneme.dat') : join(DATA_DIR, '..', '.dunyatek-deneme');

const meta = async (key: string) => ((await d1.prepare(`SELECT value FROM app_meta WHERE key = ?`).bind(key).first()) as { value: string } | null)?.value ?? null;
const setMeta = (key: string, value: string) => d1.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`).bind(key, value).run();

async function lisansDurumu() {
  const gercekBugun = today('Europe/Istanbul');
  let baslangic = await meta('deneme_baslangic');
  try {
    const dosya = existsSync(DENEME_DOSYASI) ? readFileSync(DENEME_DOSYASI, 'utf8').trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dosya) && (!baslangic || dosya < baslangic)) baslangic = dosya;
    if (!baslangic) baslangic = gercekBugun;
    if (dosya !== baslangic) {
      mkdirSync(dirname(DENEME_DOSYASI), { recursive: true });
      writeFileSync(DENEME_DOSYASI, baslangic);
    }
  } catch (e) {
    log('deneme kaydı yazılamadı', e);
    baslangic ||= gercekBugun;
  }
  if ((await meta('deneme_baslangic')) !== baslangic) await setMeta('deneme_baslangic', baslangic);
  // Saat geri alınarak süre uzatılamasın: görülen en ileri tarih kullanılır.
  const son = await meta('lisans_son_gorulme');
  const bugun = son && son > gercekBugun ? son : gercekBugun;
  if (bugun !== son) await setMeta('lisans_son_gorulme', bugun);
  return durumHesapla({ makine: MAKINE, anahtar: await meta('lisans_anahtari'), denemeBaslangic: baslangic, bugun });
}

const env: Bindings = { DB: d1 as any, APP_TZ: 'Europe/Istanbul', LOCAL: local };

/* HTTP */
const server = new Hono();
// Güncellemeden sonra Edge eski app.js / styles.css'i önbellekten göstermesin: her açılışta yeniden sorulur.
server.use('*', async (c, next) => {
  await next();
  if (!c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-cache');
});
server.get('/static/*', serveStatic({ root: './' }));
server.get('/api/lisans', async (c) => c.json({ status: 'ok', message: '', data: await lisansDurumu() }));
server.post('/api/lisans', async (c) => {
  const { anahtar } = (await c.req.json().catch(() => ({}))) as { anahtar?: string };
  try {
    anahtarCoz(String(anahtar ?? ''), MAKINE);
  } catch (e) {
    return c.json({ status: 'error', message: (e as Error).message, data: null }, 422);
  }
  await setMeta('lisans_anahtari', String(anahtar).replace(/\s+/g, ''));
  const durum = await lisansDurumu();
  log('lisans girildi:', durum.mesaj);
  return c.json({ status: 'ok', message: durum.mesaj, data: durum });
});
/*
 * Parolamı unuttum: ekran makine kodu ve tek kullanımlık bir istek kodu gösterir.
 * Dünyatek bu iki koddan lisans üreticide imzalı bir sıfırlama kodu üretir;
 * kod girilince yazılan kullanıcının parolası yenilenir ve istek kodu değişir.
 */
const ISTEK_SURE_MS = 24 * 60 * 60 * 1000;
async function parolaIstegi(yeni = false) {
  let istek: { kod: string; at: number } | null = null;
  try { istek = JSON.parse((await meta('parola_istek')) ?? 'null'); } catch { /* yeniden üretilir */ }
  if (yeni || !istek || Date.now() - istek.at > ISTEK_SURE_MS) {
    const hex = randomBytes(4).toString('hex').toUpperCase();
    istek = { kod: `${hex.slice(0, 4)}-${hex.slice(4)}`, at: Date.now() };
    await setMeta('parola_istek', JSON.stringify(istek));
  }
  return istek;
}
server.get('/api/parola-sifirla', async (c) => c.json({ status: 'ok', message: '', data: { makine_kodu: MAKINE, istek_kodu: (await parolaIstegi()).kod } }));
server.post('/api/parola-sifirla', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { kod?: string; email?: string; yeni_parola?: string };
  const hata = (message: string) => c.json({ status: 'error', message, data: null }, 422);
  const email = String(b.email ?? '').trim().toLowerCase();
  const parola = typeof b.yeni_parola === 'string' ? b.yeni_parola : '';
  if (!email) return hata('Parolası yenilenecek kullanıcının e-postasını yazın.');
  if (parola.length < 8) return hata('Yeni parola en az 8 karakter olmalıdır.');
  const istek = await parolaIstegi();
  try {
    parolaKoduCoz(String(b.kod ?? ''), MAKINE, istek.kod);
  } catch (e) {
    return hata((e as Error).message);
  }
  const user = (await d1.prepare(`SELECT id, name, email FROM users WHERE lower(email) = ?`).bind(email).first()) as { id: number; name: string; email: string } | null;
  if (!user) return hata('Bu e-postayla kayıtlı kullanıcı yok.');
  await setUserPassword(d1 as any, user.id, parola);
  await parolaIstegi(true);
  await audit(d1 as any, { userId: user.id, userName: user.name, action: 'update', entityType: 'users', entityId: user.id, description: 'Parola destek koduyla sıfırlandı' });
  log('parola sıfırlandı:', user.email);
  return c.json({ status: 'ok', message: 'Parola yenilendi. Yeni parolanızla giriş yapabilirsiniz.', data: null });
});
server.all('*', async (c) => {
  if (c.req.path.startsWith('/api/') && !yazmaSerbest(c.req.method, c.req.path)) {
    const durum = await lisansDurumu();
    if (durum.durum === 'bitti') return c.json({ status: 'error', message: durum.mesaj, data: { lisans: durum } }, 403);
  }
  const res = await app.fetch(c.req.raw, env);
  if (c.req.path.startsWith('/api/')) {
    try {
      await mirrorBackups();
    } catch (e) {
      log('yedek klasörüne yazılamadı', e);
    }
  }
  return res;
});

/** Aynı adreste zaten bu program çalışıyor mu? */
async function alreadyRunning() {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

const http = serve({ fetch: server.fetch, port: PORT, hostname: HOST }, () => {
  log(`Dünyatek Kuyumcu Portalı ${VERSION} çalışıyor: ${URL_} · veri: ${DATA_DIR} · yedek: ${BACKUP_DIR} · makine kodu: ${MAKINE}`);
  lisansDurumu().then((d) => log('lisans:', d.mesaj)).catch((e) => log('lisans okunamadı', e));
  // Harem Altın canlı fiyat akışı; kesilirse fiyat Truncgil'den okunur.
  startHaremStream(log);
  mirrorBackups().catch((e) => log('yedek klasörüne yazılamadı', e));
  if (process.argv.includes('--ac')) openBrowser();
});

http.on('error', async (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && (await alreadyRunning())) {
    if (process.argv.includes('--ac')) openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  log('sunucu başlatılamadı', e);
  process.exit(1);
});

process.on('uncaughtException', (e) => log('beklenmeyen hata', e));
process.on('unhandledRejection', (e) => log('beklenmeyen hata', e));
