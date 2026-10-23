/**
 * Uygulama içi yedekler. Masaüstü sürümdeki .db dosyası kopyalarının
 * karşılığı: iş tablolarının JSON anlık görüntüsü D1'de saklanır.
 * (Cloudflare D1 ayrıca 30 günlük Time Travel geri dönüşü sunar.)
 */

import type { D1Database } from '@cloudflare/workers-types';
import { all, first, tx, type Stmt } from './db';
import { BUSINESS_TABLES, KASA_TABLES, COLUMNS } from './store';

const ALL_TABLES = [...BUSINESS_TABLES, ...KASA_TABLES];
import { HttpError } from './validate';

const PART_SIZE = 500_000;
const KEEP_DAYS = 14;

type BackupRow = { id: number; reason: string; name: string; size: number; parts: number; created_at: string };

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\..*$/, '');
}

/** Yedeklenen bütün tabloların ham satırları (yedek ve dışa aktarma dosyası bunu taşır). */
export async function snapshotTables(db: D1Database): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {};
  const results = await db.batch(ALL_TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  ALL_TABLES.forEach((t, i) => (tables[t] = results[i].results ?? []));
  return tables;
}

export async function createBackup(db: D1Database, reason: string): Promise<BackupRow> {
  const tables = await snapshotTables(db);
  const now = new Date();
  const payload = JSON.stringify({ version: 1, created_at: now.toISOString(), tables });
  const parts: string[] = [];
  for (let i = 0; i < payload.length; i += PART_SIZE) parts.push(payload.slice(i, i + PART_SIZE));
  const name = `kuyumcu_${reason}_${stamp(now)}`;
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO yedekler (reason, name, size, parts, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      args: [reason, name, payload.length, parts.length, now.toISOString()],
    },
    ...parts.map((part, i) => ({
      sql: `INSERT INTO yedek_parcalari (yedek_id, part, payload) VALUES ((SELECT MAX(id) FROM yedekler), ?, ?)`,
      args: [i, part],
    })),
  ];
  const out = await tx(db, stmts);
  return (out[0].results as BackupRow[])[0];
}

export async function cleanupOldBackups(db: D1Database) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  await tx(db, [
    { sql: `DELETE FROM yedek_parcalari WHERE yedek_id IN (SELECT id FROM yedekler WHERE created_at < ?)`, args: [cutoff] },
    { sql: `DELETE FROM yedekler WHERE created_at < ?`, args: [cutoff] },
  ]);
}

/** Gün içinde ilk istekte günlük yedek alır (masaüstündeki açılış yedeği gibi). */
export async function ensureDailyBackup(db: D1Database, today: string) {
  const name = `daily_${today.replace(/-/g, '')}`;
  const existing = await first(db, `SELECT id FROM yedekler WHERE reason = ?`, name);
  if (existing) return;
  await createBackup(db, name);
  await cleanupOldBackups(db);
}

export async function latestBackup(db: D1Database, excludePreRestore = false): Promise<BackupRow | null> {
  return first<BackupRow>(
    db,
    `SELECT * FROM yedekler ${excludePreRestore ? "WHERE reason != 'pre_restore'" : ''} ORDER BY created_at DESC, id DESC LIMIT 1`
  );
}

export type BackupData = { version?: number; created_at?: string; tables: Record<string, Record<string, unknown>[]> };

export async function listBackups(db: D1Database): Promise<BackupRow[]> {
  return all<BackupRow>(db, `SELECT id, reason, name, size, parts, created_at FROM yedekler ORDER BY created_at DESC, id DESC`);
}

/** Bir yedeğin parçalarını birleştirip içeriğini döndürür. */
export async function loadBackupData(db: D1Database, source: BackupRow): Promise<BackupData> {
  const parts = await all<{ payload: string }>(db, `SELECT payload FROM yedek_parcalari WHERE yedek_id = ? ORDER BY part`, source.id);
  try {
    if (parts.length !== source.parts) throw new Error('eksik parça');
    return checkBackupData(JSON.parse(parts.map((p) => p.payload).join('')));
  } catch {
    throw new HttpError(500, `${source.name} yedeği bozuk; geri yükleme yapılmadı.`);
  }
}

/** Dosyadan gelen veya veritabanındaki yedeğin biçimini doğrular. */
export function checkBackupData(value: unknown): BackupData {
  const data = value as BackupData;
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') throw new HttpError(422, 'Bu dosya bir Dünyatek yedeği değil.');
  for (const t of BUSINESS_TABLES) if (!Array.isArray(data.tables[t])) throw new HttpError(422, `Yedekte ${t} tablosu yok; dosya eksik veya bozuk.`);
  for (const t of [...BUSINESS_TABLES, ...KASA_TABLES]) {
    const rows = data.tables[t];
    if (rows !== undefined && (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))) throw new HttpError(422, `Yedekteki ${t} tablosu bozuk.`);
  }
  return data;
}

/** Yedek içeriğini geri yükler; önce mevcut durumu `pre_restore` olarak yedekler. */
export async function restoreData(db: D1Database, data: BackupData) {
  const safety = await createBackup(db, 'pre_restore');
  // Kasa tabloları yalnızca yedekte varsa geri yüklenir (eski yedeklerde yoktur).
  const kasa = KASA_TABLES.filter((t) => Array.isArray(data.tables?.[t]));
  const tables = [...BUSINESS_TABLES, ...kasa];
  const stmts: Stmt[] = [...kasa].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  // Döviz işlemi olmayan eski yedek: kasa hareketleri geri gelince kasasız döviz kaydı kalmasın.
  if (kasa.includes('kasa_hareketleri') && !kasa.includes('doviz_islemleri')) stmts.unshift({ sql: `DELETE FROM doviz_islemleri` });
  stmts.push(...BUSINESS_TABLES.map((t) => ({ sql: `DELETE FROM ${t}` })));
  for (const t of tables) {
    const cols = COLUMNS[t];
    const rows = data.tables[t];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      stmts.push({
        sql: `INSERT INTO ${t} (${cols.join(', ')}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?)`,
        args: [JSON.stringify(chunk)],
      });
    }
  }
  await tx(db, stmts);
  return { safety_backup: safety.name };
}

/** En son yedeği geri yükler. */
export async function restoreLatest(db: D1Database) {
  const source = await latestBackup(db, true);
  if (!source) throw new HttpError(404, 'Geri yüklenecek yedek bulunamadı.');
  const result = await restoreData(db, await loadBackupData(db, source));
  return { restored_from: source.name, ...result };
}
