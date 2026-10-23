// Test sunucusunu Node için paketler (`?raw` HTML içe aktarımlarını metin olarak yükler).
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(dirname(a.importer), a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }));
  },
};

await build({
  entryPoints: ['tests/server.ts', 'tests/harness.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'tests/.build',
  outbase: 'tests',
  outExtension: { '.js': '.mjs' },
  external: ['node:*'],
  plugins: [raw],
  logLevel: 'warning',
});
