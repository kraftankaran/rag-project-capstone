import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/pdfs':     { target: 'http://api:8000', changeOrigin: true },
      '/upload':   { target: 'http://api:8000', changeOrigin: true },
      '/process':  { target: 'http://api:8000', changeOrigin: true },
      '/download': { target: 'http://api:8000', changeOrigin: true },
      '/search':   { target: 'http://api:8000', changeOrigin: true },
      '/chat':     { target: 'http://api:8000', changeOrigin: true },
      '/health':   { target: 'http://api:8000', changeOrigin: true },
    }
  }
})
