import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// 单测运行在 Node 环境，复用与 electron-vite 一致的路径别名
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false
  }
});
