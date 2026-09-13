import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@evogen/kernel': fileURLToPath(new URL('./packages/kernel/src/index.ts', import.meta.url)),
      '@evogen/adapter-codex': fileURLToPath(
        new URL('./packages/adapter-codex/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
