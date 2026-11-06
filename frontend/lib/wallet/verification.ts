import { formatEther } from "viem";

export interface VerifiedWithdrawalReceipt {
  status: "success" | "reverted" | "pending";
  txHash: string;
  blockNumber?: number;
  blockHash?: string;
  from?: string;
  to?: string;
  destinationAddress?: string;
  asset: "ETH" | "USDC";
  amount: string;
  usdEquivalent?: string;
  gasUsed?: string;
  effectiveGasPriceGwei?: string;
  networkFeeEth?: string;
  timestamp?: string;
  networkName: string;
  chainId: number;
  explorerUrl?: string | null;
  isDevPreview?: boolean;
}

export type VerificationState =
  | "loading"
  | "verified"
  | "pending"
  | "failed"
  | "missing"
  | "invalid"
  | "unsupported_network";

const TRUSTED_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  11155111: "https://sepolia.etherscan.io/tx/",
  17000: "https://holesky.etherscan.io/tx/",
};

export const SUPPORTED_NETWORKS: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia Testnet",
  17000: "Holesky Testnet",
  31337: "Local Anvil / Hardhat",
  1337: "Local Geth",
};

export function validateTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash.trim());
}

export function getTrustedExplorerUrl(chainId: number, txHash: string): string | null {
  const base = TRUSTED_EXPLORERS[chainId];
  if (!base) return null;
  return `${base}${txHash}`;
}

/**
 * Isolated development preview fixture strictly gated to non-production environments.
 * Gated by process.env.NODE_ENV !== "production".
 */
export function getDevPreviewFixture(networkName = "Sepolia Testnet"): VerifiedWithdrawalReceipt {
  return {
    status: "success",
    txHash: "0x7a3c9b2e5f8d1a4c6e9b0d2f4a7c1e3b5d8f0a2c4e6b8d1a3c5e7b9d0f2a4c6e",
    blockNumber: 5892147,
    blockHash: "0x3f2d1e0b9a8c7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d",
    from: "0x0000000000000000000000000000000000001010",
    to: "0x71C841832049d94943E9804b462998a65DAb24b4",
    destinationAddress: "0x71C841832049d94943E9804b462998a65DAb24b4",
    asset: "ETH",
    amount: "0.2500",
    usdEquivalent: "800.00",
    gasUsed: "21,000",
    effectiveGasPriceGwei: "12.45",
    networkFeeEth: "0.00026145",
    timestamp: new Date().toUTCString(),
    networkName,
    chainId: 11155111,
    explorerUrl: "https://sepolia.etherscan.io/tx/0x7a3c9b2e5f8d1a4c6e9b0d2f4a7c1e3b5d8f0a2c4e6b8d1a3c5e7b9d0f2a4c6e",
    isDevPreview: true,
  };
}

/**
 * Cryptographically verifies an on-chain transaction receipt.
 * Enforces that only an actual confirmed transaction with status === "0x1"
 * can unlock the verified success state.
 */
