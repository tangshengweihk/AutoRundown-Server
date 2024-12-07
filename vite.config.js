import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/target1': {
        target: 'http://192.168.181.27:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/target1/, '/api')
      },
      '/api/target2': {
        target: 'http://192.168.181.28:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/target2/, '/api')
      },
      '/api/target3': {
        target: 'http://192.168.181.29:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/target3/, '/api')
      },
      '/api/target4': {
        target: 'http://192.168.181.30:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/target4/, '/api')
      },
      '/api/target5': {
        target: 'http://192.168.181.31:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/target5/, '/api')
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: '[name].[hash].[ext]'
      }
    }
  }
})
