import { defineConfig } from 'vite';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { resolve } from 'path';

export default defineConfig({
  root: 'frontend',
  base: '/',
  publicDir: resolve(__dirname, 'public'),
  plugins: [vueJsx()],
  // frontend 已是构建根目录，沿用默认 index.html 可保持 Windows/Linux 行为一致。
  build: {
    outDir: resolve(__dirname, 'frontend/dist'),
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/qrcodes': 'http://localhost:3000'
    }
  },
  resolve: {
    alias: {
      'vue': 'vue/dist/vue.esm-bundler.js',
      '@': resolve(__dirname, 'frontend/src')
    }
  }
});
