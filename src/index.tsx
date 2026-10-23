/**
 * Dünyatek Kuyumcu Portalı - ana uygulama girişi
 *
 * Mimari (DunyaOne ile aynı):
 *   /api/*     -> Hono API (Cloudflare D1)
 *   /static/*  -> public/static altındaki dosyalar (Pages doğrudan sunar)
 *   /, /login  -> uygulama ve giriş sayfaları
 *   /pano      -> dükkândaki TV için fiyat panosu
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './lib/db';
import { COOKIE_NAME, getSessionUser, purgeExpiredSessions } from './lib/auth';
import { ensureDailyBackup } from './lib/backup';
import { upgradeNames } from './lib/names';
import { HttpError, today } from './lib/validate';
import authApi, { logout } from './api/auth';
import kuyumcuApi from './api/kuyumcu';
import fiyatApi from './api/fiyat';
import kasaApi from './api/kasa';
import emanetApi from './api/emanet';
import siparisApi from './api/siparis';
import etiketApi from './api/etiket';
import raporApi from './api/rapor';
import metalApi from './api/metal';
import dovizApi from './api/doviz';
import atolyeApi from './api/atolye';
import panoApi from './api/pano';
import { cariKart as cariKartApi, uyarilar as uyarilarApi } from './api/takip';
import firmaApi from './api/firma';
import indexPage from './pages/index.html?raw';
import loginPage from './pages/login.html?raw';
import panoPage from './pages/pano.html?raw';

const app = new Hono<Env>();

const fail = (message: string, data: unknown = null) => ({ status: 'error', message, data });

/** Oturum gerektirmeyen API uçları. */
const PUBLIC_PATHS = ['/api/auth/status', '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/session', '/api/health'];

/**
 * Açılış bakımı: süresi geçmiş oturumları temizler, günün ilk isteğinde
 * günlük yedeği alır ve (bir kez) eski kişi adlarını büyük harfe çevirir.
 * Hata olsa bile isteği durdurmaz.
 */
app.use('/api/*', async (c, next) => {
  const g = globalThis as { __kuyumcu_day__?: string };
  const day = today(c.env.APP_TZ || 'Europe/Istanbul');
  if (g.__kuyumcu_day__ !== day) {
    g.__kuyumcu_day__ = day;
    try {
      await purgeExpiredSessions(c.env.DB);
      // Günlük yedek her zaman alınır; "her açılışta" tercihi ayrıca girişte yedek alır.
      await ensureDailyBackup(c.env.DB, day);
      await upgradeNames(c.env.DB);
    } catch (e) {
      console.error('açılış bakımı hatası', e);
      g.__kuyumcu_day__ = undefined;
    }
  }
  await next();
});

/** Kimlik doğrulama: açık uçlar dışında tüm API korunur. */
app.use('/api/*', async (c, next) => {
  const token = getCookie(c, COOKIE_NAME) || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const user = await getSessionUser(c.env.DB, token);
  if (user) c.set('user', user);
  if (PUBLIC_PATHS.includes(c.req.path)) return next();
  if (!user) return c.json(fail('Oturum geçersiz. Lütfen giriş yapın.'), 401);
  return next();
});

/** İzleyici (viewer) rolü yalnızca okuyabilir; kendi parolası ve çıkış hariç. */
const VIEWER_WRITE_PATHS = ['/api/auth/change-password', '/api/auth/logout', '/api/logout'];
app.use('/api/*', async (c, next) => {
  const u = c.get('user');
  if (u?.role === 'viewer' && c.req.method !== 'GET' && !VIEWER_WRITE_PATHS.includes(c.req.path)) {
    return c.json(fail('İzleyici rolü kayıt değiştiremez.'), 403);
  }
  return next();
});

app.get('/api/health', (c) => c.json({ status: 'ok', message: '', data: { time: new Date().toISOString() } }));

/** Arayüzün açılış kontrolü (masaüstü sürümle aynı biçim). */
app.get('/api/session', (c) => {
  const u = c.get('user');
  return c.json({ status: 'ok', message: '', data: { authenticated: !!u, user: u ?? null, today: today(c.env.APP_TZ || 'Europe/Istanbul') } });
});

app.route('/api/auth', authApi);
app.post('/api/logout', logout);
app.route('/api/altin-fiyati', fiyatApi);
app.route('/api/kasa', kasaApi);
app.route('/api/emanet', emanetApi);
app.route('/api/firma', firmaApi);
app.route('/api/siparis', siparisApi);
app.route('/api/etiket', etiketApi);
app.route('/api/rapor', raporApi);
app.route('/api/metal', metalApi);
app.route('/api/doviz', dovizApi);
app.route('/api/atolye', atolyeApi);
app.route('/api/pano', panoApi);
app.route('/api/cari-kart', cariKartApi);
app.route('/api/uyarilar', uyarilarApi);
app.route('/api', kuyumcuApi);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    const kod = (err as HttpError & { kod?: string }).kod;
    return c.json(kod ? { ...fail(err.message), kod } : fail(err.message), err.status as 400);
  }
  const msg = String((err as Error)?.message || err);
  if (msg.includes('UNIQUE constraint failed')) return c.json(fail('Bu kayıt zaten mevcut.'), 409);
  if (msg.includes('NOT NULL constraint failed') || msg.includes('CHECK constraint failed')) return c.json(fail('Zorunlu alanlar eksik veya hatalı.'), 400);
  console.error(err);
  return c.json(fail('Beklenmeyen bir hata oluştu.'), 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json(fail('Böyle bir API ucu yok.'), 404);
  return c.redirect('/');
});

/* ------------------------------------------------------------------ */
/* Sayfalar                                                            */
/* ------------------------------------------------------------------ */

app.get('/', async (c) => {
  const user = await getSessionUser(c.env.DB, getCookie(c, COOKIE_NAME));
  if (!user) return c.redirect('/login');
  return c.html(indexPage);
});

app.get('/login', (c) => c.html(loginPage));

/** Fiyat panosu: dükkândaki TV / ikinci ekran için tam ekran alış-satış fiyatları. */
app.get('/pano', async (c) => {
  const user = await getSessionUser(c.env.DB, getCookie(c, COOKIE_NAME));
  if (!user) return c.redirect('/login');
  return c.html(panoPage);
});

export default app;
