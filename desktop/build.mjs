// Windows kurulum dosyasını üretir: `npm run kurulum`
//   1. desktop/server.ts -> paket/app/server.mjs (tek dosya)
//   2. public/static ve migrations -> paket/app
//   3. Windows için Node.js (node.exe, SHA-256 doğrulamalı) -> paket/DunyatekSunucu.exe
//   4. NSIS ile başlatıcı (Dunyatek_Kuyumcu_Portal.exe) ve kurulum dosyası
// Gerekenler: Node 22+, NSIS 3 (makensis). Çıktı: desktop/cikti/
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.6';
const NODE_VERSION = 'v24.22.0';
const APP = 'Dunyatek_Kuyumcu_Portal';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desk = join(root, 'desktop');
const cache = join(desk, '.cache');
const paket = join(desk, 'cikti', 'paket');
const out = join(desk, 'cikti');

rmSync(paket, { recursive: true, force: true });
mkdirSync(join(paket, 'app'), { recursive: true });
mkdirSync(cache, { recursive: true });

const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(dirname(a.importer), a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }));
  },
};

console.log('1/4 sunucu paketleniyor');
await build({
  entryPoints: [join(desk, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(paket, 'app', 'server.mjs'),
  external: ['node:*'],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [raw],
  logLevel: 'warning',
});

console.log('2/4 arayüz dosyaları kopyalanıyor');
cpSync(join(root, 'public', 'static'), join(paket, 'app', 'static'), { recursive: true });
cpSync(join(root, 'migrations'), join(paket, 'app', 'migrations'), { recursive: true });
cpSync(join(desk, 'assets', 'dunyatek.ico'), join(paket, 'dunyatek.ico'));

console.log(`3/4 Node.js ${NODE_VERSION} (Windows x64)`);
async function download(url, file) {
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} indirilemedi: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}
const base = `https://nodejs.org/dist/${NODE_VERSION}`;
const sums = (await download(`${base}/SHASUMS256.txt`, join(cache, `SHASUMS256-${NODE_VERSION}.txt`))).toString();
const expected = sums.split('\n').find((l) => l.endsWith(' win-x64/node.exe'))?.split(/\s+/)[0];
const nodeExe = await download(`${base}/win-x64/node.exe`, join(cache, `node-${NODE_VERSION}.exe`));
const actual = createHash('sha256').update(nodeExe).digest('hex');
if (!expected || actual !== expected) {
  rmSync(join(cache, `node-${NODE_VERSION}.exe`), { force: true });
  throw new Error(`node.exe doğrulanamadı (beklenen ${expected}, gelen ${actual})`);
}
writeFileSync(join(paket, 'DunyatekSunucu.exe'), nodeExe);
const license = await download(`https://raw.githubusercontent.com/nodejs/node/${NODE_VERSION}/LICENSE`, join(cache, `LICENSE-${NODE_VERSION}.txt`));
writeFileSync(join(paket, 'NODE-LICENSE.txt'), license);

console.log('4/4 kurulum dosyası derleniyor (NSIS)');
const makensis = [process.env.MAKENSIS, 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].find((p) => p && existsSync(p)) || 'makensis';
const nsis = (script, defines) =>
  execFileSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', ...Object.entries(defines).map(([k, v]) => `-D${k}=${v}`), script], { cwd: desk, stdio: 'inherit' });
nsis('baslat.nsi', { OUT: join(paket, `${APP}.exe`), VERSION });
const setup = join(out, `${APP}_Kurulum_${VERSION}.exe`);
nsis('kurulum.nsi', { OUT: setup, VERSION, PAKET: paket });
console.log(`Hazır: ${setup}`);
