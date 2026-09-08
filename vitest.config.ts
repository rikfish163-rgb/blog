import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      // 只统计纯逻辑层。.astro 模板不在这里假装被测。
      include: ['src/lib/**', 'src/i18n/**'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
