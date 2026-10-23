import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The version shown in the footer comes from package.json; bump it there.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // Relative asset paths, so the build also works under a sub-path (GitHub Pages: /SSK_ERP/)
  base: './',
  test: {
    exclude: ['**/node_modules/**', 'backend/**'],
  },
  server: {
    host: true,
    port: 5175,
    strictPort: false,
    proxy: {
      '/api': { target: `http://localhost:${Number(process.env.API_PORT) || 3002}`, changeOrigin: true },
    },
  },
})
