import type { D1Database } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  /** Dükkânın saat dilimi (bugünün tarihi ve günlük satış için). */
  APP_TZ?: string;
  /** İnternet sürümünde ilk yönetici hesabını açmak için gereken anahtar (wrangler secret). */
  SETUP_KEY?: string;
  /** Yalnızca masaüstü (kurulumlu) sürümde: bilgisayardaki yedek klasörü. */
  LOCAL?: LocalHost;
};

/** Masaüstü sunucusunun uygulamaya açtığı dosya işlemleri. */
export type LocalHost = {
  version: string;
  backupDir: string;
  dataDir: string;
  listBackupFiles(): Promise<{ name: string; size: number; modified: string }[]>;
  readBackupFile(name: string): Promise<string>;
  openBackupDir(): void;
};

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: string;
};

export type Env = { Bindings: Bindings; Variables: { user?: SessionUser } };

/** Tek satır getirir. */
export async function first<T = any>(db: D1Database, sql: string, ...args: any[]): Promise<T | null> {
  const r = await db.prepare(sql).bind(...args).first<T>();
  return (r ?? null) as T | null;
}

/** Tüm satırları getirir. */
export async function all<T = any>(db: D1Database, sql: string, ...args: any[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...args).all<T>();
  return (r.results ?? []) as T[];
}

/** Yazma işlemi; meta bilgisi ile döner. */
export async function run(db: D1Database, sql: string, ...args: any[]) {
  return db.prepare(sql).bind(...args).run();
}

export type Stmt = { sql: string; args?: unknown[] };

/**
 * Birden fazla yazma işlemini TEK transaction içinde çalıştırır.
 * D1 batch atomiktir: herhangi biri hata verirse hiçbiri uygulanmaz.
 */
export async function tx(db: D1Database, statements: Stmt[]) {
  if (!statements.length) return [];
  return db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.args ?? []))));
}
