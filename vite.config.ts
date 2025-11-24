import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [mkcert()],
  server: {
    https: true,  // use mkcert certs
    host: true    // expose on LAN so Quest can reach it
  },
  build: {
    // Silence benign warnings from large vendor bundle
    chunkSizeWarningLimit: 1600
  }
})
