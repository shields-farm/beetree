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
  build: {
    rollupOptions: {
      output: {
        // Split vendor libraries into separate chunks for better caching
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
          if (id.includes('node_modules/date-fns') || id.includes('node_modules/marked')) {
            return 'utils';
          }
        },
      },
    },
  },
})