"use client";

import { useState, useEffect, useCallback } from "react";
import { formatEther } from "viem";

export interface WalletState {
  account: string | null;
  chainId: number | null;
  networkName: string;
  balance: string | null;
  isConnecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    account: null,
    chainId: null,
    networkName: "Not Connected",
    balance: null,
    isConnecting: false,
    error: null,
  });

  const getNetworkName = (id: number | null): string => {
    switch (id) {
      case 1:
        return "Ethereum Mainnet";
      case 11155111:
        return "Sepolia Testnet";
      case 5:
        return "Goerli Testnet";
      case 17000:
        return "Holesky Testnet";
      case 31337:
      case 1337:
        return "Local Anvil / Hardhat";
      default:
        return id ? `EVM Chain (${id})` : "Not Connected";
    }
  };

  const updateBalance = useCallback(async (account: string) => {
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    try {
      const balanceHex = await (window as any).ethereum.request({
        method: "eth_getBalance",
        params: [account, "latest"],
      });
      const balanceBigInt = BigInt(balanceHex);
      const formatted = formatEther(balanceBigInt);
      // Format to 4 decimals for clean display
      const [intPart, decPart = ""] = formatted.split(".");
      const cleanBalance = `${intPart}.${decPart.slice(0, 4)}`;
      setWallet((prev) => ({ ...prev, balance: cleanBalance }));
    } catch {
      // Balance read fallback
    }
  }, []);

  const refreshWalletState = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      return;
    }
    try {
      const ethereum = (window as any).ethereum;
      const accounts = await ethereum.request({ method: "eth_accounts" });
      const chainIdHex = await ethereum.request({ method: "eth_chainId" });
      const numericChainId = chainIdHex ? parseInt(chainIdHex, 16) : null;

      if (accounts && accounts.length > 0 && accounts[0]) {
        const activeAccount = accounts[0];
        setWallet((prev) => ({
          ...prev,
          account: activeAccount,
          chainId: numericChainId,
          networkName: getNetworkName(numericChainId),
          error: null,
        }));
        await updateBalance(activeAccount);
      } else {
        setWallet({
          account: null,
          chainId: numericChainId,
          networkName: getNetworkName(numericChainId),
          balance: null,
          isConnecting: false,
          error: null,
        });
      }
    } catch (err: any) {
      setWallet((prev) => ({ ...prev, error: err?.message || "Failed to query wallet" }));
    }
  }, [updateBalance]);

  useEffect(() => {
    refreshWalletState();

    if (typeof window !== "undefined" && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0 && accounts[0]) {
          setWallet((prev) => ({ ...prev, account: accounts[0] }));
          updateBalance(accounts[0]);
        } else {
          setWallet((prev) => ({ ...prev, account: null, balance: null }));
        }
      };

      const handleChainChanged = (chainIdHex: string) => {
        const id = parseInt(chainIdHex, 16);
        setWallet((prev) => ({
          ...prev,
          chainId: id,
          networkName: getNetworkName(id),
        }));
        if (wallet.account) updateBalance(wallet.account);
      };

      ethereum.on?.("accountsChanged", handleAccountsChanged);
      ethereum.on?.("chainChanged", handleChainChanged);

      return () => {
        ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
        ethereum.removeListener?.("chainChanged", handleChainChanged);
      };
    }
  }, [refreshWalletState, updateBalance, wallet.account]);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setWallet((prev) => ({
        ...prev,
        error: "No Web3 browser wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.",
      }));
      return false;
    }
    setWallet((prev) => ({ ...prev, isConnecting: true, error: null }));
    try {
      const accounts = await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });
      if (accounts && accounts.length > 0 && accounts[0]) {
        const activeAccount = accounts[0];
        const chainIdHex = await (window as any).ethereum.request({ method: "eth_chainId" });
        const numericChainId = chainIdHex ? parseInt(chainIdHex, 16) : null;
        setWallet({
          account: activeAccount,
          chainId: numericChainId,
          networkName: getNetworkName(numericChainId),
          balance: null,
          isConnecting: false,
          error: null,
        });
        await updateBalance(activeAccount);
        return true;
      }
      return false;
    } catch (err: any) {
      setWallet((prev) => ({
        ...prev,
        isConnecting: false,
        error: err?.message || "Connection request rejected.",
      }));
      return false;
    }
  }, [updateBalance]);

  const disconnect = useCallback(() => {
    setWallet({
      account: null,
      chainId: null,
      networkName: "Not Connected",
      balance: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  return {
    ...wallet,
    connect,
    disconnect,
    refreshBalance: () => {
      if (wallet.account) updateBalance(wallet.account);
    },
  };
}

