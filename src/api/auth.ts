/**
 * Kimlik doğrulama API'si (DunyaOne ile aynı yapı).
 * İlk kurulumda sistemde hiç kullanıcı yoksa kayıt açıktır ve ilk kullanıcı
 * yönetici olur; sonrasında kullanıcıları yönetici ekler.
 */

import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../lib/db';
import { first, run } from '../lib/db';
import {
  COOKIE_NAME,
  audit,
  cookieOptions,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  setUserPassword,
  verifyPassword,
} from '../lib/auth';
import { HttpError, ValidationError } from '../lib/validate';
import { cleanupOldBackups, createBackup } from '../lib/backup';

const auth = new Hono<Env>();

const ROLES = ['admin', 'staff', 'viewer'];

function ok(data: unknown = null, message = '') {
  return { status: 'ok', message, data };
}

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => ({}));
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(b: Record<string, unknown>, key: string, label: string): string {
  const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
  if (!v) throw new ValidationError(`${label} zorunludur.`);
  return v;
}

function password(b: Record<string, unknown>, key: string, label: string): string {
  const v = typeof b[key] === 'string' ? (b[key] as string) : '';
  if (!v) throw new ValidationError(`${label} zorunludur.`);
  if (v.length < 8) throw new ValidationError('Parola en az 8 karakter olmalıdır.');
  return v;
}

function email(b: Record<string, unknown>): string {
  const v = str(b, 'email', 'E-posta').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError('Geçerli bir e-posta girin.');
  return v;
}

const ip = (c: Context<Env>) => c.req.header('cf-connecting-ip') ?? null;
const isHttps = (c: Context<Env>) => c.req.url.startsWith('https://');

function requireAdmin(c: Context<Env>) {
  const u = c.get('user');
  if (u?.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir.');
  return u;
}

async function userCount(c: Context<Env>) {
  return (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM users`))?.n ?? 0;
}

/** GET /api/auth/status: giriş ekranı için (herkese açık). */
auth.get('/status', async (c) => {
  const user = await getSessionUser(c.env.DB, getCookie(c, COOKIE_NAME));
  return c.json(ok({ needs_setup: (await userCount(c)) === 0, setup_key: !!c.env.SETUP_KEY, user }));
});

/** Son 15 dakikada aynı e-postaya 5, aynı adresten (IP) 20 hatalı girişten sonra giriş geçici olarak kapanır. */
const LOGIN_WINDOW = '-15 minutes';
const LOGIN_MAX_PER_EMAIL = 5;
const LOGIN_MAX_PER_IP = 20;

async function checkLoginLimit(c: Context<Env>, mail: string) {
  const db = c.env.DB;
  const since = `datetime('now', '${LOGIN_WINDOW}')`;
  const byMail = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'login_failed' AND description = ? AND created_at >= ${since}`, `Başarısız giriş: ${mail}`);
  const addr = ip(c);
  const byIp = addr ? await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'login_failed' AND ip = ? AND created_at >= ${since}`, addr) : null;
  if ((byMail?.n ?? 0) >= LOGIN_MAX_PER_EMAIL || (byIp?.n ?? 0) >= LOGIN_MAX_PER_IP) {
    throw new HttpError(429, 'Çok fazla hatalı giriş denemesi. 15 dakika sonra tekrar deneyin.');
  }
}

/**
 * İnternete açık kurulumda ilk yönetici hesabını yalnızca kurulum anahtarını
 * (SETUP_KEY) bilen açabilir; anahtar tanımlı değilse HTTPS üzerinden kayıt kapalıdır.
 */
function checkSetupKey(c: Context<Env>, b: Record<string, unknown>) {
  const expected = c.env.SETUP_KEY;
  if (!expected) {
    if (isHttps(c) && !c.env.LOCAL) throw new HttpError(403, 'Kurulum anahtarı tanımlanmamış. Dünyatek Bilişim ile iletişime geçin.');
    return;
  }
  const given = typeof b.setup_key === 'string' ? b.setup_key.trim() : '';
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) | 0);
  if (diff !== 0) throw new HttpError(403, 'Kurulum anahtarı hatalı.');
}

/** POST /api/auth/login */
auth.post('/login', async (c) => {
  const db = c.env.DB;
  const b = await body(c);
  const mail = str(b, 'email', 'E-posta').toLowerCase();
  const pass = typeof b.password === 'string' ? b.password : '';
  await checkLoginLimit(c, mail);
  const user = await first<any>(db, `SELECT * FROM users WHERE lower(email) = ? AND is_active = 1`, mail);
  // Kullanıcı yoksa da hash doğrulaması yaparak zamanlama farkını azalt.
  const valid = user ? await verifyPassword(pass, user.password_hash) : await verifyPassword(pass, 'pbkdf2$1000$AAAA$BBBB');
  if (!user || !valid) {
    await audit(db, { action: 'login_failed', entityType: 'users', entityId: user?.id ?? null, description: `Başarısız giriş: ${mail}`, ip: ip(c) });
    throw new HttpError(401, 'E-posta veya parola hatalı.');
  }
  const token = await createSession(db, user.id, c.req.header('user-agent'));
  setCookie(c, COOKIE_NAME, token, cookieOptions(isHttps(c)));
  await run(db, `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);
  // "Her açılışta" yedek tercihi bulutta her girişte yedek almak demektir.
  const freq = await first<{ value: string }>(db, `SELECT value FROM app_meta WHERE key = 'backup_frequency'`);
  if (freq?.value === 'startup') {
    try { await createBackup(db, 'startup'); await cleanupOldBackups(db); } catch (e) { console.error('giriş yedeği alınamadı', e); }
  }
  await audit(db, { userId: user.id, userName: user.name, action: 'login', entityType: 'users', entityId: user.id, description: `${user.name} giriş yaptı`, ip: ip(c) });
  return c.json(ok({ id: user.id, name: user.name, email: user.email, role: user.role }));
});

