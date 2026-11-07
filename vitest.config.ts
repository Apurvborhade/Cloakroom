import { configDefaults, defineConfig } from 'vitest/config';

/** The web app brings its own config (browser environment and the `@` alias). Everything else runs in Node. */
export default defineConfig({
  test: {
    projects: [
      'apps/web/vitest.config.ts',
      { test: { name: 'backend', exclude: [...configDefaults.exclude, 'apps/web/**', '**/.next/**', '**/*.integration.test.ts'] } },
    ],
  },
});
