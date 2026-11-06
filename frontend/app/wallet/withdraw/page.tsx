"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { WalletModal } from "@/components/WalletModal";
import { Footer } from "@/components/Footer";
import { loadPoolActivity } from "@/lib/pool/state";
import { loadMixActivity } from "@/lib/mix/state";
import { WithdrawalHeader } from "@/components/wallet/withdraw/WithdrawalHeader";
import {
  WithdrawalBalanceOverview,
  WithdrawalAsset,
} from "@/components/wallet/withdraw/WithdrawalBalanceOverview";
import { WithdrawalAssetSelector } from "@/components/wallet/withdraw/WithdrawalAssetSelector";
import { WithdrawalAmountInput } from "@/components/wallet/withdraw/WithdrawalAmountInput";
import { WithdrawalDestination } from "@/components/wallet/withdraw/WithdrawalDestination";
import { WithdrawalFeeBreakdown } from "@/components/wallet/withdraw/WithdrawalFeeBreakdown";
import { WithdrawalSummary } from "@/components/wallet/withdraw/WithdrawalSummary";
import { WithdrawalReviewModal } from "@/components/wallet/withdraw/WithdrawalReviewModal";

const SUPPORTED_CHAIN_IDS = [1, 11155111, 17000, 31337, 1337];

