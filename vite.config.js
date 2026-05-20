// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const targetUrl = 'http://192.168.1.22:8000';

//const targetUrl = 'http://localhost:8000';

function proxy(target) {
  return { target, changeOrigin: true };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/login':         proxy(targetUrl),
      '/logout':        proxy(targetUrl),
      '/whoami':        proxy(targetUrl),
      '/config':        proxy(targetUrl),
      '/reset-password':proxy(targetUrl),
      '/create-user':   proxy(targetUrl),
      '/users':         proxy(targetUrl),
      '/roles':         proxy(targetUrl),
      '/system-config': proxy(targetUrl),
      '/gpio-status':   proxy(targetUrl),
      '/audio-alerts':  proxy(targetUrl),
      '/update-status': proxy(targetUrl),
      '/clear-update-flag': proxy(targetUrl),
    },
  },
})
