import { isAddress } from "viem";
import { MixAssetSymbol } from "./types";

export interface ValidationState {
  isValid: boolean;
  error: string | null;
}

export function validateMixAmount(
  amount: string,
  asset: MixAssetSymbol,
  availableBalance: string | null
): ValidationState {
  if (!amount || amount.trim() === "") {
    return { isValid: false, error: "Enter an amount to commit." };
  }

  // Check valid decimal format
  if (!/^\d*\.?\d*$/.test(amount.replace(/,/g, "."))) {
    return { isValid: false, error: "Invalid numeric format." };
  }

  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    return { isValid: false, error: "Amount must be greater than zero." };
  }

  // Decimal limit validation
  const maxDecimals = asset === "ETH" ? 18 : 6;
  const parts = amount.replace(/,/g, ".").split(".");
  if (parts[1] && parts[1].length > maxDecimals) {
    return {
      isValid: false,
      error: `${asset} allows maximum ${maxDecimals} decimal places.`,
    };
  }

  // Balance check (when balance is available)
  if (availableBalance !== null) {
    const balNum = parseFloat(availableBalance);
    if (!isNaN(balNum) && num > balNum) {
      return {
        isValid: false,
        error: `Insufficient balance (${balNum} ${asset} available).`,
      };
    }
  }

  return { isValid: true, error: null };
}

export function validateMixDestination(address: string, sourceAddress?: string): ValidationState {
  if (!address || address.trim() === "") {
    return { isValid: false, error: "Destination address is required." };
  }

  if (!isAddress(address.trim())) {
    return { isValid: false, error: "Invalid Ethereum address format." };
  }

  if (sourceAddress && address.trim().toLowerCase() === sourceAddress.trim().toLowerCase()) {
    return {
      isValid: false,
      error: "Destination address cannot be identical to source address.",
    };
  }

  return { isValid: true, error: null };
}
