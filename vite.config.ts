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
    
    // Terser options for better compression
    terserOptions: {
      compress: {
        drop_console: true,  // Remove console.logs in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug']
      }
    }
  },
  
  // Define environment variables
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0')
  }
})
