import { describe, expect, it } from 'vitest';
import { chooseTrigger } from '@/lib/swap/trigger';

const price = (dollars: bigint) => dollars * 10n ** 18n;
const SPOT = price(26_000n);
const FEE_BPS = 10;

describe('swap trigger', () => {
  it('uses 3% below the current price when left empty', () => {
    expect(chooseTrigger('', SPOT, FEE_BPS)).toEqual({ trigger: price(25_220n), isAuto: true, invalid: false, aboveMarket: false });
    expect(chooseTrigger('   ', SPOT, FEE_BPS).isAuto).toBe(true);
  });

  it('has no Auto trigger until a price is known', () => {
    expect(chooseTrigger('', null, FEE_BPS).trigger).toBeNull();
  });

  it('uses a typed price exactly, even with no market price to compare', () => {
    expect(chooseTrigger('25000', SPOT, FEE_BPS)).toMatchObject({ trigger: price(25_000n), isAuto: false, aboveMarket: false });
    expect(chooseTrigger('2500.5', null, FEE_BPS).trigger).toBe(2_500_500_000_000_000_000_000n);
  });

  it('flags a trigger the swap cannot pay after the fee', () => {
    // 26,000 less the 0.1% fee is 25,974.
    expect(chooseTrigger('25974', SPOT, FEE_BPS).aboveMarket).toBe(false);
    expect(chooseTrigger('25975', SPOT, FEE_BPS).aboveMarket).toBe(true);
    expect(chooseTrigger('26000', SPOT, FEE_BPS).aboveMarket).toBe(true);
  });

  it.each(['0', '0.00', '.', 'abc'])('refuses %s', (text) => {
    expect(chooseTrigger(text, SPOT, FEE_BPS)).toMatchObject({ trigger: null, invalid: true });
  });
});
