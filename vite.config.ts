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
    chunkSizeWarningLimit: 1600,
    
    // Production optimizations
    target: 'esnext',
    minify: 'terser',
    sourcemap: true,
    
    // Optimize chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'three-loaders': [
            'three/examples/jsm/loaders/GLTFLoader.js',
            'three/examples/jsm/loaders/PLYLoader.js'
          ],
          'three-xr': [
            'three/examples/jsm/webxr/XRHandModelFactory.js'
          ]
        }
      }
    },
    
    // Terser options - keep console.error for debugging
    terserOptions: {
      compress: {
        drop_console: false,  // Keep console logs for now
        drop_debugger: true
      }
    }
  }
})
