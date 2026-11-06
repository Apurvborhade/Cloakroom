import { PRICE_PRECISION } from '@cloakroom/shared';

const BPS = 10_000n;
const WEI_PER_ETH = 10n ** 18n;
/** Mirrors the enclave's 10%, for display only. The enclave's own check decides. */
const MAINTENANCE_BPS = 1_000n;
/** A market order accepts up to this much worse than the price shown. */
export const MARKET_LIMIT_ROOM_BPS = 300n;

export type MarginSide = 'long' | 'short';

export interface MarginQuoteInput {
  side: MarginSide;
  /** USDC base units. */
  collateral: bigint;
  leverageBps: number;
  /** USDC per ETH, 1e18 fixed point. */
  price: bigint;
  usdcDecimals: number;
}

export interface MarginQuote {
  /** Collateral times leverage, in USDC base units. */
  sizeUsdc: bigint;
  /** What the position holds (a long) or owes (a short), in wei. */
  sizeEth: bigint;
  /** A long borrows USDC. A short borrows ETH. */
  borrowed: bigint;
  borrowedToken: 'USDC' | 'ETH';
  /** Null when the position can't be liquidated: a 1x long has no loan. */
  liquidationPrice: bigint | null;
}

/** An estimate at one price, before swap costs. The enclave calculates the real position. */
export function marginQuote({ collateral, leverageBps, price, side, usdcDecimals }: MarginQuoteInput): MarginQuote {
  const leverage = BigInt(leverageBps);
  const sizeUsdc = (collateral * leverage) / BPS;
  const sizeEth = (sizeUsdc * WEI_PER_ETH * PRICE_PRECISION) / (price * 10n ** BigInt(usdcDecimals));
  if (side === 'long') {
    return {
      sizeUsdc,
      sizeEth,
      borrowed: sizeUsdc - collateral,
      borrowedToken: 'USDC',
      liquidationPrice: leverage > BPS ? (price * (leverage - BPS) * BPS) / (leverage * (BPS - MAINTENANCE_BPS)) : null,
    };
  }
  return {
    sizeUsdc,
    sizeEth,
    borrowed: sizeEth,
    borrowedToken: 'ETH',
    liquidationPrice: (price * (leverage + BPS) * BPS) / (leverage * (BPS + MAINTENANCE_BPS)),
  };
}

/** The worst price a market order may accept: higher for a buy, lower for a sale. */
export function marketLimitPrice(side: MarginSide, price: bigint): bigint {
  return side === 'long'
    ? (price * (BPS + MARKET_LIMIT_ROOM_BPS)) / BPS
    : (price * (BPS - MARKET_LIMIT_ROOM_BPS)) / BPS;
}
