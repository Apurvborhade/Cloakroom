"use client";

import { useState, useEffect, useCallback } from "react";
import { formatEther, type Address, type Hex } from "viem";
import { getNextNonce as getNextNonceUtil, commitNonce as commitNonceUtil, bumpNonceOnConflict } from "../lib/crypto/nonce";

export interface WalletState {
  account: Address | null;
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
        const activeAccount = accounts[0].toLowerCase() as Address;
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
          const norm = accounts[0].toLowerCase() as Address;
          setWallet((prev) => ({ ...prev, account: norm }));
          updateBalance(norm);
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
        const activeAccount = accounts[0].toLowerCase() as Address;
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

  const switchChain = useCallback(async (targetChainId: number = 11155111): Promise<boolean> => {
    if (typeof window === "undefined" || !(window as any).ethereum) return false;
    const ethereum = (window as any).ethereum;
    const hexChainId = `0x${targetChainId.toString(16)}`;
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
      return true;
    } catch (switchError: any) {
      // Chain not added error (4902)
      if (switchError?.code === 4902 && targetChainId === 11155111) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexChainId,
                chainName: "Sepolia Testnet",
                nativeCurrency: { name: "Sepolia Ether", symbol: "SEP", decimals: 18 },
                rpcUrls: ["https://rpc.sepolia.org"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }, []);

  const signTypedData = useCallback(
    async (typedData: Record<string, unknown>): Promise<Hex> => {
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No Web3 browser wallet available to sign typed data.");
      }
      if (!wallet.account) {
        throw new Error("Wallet not connected. Connect your wallet first.");
      }

      const stringifiedData = JSON.stringify(typedData, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      );

      const signature = await (window as any).ethereum.request({
        method: "eth_signTypedData_v4",
        params: [wallet.account, stringifiedData],
      });

      return signature as Hex;
    },
    [wallet.account]
  );

  const sendEthTransaction = useCallback(
    async ({ to, valueWei }: { to: Address; valueWei: bigint }): Promise<Hex> => {
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No Web3 browser wallet detected.");
      }
      if (!wallet.account) {
        throw new Error("Wallet not connected.");
      }

      const txHash = await (window as any).ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.account,
            to,
            value: `0x${valueWei.toString(16)}`,
          },
        ],
      });

      return txHash as Hex;
    },
    [wallet.account]
  );

  const getNextNonce = useCallback((): bigint => {
    if (!wallet.account) return 1n;
    return getNextNonceUtil(wallet.account);
  }, [wallet.account]);

  const commitNonce = useCallback(
    (nonce: bigint) => {
      if (!wallet.account) return;
      commitNonceUtil(wallet.account, nonce);
    },
    [wallet.account]
  );

  const bumpNonce = useCallback(
    (hint?: bigint): bigint => {
      if (!wallet.account) return 1n;
      return bumpNonceOnConflict(wallet.account, hint);
    },
    [wallet.account]
  );

  return {
    ...wallet,
    connect,
    disconnect,
    switchChain,
    signTypedData,
    sendEthTransaction,
    getNextNonce,
    commitNonce,
    bumpNonce,
    refreshBalance: () => {
      if (wallet.account) updateBalance(wallet.account);
    },
  };
}
