import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/jobs': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/queue': 'http://localhost:3000',
      '/agents': 'http://localhost:3000',
      '/schedules': 'http://localhost:3000',
      '/structured': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
