import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
      exclude: ['**/*.spec.ts'],
      reporter: ['text', 'html'],
      // NFA-09: Kernlogik zu mindestens 80 % abgedeckt
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
