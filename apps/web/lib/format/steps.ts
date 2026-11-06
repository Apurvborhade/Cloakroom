/** Every amount a user enters moves in steps of 0.01, in whole hundredths of the token. */
const HUNDREDTHS_DECIMALS = 2;
const TYPING = /^\d*\.?\d{0,2}$/;

/** False for anything that could not become a whole number of steps, so the keystroke is ignored. */
export function isStepInput(text: string): boolean {
  return TYPING.test(text);
}

function toHundredths(text: string): bigint {
  const [whole = '', fraction = ''] = text.split('.');
  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(HUNDREDTHS_DECIMALS, '0') || '0');
}

function fromHundredths(value: bigint): string {
  const fraction = (value % 100n).toString().padStart(HUNDREDTHS_DECIMALS, '0');
  return `${value / 100n}.${fraction}`;
}

/** The next amount up or down. Going below one step clears the field instead of showing zero. */
export function stepAmount(text: string, direction: 1 | -1): string {
  const next = toHundredths(isStepInput(text) ? text : '') + BigInt(direction);
  return next <= 0n ? '' : fromHundredths(next);
}

/** The largest whole number of steps within a balance, or null when it is under one step. */
export function floorToStep(baseUnits: bigint, decimals: number): string | null {
  const hundredths = decimals >= HUNDREDTHS_DECIMALS
    ? baseUnits / 10n ** BigInt(decimals - HUNDREDTHS_DECIMALS)
    : baseUnits * 10n ** BigInt(HUNDREDTHS_DECIMALS - decimals);
  return hundredths > 0n ? fromHundredths(hundredths) : null;
}
