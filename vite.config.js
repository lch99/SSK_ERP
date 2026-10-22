import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
