import { AmountError, parsePercentToBps, parsePrice, parseUnitsStrict } from '../format/units';

export interface SwapFormInput {
  amount: string;
  trigger: string;
  slippage: string;
}

export interface SwapFormLimits {
  maxAmountWei: bigint;
  availableWei: bigint | null;
  maxSlippageBpsCap: number;
}

export interface SwapFormResult {
  amountIn: bigint | null;
  triggerPrice: bigint | null;
  maxSlippageBps: number | null;
  errors: Partial<Record<keyof SwapFormInput, string>>;
  warnings: string[];
}

function attempt<T>(fn: () => T): { value: T | null; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: null, error: error instanceof AmountError ? error.message : 'Invalid value' };
  }
}

/** Validates the swap form exactly as the enclave will, before anything is signed. */
export function validateSwapForm(input: SwapFormInput, limits: SwapFormLimits): SwapFormResult {
  const errors: SwapFormResult['errors'] = {};
  const warnings: string[] = [];

  let amountIn: bigint | null = null;
  if (input.amount.trim()) {
    const parsed = attempt(() => parseUnitsStrict(input.amount, 18));
    if (parsed.error) errors.amount = parsed.error;
    else if (parsed.value === 0n) errors.amount = 'Enter an amount above zero';
    else if (parsed.value! > limits.maxAmountWei) errors.amount = 'Above the enclave maximum per intent';
    else if (limits.availableWei !== null && parsed.value! > limits.availableWei) errors.amount = 'More than your available private ETH';
    else amountIn = parsed.value;
  }

  let triggerPrice: bigint | null = null;
  if (input.trigger.trim()) {
    const parsed = attempt(() => parsePrice(input.trigger));
    if (parsed.error) errors.trigger = parsed.error;
    else if (parsed.value === 0n) errors.trigger = 'Enter a trigger above zero';
    else triggerPrice = parsed.value;
  }

  let maxSlippageBps: number | null = null;
  const slippage = attempt(() => parsePercentToBps(input.slippage));
  if (slippage.error) errors.slippage = slippage.error;
  else if (slippage.value! > limits.maxSlippageBpsCap) {
    maxSlippageBps = slippage.value;
    warnings.push(`The enclave caps slippage at ${(limits.maxSlippageBpsCap / 100).toString()}%; a higher value is reduced to that cap.`);
  } else maxSlippageBps = slippage.value;

  if (limits.availableWei === null) warnings.push('Your available balance is unknown until you unlock the private view; the enclave rejects intents above it.');
  return { amountIn, triggerPrice, maxSlippageBps, errors, warnings };
}
