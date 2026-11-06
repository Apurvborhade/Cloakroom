import { isAddress } from "viem";

export interface PoolValidationResult {
  isValid: boolean;
  error: string | null;
}

export function validatePoolSellAmount(
  amount: string,
  availableBalance: string | null
): PoolValidationResult {
  if (!amount || amount.trim() === "") {
    return { isValid: false, error: "Enter an amount of ETH to trade." };
  }

  const clean = amount.replace(/,/g, ".");
  if (!/^\d*\.?\d*$/.test(clean)) {
    return { isValid: false, error: "Invalid numeric amount." };
  }

  const num = parseFloat(clean);
  if (isNaN(num) || num <= 0) {
    return { isValid: false, error: "Amount must be greater than zero." };
  }

  const parts = clean.split(".");
  if (parts[1] && parts[1].length > 18) {
    return { isValid: false, error: "ETH allows maximum 18 decimal places." };
  }

  if (availableBalance !== null) {
    const balNum = parseFloat(availableBalance);
    if (!isNaN(balNum) && num > balNum) {
      return {
        isValid: false,
        error: `Insufficient balance (${balNum.toFixed(4)} ETH available).`,
      };
    }
  }

  return { isValid: true, error: null };
}

export function validateLimitTargetPrice(priceStr: string): PoolValidationResult {
  if (!priceStr || priceStr.trim() === "") {
    return { isValid: false, error: "Enter a target limit price." };
  }

  const clean = priceStr.replace(/,/g, ".");
  if (!/^\d*\.?\d*$/.test(clean)) {
    return { isValid: false, error: "Invalid price format." };
  }

  const num = parseFloat(clean);
  if (isNaN(num) || num <= 0) {
    return { isValid: false, error: "Target price must be greater than zero." };
  }

  if (num < 100) {
    return { isValid: false, error: "Target price is unrealistically low (min $100)." };
  }

  if (num > 500000) {
    return { isValid: false, error: "Target price exceeds maximum threshold ($500,000)." };
  }

  return { isValid: true, error: null };
}

