/**
 * Yerel test sunucusu: uygulamayı node:sqlite üzerindeki D1 benzeriyle çalıştırır.
 * Karşılaştırma testleri her senaryo başında POST /__reset ile temiz veritabanı
 * ve hazır bir yönetici oturumu alır.
 */

import { serve } from '@hono/node-server';
import app from '../src/index';
import { SqliteD1 as TestD1 } from '../desktop/sqlite-d1';
import { createSession, hashPassword } from '../src/lib/auth';

const MIGRATIONS = process.env.MIGRATIONS_DIR || 'migrations';
let env = { DB: new TestD1().migrate(MIGRATIONS) as any, APP_TZ: process.env.APP_TZ || 'Europe/Istanbul' };

async function reset() {
  env = { ...env, DB: new TestD1().migrate(MIGRATIONS) as any };
  (globalThis as any).__kuyumcu_day__ = undefined;
  await env.DB.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Test', 'test@example.com', ?, 'admin')`)
    .bind(await hashPassword('test-parola'))
    .run();
  return createSession(env.DB, 1, 'test');
}

const port = Number(process.env.PORT || 8790);
serve({
  port,
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/__reset') return Response.json({ token: await reset() });
    if (path === '/__sql') {
      // Karşılaştırma testlerinde eski testlerin veritabanına doğrudan yazdığı satırlar.
      const { sql, params } = (await req.json()) as { sql: string; params?: unknown[] };
      await env.DB.prepare(sql).bind(...(params ?? [])).run();
      return Response.json({ ok: true });
    }
    return app.fetch(req, env);
  },
});
console.log(`test sunucusu http://127.0.0.1:${port}`);
