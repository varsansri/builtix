import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/builtix/',
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
