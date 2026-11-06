/** Every amount a user enters moves in steps of 0.001, which is also the smallest amount. */
const STEP_DECIMALS = 3;
const STEPS_PER_TOKEN = 10n ** BigInt(STEP_DECIMALS);
const TYPING = /^\d*\.?\d{0,3}$/;

export const STEP_LABEL = '0.001';

/** False for anything that could not become a whole number of steps, so the keystroke is ignored. */
export function isStepInput(text: string): boolean {
  return TYPING.test(text);
}

function toSteps(text: string): bigint {
  const [whole = '', fraction = ''] = text.split('.');
  return BigInt(whole || '0') * STEPS_PER_TOKEN + BigInt(fraction.padEnd(STEP_DECIMALS, '0') || '0');
}

function fromSteps(value: bigint): string {
  const fraction = (value % STEPS_PER_TOKEN).toString().padStart(STEP_DECIMALS, '0');
  return `${value / STEPS_PER_TOKEN}.${fraction}`;
}

/** The next amount up or down. Going below one step clears the field instead of showing zero. */
export function stepAmount(text: string, direction: 1 | -1): string {
  const next = toSteps(isStepInput(text) ? text : '') + BigInt(direction);
  return next <= 0n ? '' : fromSteps(next);
}

/** The largest whole number of steps within a balance, or null when it is under one step. */
export function floorToStep(baseUnits: bigint, decimals: number): string | null {
  const steps = decimals >= STEP_DECIMALS
    ? baseUnits / 10n ** BigInt(decimals - STEP_DECIMALS)
    : baseUnits * 10n ** BigInt(STEP_DECIMALS - decimals);
  return steps > 0n ? fromSteps(steps) : null;
}
