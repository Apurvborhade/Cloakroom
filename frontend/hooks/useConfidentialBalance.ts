"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Address } from "viem";
import { fetchConfidentialBalances, type FormattedBalance } from "../lib/api/balance";
import { ensureActiveSession } from "../lib/api/session";
import { getStoredSessionKey } from "../lib/crypto/sessionKey";
import { NATIVE } from "../lib/crypto/typedData";

export function useConfidentialBalance(
  account: Address | null,
  signTypedDataFn?: (params: any) => Promise<any>
) {
  const [balances, setBalances] = useState<FormattedBalance[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAuthorizing, setIsAuthorizing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState<boolean>(false);

  // Check if active session key exists in localStorage
  const checkSessionStatus = useCallback(() => {
    if (!account) {
      setHasActiveSession(false);
      return false;
    }
    const session = getStoredSessionKey(account);
    const active = !!session;
    setHasActiveSession(active);
    return active;
  }, [account]);

  const refreshBalances = useCallback(async () => {
    if (!account) {
      setBalances([]);
      return;
    }

    const sessionActive = checkSessionStatus();
    if (!sessionActive && !signTypedDataFn) {
      // No credentials yet, return empty
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchConfidentialBalances(account, signTypedDataFn);
      setBalances(result);
    } catch (err: any) {
      // Don't flag error if session expired; update state
      if (err?.message?.includes("UNKNOWN_SESSION") || err?.message?.includes("EXPIRED")) {
        setHasActiveSession(false);
      }
      setError(err?.message || "Failed to fetch confidential balance.");
    } finally {
      setIsLoading(false);
    }
  }, [account, checkSessionStatus, signTypedDataFn]);

  // Authorize a new 30-minute session grant
  const authorizeSession = useCallback(async () => {
    if (!account || !signTypedDataFn) {
      throw new Error("Wallet not connected or signing not available.");
    }
    setIsAuthorizing(true);
    setError(null);
    try {
      await ensureActiveSession(account, signTypedDataFn);
      setHasActiveSession(true);
      await refreshBalances();
      return true;
    } catch (err: any) {
      setError(err?.message || "Failed to authorize confidential session.");
      return false;
    } finally {
      setIsAuthorizing(false);
    }
  }, [account, signTypedDataFn, refreshBalances]);

  // Initial load on account change
  useEffect(() => {
    checkSessionStatus();
    if (account) {
      refreshBalances();
    } else {
      setBalances([]);
    }
  }, [account, checkSessionStatus, refreshBalances]);

  // Polling when active session exists
  useEffect(() => {
    if (!account || !hasActiveSession) return;

    const interval = setInterval(() => {
      refreshBalances();
    }, 12_000); // 12 seconds

    return () => clearInterval(interval);
  }, [account, hasActiveSession, refreshBalances]);

  const ethBalance = balances.find((b) => b.token.toLowerCase() === NATIVE.toLowerCase()) || {
    token: NATIVE,
    symbol: "ETH",
    decimals: 18,
    available: "0.0000",
    reserved: "0.0000",
    pending: "0.0000",
    availableRaw: 0n,
    reservedRaw: 0n,
    pendingRaw: 0n,
  };

  const usdcBalance = balances.find((b) => b.symbol === "USDC") || {
    token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address,
    symbol: "USDC",
    decimals: 6,
    available: "0.00",
    reserved: "0.00",
    pending: "0.00",
    availableRaw: 0n,
    reservedRaw: 0n,
    pendingRaw: 0n,
  };

  return {
    balances,
    ethBalance,
    usdcBalance,
    hasActiveSession,
    isLoading,
    isAuthorizing,
    error,
    refreshBalances,
    authorizeSession,
  };
}
