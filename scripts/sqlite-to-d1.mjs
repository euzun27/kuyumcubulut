// Masaüstü sürümün veritabanını (data/kuyumcu.db) Cloudflare D1'e aktarmak için SQL dosyası üretir.
//   node scripts/sqlite-to-d1.mjs C:\cloude_free\Dunya_altin\data\kuyumcu.db aktarim.sql
//   npx wrangler d1 execute kuyumcu-production --remote --file aktarim.sql
// Eski veritabanı en az bir kez masaüstü programla açılmış olmalıdır (şema v5'e yükseltilir).
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [source, target = 'aktarim.sql'] = process.argv.slice(2);
if (!source) {
  console.error('Kullanım: node scripts/sqlite-to-d1.mjs <kuyumcu.db> [aktarim.sql]');
  process.exit(1);
}

const TABLES = ['alis', 'satis', 'hurda', 'cari_odeme', 'giderler', 'sale_allocations'];
const db = new DatabaseSync(source, { readOnly: true });
const version = db.prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`).get()?.value;
if (String(version) !== '5') {
  console.error(`Şema sürümü ${version ?? 'yok'}; önce eski programı bir kez açıp kapatın.`);
  process.exit(1);
}

const literal = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const lines = ['-- Dünyatek Kuyumcu Portalı veri aktarımı', ...TABLES.map((t) => `DELETE FROM ${t};`)];
for (const table of TABLES) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  for (const row of rows) {
    const cols = Object.keys(row);
    lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
  }
  console.log(`${table}: ${rows.length} kayıt`);
}
writeFileSync(target, lines.join('\n') + '\n', 'utf8');
console.log(`Yazıldı: ${target}`);
