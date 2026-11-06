import { expect, it } from 'vitest';
import { runCustodySelfTest } from '../src/custody-selftest.js';

it('runs the unfunded signing, restart and HPKE bootstrap self-test', async () => {
  await expect(runCustodySelfTest()).resolves.toBeUndefined();
});
