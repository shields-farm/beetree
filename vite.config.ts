import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Proxy /api/* to the Express backend so we avoid mixed-content errors
    // (frontend is HTTPS, Express is HTTP — the proxy bridges them on one origin).
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    ...(fs.existsSync(path.join(process.cwd(), 'certs', 'key.pem')) ? {
      https: {
        key: fs.readFileSync(path.join(process.cwd(), 'certs', 'key.pem')),
        cert: fs.readFileSync(path.join(process.cwd(), 'certs', 'cert.pem')),
      },
    } : {}),
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})