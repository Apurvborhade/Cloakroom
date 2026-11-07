import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['services/enclave/test/escape.integration.test.ts'],
    testTimeout: 15_000,
  },
});
