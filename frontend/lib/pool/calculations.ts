import { parseUnits, formatUnits } from "viem";

export const REFERENCE_ETH_PRICE = 3200.0; // Reference Oracle Price ($3,200.00 USDC per 1 ETH)
export const POOL_FEE_BPS = 10; // 0.10% Enclave Relayer Fee (10 basis points)
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.50% (50 basis points)

export interface MarketQuoteResult {
  sellAmount: string;
  netSellAmount: string;
  feeAmount: string;
  estimatedUsdcOutput: string;
  minimumReceived: string;
  priceImpact: string;
  marketPrice: number;
  quoteTimestamp: string;
}

export interface LimitQuoteResult {
  sellAmount: string;
  targetPrice: string;
  feeAmount: string;
  expectedUsdcOutput: string;
  priceDeltaPercent: number; // e.g. +9.38%
  marketPrice: number;
  isAboveMarket: boolean;
  quoteTimestamp: string;
}

/**
 * Calculates Market Order execution estimates with slippage buffer
 */
export function calculateMarketQuote(
  sellAmount: string,
  marketPrice = REFERENCE_ETH_PRICE
): MarketQuoteResult {
  const quoteTimestamp = new Date().toISOString();

  if (!sellAmount || isNaN(parseFloat(sellAmount)) || parseFloat(sellAmount) <= 0) {
    return {
      sellAmount: "0",
      netSellAmount: "0",
      feeAmount: "0",
      estimatedUsdcOutput: "0.00",
      minimumReceived: "0.00",
      priceImpact: "< 0.01%",
      marketPrice,
      quoteTimestamp,
    };
  }

  try {
    const cleanAmount = sanitizeDecimals(sellAmount, 18);
    const parsedInput = parseUnits(cleanAmount, 18);

    const feeBigInt = (parsedInput * BigInt(POOL_FEE_BPS)) / BigInt(10000);
    const netBigInt = parsedInput - feeBigInt;

    const formattedFee = formatUnits(feeBigInt, 18);
    const formattedNet = formatUnits(netBigInt, 18);

    const netNum = parseFloat(formattedNet);
    const rawUsdc = netNum * marketPrice;

    // Minimum received with 0.5% slippage
    const minUsdc = rawUsdc * (1 - DEFAULT_SLIPPAGE_BPS / 10000);

    return {
      sellAmount: cleanAmount,
      netSellAmount: formattedNet,
      feeAmount: formattedFee,
      estimatedUsdcOutput: rawUsdc.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      minimumReceived: minUsdc.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      priceImpact: "< 0.05%",
      marketPrice,
      quoteTimestamp,
    };
  } catch {
    return {
      sellAmount,
      netSellAmount: sellAmount,
      feeAmount: "0",
      estimatedUsdcOutput: "0.00",
      minimumReceived: "0.00",
      priceImpact: "< 0.01%",
      marketPrice,
      quoteTimestamp,
    };
  }
}

/**
 * Calculates Limit Order targets and expected outputs
 */
export function calculateLimitQuote(
  sellAmount: string,
  targetPriceStr: string,
  marketPrice = REFERENCE_ETH_PRICE
): LimitQuoteResult {
  const quoteTimestamp = new Date().toISOString();
  const rawTarget = parseFloat(targetPriceStr.replace(/,/g, ""));
  const targetPrice = isNaN(rawTarget) || rawTarget <= 0 ? marketPrice : rawTarget;

  if (!sellAmount || isNaN(parseFloat(sellAmount)) || parseFloat(sellAmount) <= 0) {
    const delta = ((targetPrice - marketPrice) / marketPrice) * 100;
    return {
      sellAmount: "0",
      targetPrice: targetPrice.toFixed(2),
      feeAmount: "0",
      expectedUsdcOutput: "0.00",
      priceDeltaPercent: delta,
      marketPrice,
      isAboveMarket: delta >= 0,
      quoteTimestamp,
    };
  }

  try {
    const cleanAmount = sanitizeDecimals(sellAmount, 18);
    const parsedInput = parseUnits(cleanAmount, 18);

    const feeBigInt = (parsedInput * BigInt(POOL_FEE_BPS)) / BigInt(10000);
    const netBigInt = parsedInput - feeBigInt;

    const formattedFee = formatUnits(feeBigInt, 18);
    const netNum = parseFloat(formatUnits(netBigInt, 18));

    const expectedOutput = netNum * targetPrice;
    const priceDelta = ((targetPrice - marketPrice) / marketPrice) * 100;

    return {
      sellAmount: cleanAmount,
      targetPrice: targetPrice.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      feeAmount: formattedFee,
      expectedUsdcOutput: expectedOutput.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      priceDeltaPercent: priceDelta,
      marketPrice,
      isAboveMarket: priceDelta >= 0,
      quoteTimestamp,
    };
  } catch {
    return {
      sellAmount,
      targetPrice: targetPrice.toFixed(2),
      feeAmount: "0",
      expectedUsdcOutput: "0.00",
      priceDeltaPercent: 0,
      marketPrice,
      isAboveMarket: true,
      quoteTimestamp,
    };
  }
}

function sanitizeDecimals(val: string, maxDecimals: number): string {
  const parts = val.replace(/,/g, ".").split(".");
  if (parts.length <= 1) return parts[0] || "0";
  return `${parts[0]}.${parts[1].slice(0, maxDecimals)}`;
}