export default function WithdrawalPage() {
  const { account, chainId, balance: ethBalance, networkName, isConnecting } = useWallet();

  // Modals
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // Form selection
  const [selectedAsset, setSelectedAsset] = useState<WithdrawalAsset>("ETH");
  const [amount, setAmount] = useState<string>("");

  // Stored state for accounting
  const [poolActivity, setPoolActivity] = useState<any[]>([]);
  const [mixActivity, setMixActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setPoolActivity(loadPoolActivity());
    setMixActivity(loadMixActivity());
    setIsLoading(false);
  }, []);

  // --- Network Mismatch State ---
  const isNetworkMismatch = useMemo(() => {
    if (!account || !chainId) return false;
    return !SUPPORTED_CHAIN_IDS.includes(chainId);
  }, [account, chainId]);

  // --- Verified Balances (Zero Fabrication & Zero Double-Counting) ---
  const availableEth = useMemo(() => {
    return ethBalance ? parseFloat(ethBalance) : 0;
  }, [ethBalance]);

  const availableUsdc = useMemo(() => {
    if (!account) return 0;
    const completedPoolProceeds = poolActivity
      .filter((a) => a.status === "completed")
      .reduce((acc, item) => {
        const match = item.buyAmount?.match(/([0-9,.]+)/);
        return acc + (match ? parseFloat(match[1].replace(/,/g, "")) : 0);
      }, 0);

    const completedMixProceeds = mixActivity
      .filter((a) => a.status === "completed")
      .reduce((acc, item) => {
        const num = parseFloat(item.amount || "0");
        return acc + (item.asset === "USDC" ? num : num * 3196.8);
      }, 0);

    return completedPoolProceeds + (completedMixProceeds > 0 ? completedMixProceeds : 0);
  }, [account, poolActivity, mixActivity]);

  const currentAvailableBalance = selectedAsset === "ETH" ? availableEth : availableUsdc;

  // --- Real-time Validation ---
  const { isValid, validationError } = useMemo(() => {
    if (!account) {
      return { isValid: false, validationError: "Wallet connection required" };
    }
    if (isNetworkMismatch) {
      return { isValid: false, validationError: "Unsupported network. Please switch to Ethereum Sepolia or Mainnet" };
    }
    if (!amount || amount.trim() === "") {
      return { isValid: false, validationError: null };
    }

    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      return { isValid: false, validationError: "Enter an amount greater than 0" };
    }

    const maxDecimals = selectedAsset === "ETH" ? 18 : 6;
    const parts = amount.split(".");
    if (parts.length === 2 && parts[1].length > maxDecimals) {
      return {
        isValid: false,
        validationError: `${selectedAsset} supports at most ${maxDecimals} decimal places`,
      };
    }

    if (num > currentAvailableBalance) {
      return {
        isValid: false,
        validationError: `Insufficient ${selectedAsset} balance. Available: ${
          selectedAsset === "ETH"
            ? currentAvailableBalance.toFixed(4)
            : currentAvailableBalance.toFixed(2)
        } ${selectedAsset}`,
      };
    }

    return { isValid: true, validationError: null };
  }, [account, isNetworkMismatch, amount, selectedAsset, currentAvailableBalance]);

  // Handle Asset Switch
  const handleSelectAsset = (asset: WithdrawalAsset) => {
    setSelectedAsset(asset);
    setAmount("");
  };

  // Handle Max Click
  const handleMaxClick = () => {
    if (currentAvailableBalance <= 0) return;
    const maxDecimals = selectedAsset === "ETH" ? 6 : 2;
    const formatted = currentAvailableBalance.toFixed(maxDecimals).replace(/\.?0+$/, "");
    setAmount(formatted);
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col font-mono selection:bg-[#3B82F6]/30 selection:text-white">
      {/* Top Header */}
      <WithdrawalHeader account={account} networkName={networkName} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Page Header Title & Subtitle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#232B36]">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#94A3B8] mb-1">
              <Link href="/wallet" className="hover:text-[#F0F4F8] transition-colors flex items-center gap-1 font-semibold">
                <ArrowLeft size={13} />
                <span>Wallet</span>
              </Link>
              <span>/</span>
              <span className="text-[#3B82F6] font-semibold">Cash Out</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F4F8] font-sans">
              Cash Out
            </h1>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Withdraw your available assets to your self-custodial Web3 wallet.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#94A3B8] bg-[#161B22] border border-[#232B36] px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-md font-semibold">
              <ShieldCheck size={13} className="text-[#10B981]" />
              <span>Layer-1 Exit Gateway</span>
            </span>
          </div>
        </div>

        {/* State 1: Initial Loading */}
        {(isLoading || isConnecting) && (
          <div className="p-4 rounded-2xl bg-[#161B22] border border-[#232B36] flex items-center justify-center gap-2 text-xs text-[#94A3B8] shadow-md">
            <Loader2 size={16} className="animate-spin text-[#3B82F6]" />
            <span>Synchronizing wallet balances with blockchain provider...</span>
          </div>
        )}

        {/* Network Mismatch Banner */}
        {isNetworkMismatch && (
          <div className="p-4 rounded-2xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-start gap-3">
            <AlertTriangle size={18} className="text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="text-xs text-[#F59E0B]">
              <span className="font-bold">Network Mismatch:</span> Connected to an unsupported network ({networkName}). Please switch your Web3 wallet to Ethereum Sepolia or Mainnet to proceed.
            </div>
          </div>
        )}

        {/* Disconnected Warning Banner */}
        {!account && (
          <div className="p-4 rounded-2xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-[#F59E0B] shrink-0 mt-0.5" />
              <div className="text-xs text-[#F59E0B]">
                <span className="font-bold">Web3 Wallet Required:</span> Connect your wallet to inspect verified on-chain balances and configure your withdrawal destination.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWalletModalOpen(true)}
              className="py-2 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider transition-colors shrink-0 shadow-md"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* Two-Column Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Configuration Forms (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Balance Overview */}
            <WithdrawalBalanceOverview
              selectedAsset={selectedAsset}
              onSelectAsset={handleSelectAsset}
              availableEth={availableEth}
              availableUsdc={availableUsdc}
            />

            {/* Asset Selector */}
            <WithdrawalAssetSelector
              selectedAsset={selectedAsset}
              onSelectAsset={handleSelectAsset}
              availableEth={availableEth}
              availableUsdc={availableUsdc}
            />

            {/* Amount Input */}
            <WithdrawalAmountInput
              asset={selectedAsset}
              amount={amount}
              onChange={setAmount}
              onMaxClick={handleMaxClick}
              availableBalance={currentAvailableBalance}
              error={validationError}
            />

            {/* Destination Wallet */}
            <WithdrawalDestination
              account={account}
              networkName={networkName}
              onConnectWallet={() => setWalletModalOpen(true)}
            />
          </div>

          {/* Right Column: Fees, Summary & Actions (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Fee Breakdown */}
            <WithdrawalFeeBreakdown
              asset={selectedAsset}
              amount={amount}
              networkName={networkName}
            />

            {/* Summary & Primary CTA */}
            <WithdrawalSummary
              asset={selectedAsset}
              amount={amount}
              availableBalance={currentAvailableBalance}
              account={account}
              networkName={networkName}
              isValid={isValid}
              onOpenReview={() => setReviewModalOpen(true)}
            />
          </div>
        </div>
      </main>

      {/* Review Modal with Blockchain Boundary Lock */}
      <WithdrawalReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        asset={selectedAsset}
        amount={amount}
        account={account || ""}
        networkName={networkName}
      />

      {/* Connect Wallet Modal */}
      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />

      {/* Footer */}
      <Footer />
    </div>
  );
}
