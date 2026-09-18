import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@web-scada/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      // monaco 0.56 exports 未暴露 CSS，用别名直出文件
      'monaco-editor-css': fileURLToPath(
        new URL('./node_modules/monaco-editor/min/vs/editor/editor.main.css', import.meta.url),
      ),
    },
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['monaco-editor', 'three', 'three/examples/jsm/controls/TransformControls.js'],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