/** POST /api/auth/logout (ve masaüstü uyumluluğu için /api/logout) */
export async function logout(c: Context<Env>) {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const u = await getSessionUser(c.env.DB, token);
    await destroySession(c.env.DB, token);
    if (u) await audit(c.env.DB, { userId: u.id, userName: u.name, action: 'logout', entityType: 'users', entityId: u.id, description: `${u.name} çıkış yaptı`, ip: ip(c) });
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json(ok({ authenticated: false }, 'Çıkış yapıldı.'));
}
auth.post('/logout', logout);

/** POST /api/auth/register: yalnızca hiç kullanıcı yokken açıktır; ilk kullanıcı yönetici olur. */
auth.post('/register', async (c) => {
  const db = c.env.DB;
  if ((await userCount(c)) > 0) throw new HttpError(403, 'Kurulum tamamlanmış. Yeni kullanıcıyı yönetici ekler.');
  const b = await body(c);
  checkSetupKey(c, b);
  const name = str(b, 'name', 'Ad Soyad');
  const mail = email(b);
  const pass = password(b, 'password', 'Parola');
  const row = await first<any>(
    db,
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin') RETURNING id, name, email, role`,
    name,
    mail,
    await hashPassword(pass)
  );
  const token = await createSession(db, row.id, c.req.header('user-agent'));
  setCookie(c, COOKIE_NAME, token, cookieOptions(isHttps(c)));
  await audit(db, { userId: row.id, userName: row.name, action: 'create', entityType: 'users', entityId: row.id, description: 'İlk yönetici oluşturuldu', ip: ip(c) });
  return c.json(ok(row, 'Kurulum tamamlandı.'), 201);
});

/** GET /api/auth/me */
auth.get('/me', (c) => c.json(ok(c.get('user') ?? null)));

/** GET /api/auth/users: kullanıcı listesi (yönetici). */
auth.get('/users', async (c) => {
  requireAdmin(c);
  const rows = await c.env.DB.prepare(`SELECT id, name, email, role, is_active, last_login_at, created_at FROM users ORDER BY id`).all();
  return c.json(ok(rows.results ?? []));
});

