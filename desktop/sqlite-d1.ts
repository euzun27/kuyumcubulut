/**
 * Cloudflare D1 benzeri bağlantı (Node 22+ node:sqlite üzerinde). Testler bellek içi,
 * masaüstü sürümü dosya üzerinde kullanır. Yalnızca uygulamanın kullandığı kısım:
 * prepare/bind/first/all/run, batch, exec.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Value = string | number | bigint | null | Uint8Array;

function toValue(v: unknown): Value {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined bağlanamaz');
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as Value;
}

class Statement {
  constructor(private db: DatabaseSync, readonly sql: string, private args: Value[] = []) {}

  bind(...args: unknown[]) {
    return new Statement(this.db, this.sql, args.map(toValue));
  }

  private exec() {
    const stmt = this.db.prepare(this.sql);
    if (stmt.columns().length) return { rows: stmt.all(...this.args) as Record<string, unknown>[], changes: 0, lastRowId: 0 };
    const r = stmt.run(...this.args);
    return { rows: [], changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
  }

  result() {
    const r = this.exec();
    return { results: r.rows.map((row) => ({ ...row })), success: true, meta: { changes: r.changes, last_row_id: r.lastRowId } };
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.exec().rows[0];
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all() {
    return this.result();
  }

  async run() {
    return this.result();
  }
}

export class SqliteD1 {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000');
  }

  migrate(dir: string) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(dir, file), 'utf8'));
    return this;
  }

  /** Uygulanmamış migration dosyaları; veritabanı yeniyse (hiç migration yoksa) boş döner. */
  pendingMigrations(dir: string): string[] {
    const has = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'`).get();
    if (!has) return [];
    const done = new Set((this.db.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map((r) => r.name));
    return done.size ? readdirSync(dir).filter((f) => f.endsWith('.sql') && !done.has(f)).sort() : [];
  }

  /** Veritabanının tutarlı bir kopyasını yazar (VACUUM INTO). */
  copyTo(file: string) {
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  /**
   * Henüz uygulanmamış migration'ları sırayla uygular ve wrangler'ın
   * `d1_migrations` tablosuna yazar; kalıcı veritabanı için.
   */
  migrateTracked(dir: string) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
    const done = new Set((this.db.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map((r) => r.name));
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(readFileSync(join(dir, file), 'utf8'));
        this.db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      applied.push(file);
    }
    return applied;
  }

  prepare(sql: string) {
    return new Statement(this.db, sql);
  }

  async batch(statements: Statement[]) {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => s.result());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}
