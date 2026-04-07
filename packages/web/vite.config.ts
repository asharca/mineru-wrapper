import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/upload': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
      '/tasks': 'http://localhost:3001',
      '/files': 'http://localhost:3001',
    },
  },
})
