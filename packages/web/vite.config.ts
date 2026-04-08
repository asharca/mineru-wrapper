import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/upload': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
      '/tasks': 'http://localhost:3001',
      '/files': 'http://localhost:3001',
      '/docs': 'http://localhost:3001',
      '/swagger': 'http://localhost:3001',
    },
  },
})
