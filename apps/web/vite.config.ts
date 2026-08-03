import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.ASTRO_SERVER_ORIGIN ?? 'http://127.0.0.1:8080',
      },
    },
  },
})
