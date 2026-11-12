import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 前端单测：只跑纯逻辑与轻量组件，不启动后端。
 *
 * 环境用 jsdom（antd 组件需要 DOM）；`@` 别名与 tsconfig 保持一致。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
