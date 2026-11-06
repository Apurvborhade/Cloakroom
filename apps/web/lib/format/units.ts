import { PRICE_PRECISION } from '@cloakroom/shared';

/**
 * Exact decimal <-> base-unit conversion. Nothing here touches floating point: amounts and prices
 * that end up in a signed message are built with bigint only.
 */
export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

const DECIMAL = /^(\d*)(?:\.(\d*))?$/;

/**
 * Parses a human decimal ("1.25") into base units. Rejects negatives, exponents, separators and
 * more fractional digits than the token has, instead of rounding them away.
 */
export function parseUnitsStrict(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new AmountError('Unsupported decimals');
  const text = input.trim();
  const match = DECIMAL.exec(text);
  if (!text || !match || (match[1] === '' && (match[2] ?? '') === '')) throw new AmountError('Enter a number');
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new AmountError(decimals === 0 ? 'Whole numbers only' : `At most ${decimals} decimal places`);
  }
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole || '0') * scale + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** Base units to an exact decimal string with trailing zeros removed ("1.5", "0", "0.000001"). */
export function formatUnitsExact(value: bigint | string, decimals: number): string {
  const amount = typeof value === 'string' ? toBigIntStrict(value) : value;
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/**
 * For display: groups thousands and truncates (never rounds up) to maxFraction digits. A non-zero
 * value that truncates to zero shows as "<0.0001" so it is never mistaken for an empty balance.
 */
export function formatUnitsDisplay(value: bigint | string, decimals: number, maxFraction = 6): string {
  const amount = typeof value === 'string' ? toBigIntStrict(value) : value;
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const keep = Math.min(maxFraction, decimals);
  let fraction = (abs % scale).toString().padStart(decimals, '0').slice(0, keep).replace(/0+$/, '');
  if (abs > 0n && whole === 0n && fraction === '') {
    return `${negative ? '>-' : '<'}0.${'0'.repeat(Math.max(keep - 1, 0))}1`;
  }
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fraction === '') fraction = '';
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** Parses a wire decimal string ("123", or "-5" when signed is allowed). */
export function toBigIntStrict(value: string, signed = false): bigint {
  const pattern = signed ? /^-?\d+$/ : /^\d+$/;
  if (typeof value !== 'string' || !pattern.test(value)) throw new AmountError('Malformed amount from the API');
  return BigInt(value);
}

/** A human price ("2500.5" output per 1 input) to the 1e18 fixed point the protocol signs. */
export function parsePrice(input: string): bigint {
  return parseUnitsStrict(input, 18);
}

export function formatPrice(value: bigint | string, maxFraction = 6): string {
  return formatUnitsDisplay(value, 18, maxFraction);
}

/** Basis points as a percent string: 50 -> "0.5%". */
export function formatBps(bps: number): string {
  return `${formatUnitsExact(BigInt(bps), 2)}%`;
}

/** "0.5" (percent) -> 50 bps. Rejects more than 2 decimal places. */
export function parsePercentToBps(input: string): number {
  const bps = parseUnitsStrict(input, 2);
  if (bps > 10_000n) throw new AmountError('At most 100%');
  return Number(bps);
}

/**
 * The minimum net output the binding-limit rule guarantees, in output base units: ceil(amountIn *
 * price * 10^outDecimals / 10^36). Display only: the enclave computes the binding floor itself.
 */
export function minimumOutForLimit(amountInWei: bigint, triggerPrice: bigint, outDecimals: number): bigint {
  const numerator = amountInWei * triggerPrice * 10n ** BigInt(outDecimals);
  const denominator = 10n ** 18n * PRICE_PRECISION;
  return (numerator + denominator - 1n) / denominator;
}

/** Collateral times leverage, as the mock accounting computes position size (display only). */
export function positionSize(collateral: bigint, leverageBps: number): bigint {
  return (collateral * BigInt(leverageBps)) / 10_000n;
}
