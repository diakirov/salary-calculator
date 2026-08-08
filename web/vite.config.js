import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  // Версія показується в підписі внизу сторінки, тож бамп `version` у
  // package.json — частина ритуалу релізу, а не формальність.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8792',
      '/branding': 'http://127.0.0.1:8792',
    },
  },
})
