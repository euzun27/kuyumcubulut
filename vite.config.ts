import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  // Her derlemede değişir; sayfalardaki /static dosyalarına ?v= olarak eklenir.
  define: { __SURUM__: JSON.stringify(Date.now().toString(36)) },
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
