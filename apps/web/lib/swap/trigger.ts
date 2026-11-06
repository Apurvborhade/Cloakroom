import { parsePrice } from '../format/units';

const BPS = 10_000n;
/** The order fills at the market price. Auto only sets the worst price it may accept. */
export const AUTO_BELOW_PRICE_BPS = 300n;

export interface TriggerChoice {
  /** The price to sign, 1e18 fixed point. Null when it is invalid or no price is known yet. */
  trigger: bigint | null;
  isAuto: boolean;
  invalid: boolean;
  /** Above what the swap can pay after the fee, so it waits for the price to rise. */
  aboveMarket: boolean;
}

/** An empty field means Auto. Anything typed must be a price above zero. */
export function chooseTrigger(text: string, spot: bigint | null, feeBps: number): TriggerChoice {
  if (!text.trim()) {
    return {
      trigger: spot !== null ? (spot * (BPS - AUTO_BELOW_PRICE_BPS)) / BPS : null,
      isAuto: true,
      invalid: false,
      aboveMarket: false,
    };
  }
  let trigger: bigint | null = null;
  try {
    const value = parsePrice(text);
    trigger = value > 0n ? value : null;
  } catch {
    trigger = null;
  }
  if (trigger === null) return { trigger: null, isAuto: false, invalid: true, aboveMarket: false };
  const fillable = spot !== null ? (spot * (BPS - BigInt(feeBps))) / BPS : null;
  return { trigger, isAuto: false, invalid: false, aboveMarket: fillable !== null && trigger > fillable };
}
