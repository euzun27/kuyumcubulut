/**
 * Kimlik doğrulama ve oturum yönetimi (DunyaOne ile aynı yapı)
 *
 * Parolalar PBKDF2-SHA256 (Web Crypto) ile hashlenir. Cloudflare Workers
 * ortaminda Node.js crypto modulu yoktur; Web Crypto API kullanilir.
 * Oturum tokeni HttpOnly cookie olarak tutulur, kaydi D1'de saklanir.
 */

import { first, run } from './db';
import type { D1Database } from '@cloudflare/workers-types';

const ITERATIONS = 100000;
const KEY_LEN = 32;

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_LEN * 8
  );
  return b64(bits);
}

/** Yeni parola hash'i uretir: pbkdf2$iter$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt);
  return `pbkdf2$${ITERATIONS}$${b64(salt.buffer as ArrayBuffer)}$${h}`;
}

/** Parolayi dogrular (zamanlama saldirisina karsi sabit sureli karsilastirma). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, iterStr, saltB64, hash] = stored.split('$');
    if (algo !== 'pbkdf2') return false;
    const salt = fromB64(saltB64);
    const calc = await pbkdf2(password, salt, parseInt(iterStr, 10) || ITERATIONS);
    if (calc.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

/** Rastgele token uretir. */
export function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_DAYS = 30;

/** Oturum olusturur ve token dondurur. */
export async function createSession(db: D1Database, userId: number, userAgent?: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await run(
    db,
    `INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
    token,
    userId,
    expires,
    userAgent || null
  );
  return token;
}

/** Token'a karsilik gelen kullaniciyi getirir. */
export async function getSessionUser(db: D1Database, token: string | undefined | null) {
  if (!token) return null;
  const row = await first<{ id: number; name: string; email: string; role: string; expires_at: string }>(
    db,
    `SELECT u.id, u.name, u.email, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.is_active = 1`,
    token
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await run(db, `DELETE FROM sessions WHERE token = ?`, token);
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export async function destroySession(db: D1Database, token: string) {
  await run(db, `DELETE FROM sessions WHERE token = ?`, token);
}

/** Suresi gecmis oturumlari temizler (lazy cleanup). */
export async function purgeExpiredSessions(db: D1Database) {
  await run(db, `DELETE FROM sessions WHERE expires_at < ?`, new Date().toISOString());
}

export const COOKIE_NAME = 'kuyumcu_session';

/**
 * Cerez secenekleri.
 * DIKKAT: `secure` sadece https uzerinde true olmali; aksi halde
 * yerel gelistirme (http://localhost) sirasinda tarayici cerezi hic
 * gondermez ve giris calismaz gibi gorunur.
 */
export function cookieOptions(isHttps: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: isHttps,
    maxAge: SESSION_DAYS * 86400,
  };
}

export { SESSION_DAYS };

/** Bir kullanıcının parolasını değiştirir, hesabı açar ve açık oturumlarını kapatır. */
export async function setUserPassword(db: D1Database, userId: number, password: string) {
  await run(db, `UPDATE users SET password_hash = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?`, await hashPassword(password), userId);
  await run(db, `DELETE FROM sessions WHERE user_id = ?`, userId);
}

/** Denetim kaydı yazar. Yazılamazsa iş akışını durdurmaz. */
export async function audit(
  db: D1Database,
  opts: {
    userId?: number | null;
    userName?: string | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    description?: string;
    ip?: string | null;
  }
) {
  try {
    await run(
      db,
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, description, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opts.userId ?? null,
      opts.userName ?? null,
      opts.action,
      opts.entityType,
      opts.entityId ?? null,
      opts.description ?? null,
      opts.ip ?? null
    );
  } catch (e) {
    console.error('audit yazılamadı', e);
  }
}
