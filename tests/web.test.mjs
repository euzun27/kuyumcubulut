// İnternet sürümüne özgü güvenlik: kurulum anahtarı ve hatalı giriş sınırı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, TestD1 } from './.build/harness.mjs';

function client(base, extra = {}) {
  globalThis.__kuyumcu_day__ = undefined;
  const env = { DB: new TestD1().migrate('migrations'), APP_TZ: 'Europe/Istanbul', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await app.fetch(
      new Request(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { env, call };
}

const admin = { name: 'Yönetici', email: 'a@d.com', password: 'gizli-parola' };

test('HTTPS üzerinde kurulum anahtarı yoksa ilk kayıt kapalı', async () => {
  const c = client('https://kuyumcu.dunyatek.com');
  const r = await c.call('POST', '/api/auth/register', admin);
  assert.equal(r.status, 403);
  assert.equal((await c.call('GET', '/api/auth/status')).body.data.needs_setup, true);
});

test('ilk kayıt doğru kurulum anahtarıyla açılır', async () => {
  const c = client('https://kuyumcu.dunyatek.com', { SETUP_KEY: 'dunyatek-kurulum-123' });
  assert.equal((await c.call('GET', '/api/auth/status')).body.data.setup_key, true);
  assert.equal((await c.call('POST', '/api/auth/register', admin)).status, 403);
  assert.equal((await c.call('POST', '/api/auth/register', { ...admin, setup_key: 'yanlis' })).status, 403);
  const ok = await c.call('POST', '/api/auth/register', { ...admin, setup_key: 'dunyatek-kurulum-123' });
  assert.equal(ok.status, 201);
  assert.match(ok.headers.get('set-cookie'), /Secure/);
});

test('aynı e-postaya 5 hatalı girişten sonra giriş geçici olarak kapanır', async () => {
  const c = client('http://localhost');
  await c.call('POST', '/api/auth/register', admin);
  await c.call('POST', '/api/logout');
  for (let i = 0; i < 5; i++) {
    assert.equal((await c.call('POST', '/api/auth/login', { email: admin.email, password: 'yanlis-parola' })).status, 401);
  }
  const blocked = await c.call('POST', '/api/auth/login', { email: admin.email, password: admin.password });
  assert.equal(blocked.status, 429);
  // Başka bir e-posta etkilenmez.
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'baska@d.com', password: 'yanlis-parola' })).status, 401);
});

test('aynı IP adresinden 20 hatalı girişten sonra giriş kapanır', async () => {
  const c = client('http://localhost');
  await c.call('POST', '/api/auth/register', admin);
  await c.call('POST', '/api/logout');
  const ip = { 'cf-connecting-ip': '203.0.113.7' };
  for (let i = 0; i < 20; i++) await c.call('POST', '/api/auth/login', { email: `x${i}@d.com`, password: 'yanlis-parola' }, ip);
  assert.equal((await c.call('POST', '/api/auth/login', admin, ip)).status, 429);
  assert.equal((await c.call('POST', '/api/auth/login', admin, { 'cf-connecting-ip': '198.51.100.1' })).status, 200);
});
