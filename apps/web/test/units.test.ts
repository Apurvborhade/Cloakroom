import { describe, expect, it } from 'vitest';
import {
  AmountError,
  formatBps,
  formatPrice,
  formatUnitsDisplay,
  formatUnitsExact,
  minimumOutForLimit,
  parsePercentToBps,
  parsePrice,
  parseUnitsStrict,
  positionSize,
  toBigIntStrict,
} from '@/lib/format/units';

describe('parseUnitsStrict', () => {
  it('converts exact decimals to base units with bigint only', () => {
    expect(parseUnitsStrict('1', 18)).toBe(10n ** 18n);
    expect(parseUnitsStrict('0.1', 18)).toBe(10n ** 17n);
    expect(parseUnitsStrict('.5', 6)).toBe(500_000n);
    expect(parseUnitsStrict('1.', 6)).toBe(1_000_000n);
    expect(parseUnitsStrict('123456789.123456', 6)).toBe(123_456_789_123_456n);
    // 0.1 + 0.2 in floating point is 0.30000000000000004; here it is exact.
    expect(parseUnitsStrict('0.3', 18)).toBe(300_000_000_000_000_000n);
  });

  it('refuses rather than rounds', () => {
    expect(() => parseUnitsStrict('0.0000001', 6)).toThrow(AmountError);
    for (const bad of ['', ' ', '-1', '1e18', '1,000', '0x10', 'abc', '.', '1.2.3', 'Infinity', 'NaN']) {
      expect(() => parseUnitsStrict(bad, 18), bad).toThrow(AmountError);
    }
  });
});

describe('formatting', () => {
  it('formats exactly and for display without rounding up', () => {
    expect(formatUnitsExact(1_500_000n, 6)).toBe('1.5');
    expect(formatUnitsExact('0', 18)).toBe('0');
    expect(formatUnitsExact(-5n, 2)).toBe('-0.05');
    expect(formatUnitsDisplay(1_234_567_999_999n, 6, 2)).toBe('1,234,567.99');
    expect(formatUnitsDisplay(1n, 18, 6)).toBe('<0.000001');
    expect(formatUnitsDisplay('0', 6)).toBe('0');
  });

  it('round-trips arbitrary amounts', () => {
    for (const value of [0n, 1n, 999n, 10n ** 18n, 123_456_789_012_345_678_901n]) {
      expect(parseUnitsStrict(formatUnitsExact(value, 18), 18)).toBe(value);
    }
  });

  it('parses wire strings strictly', () => {
    expect(toBigIntStrict('42')).toBe(42n);
    expect(() => toBigIntStrict('-1')).toThrow();
    expect(toBigIntStrict('-1', true)).toBe(-1n);
    expect(() => toBigIntStrict('1.5')).toThrow();
  });
});

describe('prices and basis points', () => {
  it('uses 1e18 fixed point for prices', () => {
    expect(parsePrice('3000')).toBe(3_000n * 10n ** 18n);
    expect(parsePrice('2500.25')).toBe(2_500_250_000_000_000_000_000n);
    expect(formatPrice(parsePrice('2500.25'))).toBe('2,500.25');
  });

  it('converts percent to bps', () => {
    expect(parsePercentToBps('0.5')).toBe(50);
    expect(parsePercentToBps('1')).toBe(100);
    expect(() => parsePercentToBps('0.555')).toThrow();
    expect(() => parsePercentToBps('101')).toThrow();
    expect(formatBps(50)).toBe('0.5%');
  });

  it('computes the binding-limit minimum like the docs example (0.1 ETH at 3000 -> 300 USDC)', () => {
    expect(minimumOutForLimit(10n ** 17n, parsePrice('3000'), 6)).toBe(300_000_000n);
    // Rounds up so a fill just under the limit is never shown as acceptable.
    expect(minimumOutForLimit(1n, parsePrice('3000'), 6)).toBe(1n);
  });

  it('computes position size as collateral times leverage', () => {
    expect(positionSize(100_000_000n, 40_000)).toBe(400_000_000n);
    expect(positionSize(100_000_000n, 15_000)).toBe(150_000_000n);
  });
});
