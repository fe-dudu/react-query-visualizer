import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./src/testing/vscode.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['src/testing/setup.ts'],
    include: ['src/**/*.{spec,test}.ts', 'src/**/*.{spec,test}.tsx'],
    exclude: ['dist/**', 'node_modules/**', 'src/**/*.d.ts'],
    pool: 'threads',
    fileParallelism: false,
    isolate: false,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.{spec,test}.ts', 'src/**/*.{spec,test}.tsx', 'src/testing/**'],
    },
  },
});