/** POST /api/auth/users: yeni kullanıcı (yönetici). */
auth.post('/users', async (c) => {
  const admin = requireAdmin(c);
  const b = await body(c);
  checkSetupKey(c, b);
  const name = str(b, 'name', 'Ad Soyad');
  const mail = email(b);
  const pass = password(b, 'password', 'Parola');
  const role = String(b.role || 'staff').toLowerCase();
  if (!ROLES.includes(role)) throw new ValidationError('Geçersiz rol.');
  if (await first(c.env.DB, `SELECT id FROM users WHERE lower(email) = ?`, mail)) throw new ValidationError('Bu e-posta zaten kayıtlı.');
  const row = await first<any>(
    c.env.DB,
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id, name, email, role, is_active`,
    name,
    mail,
    await hashPassword(pass),
    role
  );
  await audit(c.env.DB, { userId: admin.id, userName: admin.name, action: 'create', entityType: 'users', entityId: row.id, description: `Yeni kullanıcı: ${mail} (${role})`, ip: ip(c) });
  return c.json(ok(row, 'Kullanıcı eklendi.'), 201);
});

/** PUT /api/auth/users/:id: rol veya aktiflik değiştirir (yönetici). */
auth.put('/users/:id', async (c) => {
  const admin = requireAdmin(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  const target = await first<any>(c.env.DB, `SELECT id, role, is_active FROM users WHERE id = ?`, id);
  if (!target) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  const role = b.role === undefined ? target.role : String(b.role).toLowerCase();
  const active = b.is_active === undefined ? target.is_active : b.is_active ? 1 : 0;
  if (!ROLES.includes(role)) throw new ValidationError('Geçersiz rol.');
  if (id === admin.id && (role !== 'admin' || !active)) throw new ValidationError('Kendi yönetici yetkinizi kaldıramazsınız.');
  await run(c.env.DB, `UPDATE users SET role = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`, role, active, id);
  if (!active) await run(c.env.DB, `DELETE FROM sessions WHERE user_id = ?`, id);
  await audit(c.env.DB, { userId: admin.id, userName: admin.name, action: 'update', entityType: 'users', entityId: id, description: `Rol: ${role}, aktif: ${active}`, ip: ip(c) });
  return c.json(ok(null, 'Kullanıcı güncellendi.'));
});

/** POST /api/auth/users/:id/parola {new_password}: yönetici başka bir kullanıcının parolasını yeniler. */
auth.post('/users/:id/parola', async (c) => {
  const admin = requireAdmin(c);
  const id = Number(c.req.param('id'));
  const target = await first<any>(c.env.DB, `SELECT id, email FROM users WHERE id = ?`, id);
  if (!target) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  if (id === admin.id) throw new ValidationError('Kendi parolanızı Parola değiştir bölümünden değiştirin.');
  await setUserPassword(c.env.DB, id, password(await body(c), 'new_password', 'Yeni parola'));
  await audit(c.env.DB, { userId: admin.id, userName: admin.name, action: 'update', entityType: 'users', entityId: id, description: `Parola yenilendi: ${target.email}`, ip: ip(c) });
  return c.json(ok(null, 'Parola yenilendi.'));
});

/** POST /api/auth/change-password */
auth.post('/change-password', async (c) => {
  const u = c.get('user')!;
  const b = await body(c);
  const current = typeof b.current_password === 'string' ? b.current_password : '';
  const next = password(b, 'new_password', 'Yeni parola');
  const row = await first<any>(c.env.DB, `SELECT password_hash FROM users WHERE id = ?`, u.id);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new ValidationError('Mevcut parola hatalı.');
  await run(c.env.DB, `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, await hashPassword(next), u.id);
  await audit(c.env.DB, { userId: u.id, userName: u.name, action: 'update', entityType: 'users', entityId: u.id, description: 'Parola değiştirildi', ip: ip(c) });
  return c.json(ok(null, 'Parola değiştirildi.'));
});

export default auth;