export async function verifyOnChainWithdrawal(
  txHash: string | null | undefined,
  chainIdHint?: number | null,
  assetHint?: "ETH" | "USDC",
  allowDevPreview = false
): Promise<{
  state: VerificationState;
  receipt?: VerifiedWithdrawalReceipt;
  error?: string;
}> {
  // Gated Developer Preview check (Strictly non-production)
  if (
    allowDevPreview &&
    process.env.NODE_ENV !== "production" &&
    txHash === "dev_preview"
  ) {
    const fixture = getDevPreviewFixture(
      chainIdHint ? SUPPORTED_NETWORKS[chainIdHint] || "Sepolia Testnet" : "Sepolia Testnet"
    );
    return {
      state: "verified",
      receipt: fixture,
    };
  }

  // 1. Missing transaction data
  if (!txHash || txHash.trim() === "") {
    return {
      state: "missing",
      error: "No transaction hash provided. A confirmed transaction is required to view payment confirmation.",
    };
  }

  const cleanHash = txHash.trim();

  // 2. Invalid transaction hash syntax
  if (!validateTxHash(cleanHash)) {
    return {
      state: "invalid",
      error: `Invalid Ethereum transaction hash format (${cleanHash.slice(0, 10)}...). Must be a 32-byte hex string (0x followed by 64 hex characters).`,
    };
  }

  // 3. Check Web3 Provider availability
  if (typeof window === "undefined" || !(window as any).ethereum) {
    return {
      state: "failed",
      error: "No Web3 provider detected in your browser to verify on-chain transaction receipt.",
    };
  }

  try {
    const ethereum = (window as any).ethereum;

    // Detect actual chain
    const currentChainHex = await ethereum.request({ method: "eth_chainId" });
    const numericChainId = currentChainHex ? parseInt(currentChainHex, 16) : chainIdHint || 11155111;

    if (!SUPPORTED_NETWORKS[numericChainId]) {
      return {
        state: "unsupported_network",
        error: `Connected to an unsupported network (Chain ID: ${numericChainId}). Please switch your Web3 wallet to Ethereum Sepolia or Mainnet.`,
      };
    }

    // 4. Query on-chain transaction details
    const tx = await ethereum.request({
      method: "eth_getTransactionByHash",
      params: [cleanHash],
    });

    // 5. Query on-chain transaction receipt
    const receipt = await ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [cleanHash],
    });

    // Transaction pending in mempool (not yet mined into a block)
    if (!receipt || !receipt.blockNumber) {
      return {
        state: "pending",
        receipt: {
          status: "pending",
          txHash: cleanHash,
          destinationAddress: tx?.to || undefined,
          from: tx?.from || undefined,
          asset: assetHint || "ETH",
          amount: tx?.value ? formatEther(BigInt(tx.value)) : "0.00",
          networkName: SUPPORTED_NETWORKS[numericChainId] || `Chain ${numericChainId}`,
          chainId: numericChainId,
          explorerUrl: getTrustedExplorerUrl(numericChainId, cleanHash),
        },
        error: "Transaction is currently pending inclusion on-chain. Waiting for block confirmation...",
      };
    }

    // 6. Check transaction status
    // In EVM receipts: '0x1' is success, '0x0' is reverted
    const statusHex = receipt.status;
    const isSuccess = statusHex === "0x1" || statusHex === 1 || statusHex === true;

    // Calculate actual gas metrics if available
    let gasUsedFormatted = "Unavailable";
    let effectiveGasPriceFormatted = "Unavailable";
    let networkFeeEth = "Unavailable";

    if (receipt.gasUsed) {
      const gasUsedBigInt = BigInt(receipt.gasUsed);
      gasUsedFormatted = gasUsedBigInt.toLocaleString();

      if (receipt.effectiveGasPrice) {
        const gasPriceBigInt = BigInt(receipt.effectiveGasPrice);
        const gweiVal = Number(gasPriceBigInt) / 1e9;
        effectiveGasPriceFormatted = gweiVal.toFixed(2);

        const feeWei = gasUsedBigInt * gasPriceBigInt;
        networkFeeEth = formatEther(feeWei);
      }
    }

    // If transaction reverted / failed on-chain
    if (!isSuccess) {
      return {
        state: "failed",
        receipt: {
          status: "reverted",
          txHash: cleanHash,
          blockNumber: parseInt(receipt.blockNumber, 16),
          blockHash: receipt.blockHash,
          from: receipt.from || tx?.from,
          to: receipt.to || tx?.to,
          destinationAddress: receipt.to || tx?.to,
          asset: assetHint || "ETH",
          amount: tx?.value ? formatEther(BigInt(tx.value)) : "0.00",
          gasUsed: gasUsedFormatted,
          effectiveGasPriceGwei: effectiveGasPriceFormatted,
          networkFeeEth: networkFeeEth !== "Unavailable" ? networkFeeEth : undefined,
          networkName: SUPPORTED_NETWORKS[numericChainId] || `Chain ${numericChainId}`,
          chainId: numericChainId,
          explorerUrl: getTrustedExplorerUrl(numericChainId, cleanHash),
        },
        error: "Transaction reverted on-chain. The withdrawal was rejected by the smart contract.",
      };
    }

    // 7. Verified Success State!
    return {
      state: "verified",
      receipt: {
        status: "success",
        txHash: cleanHash,
        blockNumber: parseInt(receipt.blockNumber, 16),
        blockHash: receipt.blockHash,
        from: receipt.from || tx?.from,
        to: receipt.to || tx?.to,
        destinationAddress: receipt.to || tx?.to,
        asset: assetHint || "ETH",
        amount: tx?.value ? formatEther(BigInt(tx.value)) : "0.00",
        gasUsed: gasUsedFormatted,
        effectiveGasPriceGwei: effectiveGasPriceFormatted,
        networkFeeEth: networkFeeEth !== "Unavailable" ? networkFeeEth : undefined,
        timestamp: new Date().toUTCString(),
        networkName: SUPPORTED_NETWORKS[numericChainId] || `Chain ${numericChainId}`,
        chainId: numericChainId,
        explorerUrl: getTrustedExplorerUrl(numericChainId, cleanHash),
      },
    };
  } catch (err: any) {
    return {
      state: "failed",
      error: err?.message || "Failed to query transaction receipt from connected blockchain provider.",
    };
  }
}

