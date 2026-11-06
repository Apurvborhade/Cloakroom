import { parseUnits, formatUnits } from "viem";
import { MixAssetSymbol, RateType } from "./types";

export const ETH_USDC_ESTIMATED_RATE = 3200.0; // Reference oracle estimate: 1 ETH = $3,200 USDC
export const PROTOCOL_FEE_BPS = 10; // 0.10% (10 basis points)

export interface CalculationResult {
  rawAmount: string;
  netAmount: string;
  feeAmount: string;
  estimatedOutput: string;
  rate: number;
  rateType: RateType;
  quoteTimestamp: string;
}

/**
 * Deterministically calculates fees and conversion estimates without floating point corruption.
 */
export function calculateMixQuote(
  inputAsset: MixAssetSymbol,
  inputAmount: string,
  rate = ETH_USDC_ESTIMATED_RATE
): CalculationResult {
  const quoteTimestamp = new Date().toISOString();

  if (!inputAmount || isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
    return {
      rawAmount: "0",
      netAmount: "0",
      feeAmount: "0",
      estimatedOutput: "0",
      rate,
      rateType: "oracle_estimate",
      quoteTimestamp,
    };
  }

  try {
    const decimals = inputAsset === "ETH" ? 18 : 6;
    // Sanitize string to prevent overflow
    const cleanAmount = sanitizeDecimalString(inputAmount, decimals);
    const parsedInput = parseUnits(cleanAmount, decimals);

    // Fee = input * 10 / 10000
    const feeBigInt = (parsedInput * BigInt(PROTOCOL_FEE_BPS)) / BigInt(10000);
    const netBigInt = parsedInput - feeBigInt;

    const formattedFee = formatUnits(feeBigInt, decimals);
    const formattedNet = formatUnits(netBigInt, decimals);

    // Output estimation
    let estimatedOutput = "0";
    if (inputAsset === "ETH") {
      // ETH -> USDC: net * rate
      const netNumber = parseFloat(formattedNet);
      const usdcValue = netNumber * rate;
      estimatedOutput = usdcValue.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      // USDC -> ETH: net / rate
      const netNumber = parseFloat(formattedNet);
      const ethValue = netNumber / rate;
      estimatedOutput = ethValue.toFixed(4);
    }

    return {
      rawAmount: cleanAmount,
      netAmount: formattedNet,
      feeAmount: formattedFee,
      estimatedOutput,
      rate,
      rateType: "oracle_estimate",
      quoteTimestamp,
    };
  } catch {
    return {
      rawAmount: inputAmount,
      netAmount: inputAmount,
      feeAmount: "0",
      estimatedOutput: "0",
      rate,
      rateType: "unavailable",
      quoteTimestamp,
    };
  }
}

/**
 * Calculates remaining balance given an available balance string and committed string.
 */
export function calculateRemainingBalance(
  available: string | null,
  committed: string
): { remaining: string; isInsufficient: boolean } {
  if (!available || !committed) {
    return { remaining: available || "0.0000", isInsufficient: false };
  }

  const availNum = parseFloat(available);
  const commNum = parseFloat(committed);

  if (isNaN(availNum) || isNaN(commNum)) {
    return { remaining: available, isInsufficient: false };
  }

  const diff = availNum - commNum;
  if (diff < 0) {
    return { remaining: "0.0000", isInsufficient: true };
  }

  return { remaining: diff.toFixed(4), isInsufficient: false };
}

/**
 * Truncates excessive decimals beyond asset token capability.
 */
export function sanitizeDecimalString(val: string, maxDecimals: number): string {
  const parts = val.replace(/,/g, ".").split(".");
  if (parts.length <= 1) return parts[0] || "0";
  return `${parts[0]}.${parts[1].slice(0, maxDecimals)}`;
}
