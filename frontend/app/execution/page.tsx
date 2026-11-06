"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Wallet,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";
import { ExecutionModeCard } from "@/components/ExecutionModeCard";
import { ModeComparison } from "@/components/ModeComparison";
import { cn } from "@/lib/utils";

function ExecutionParamsSync({
  onParams,
}: {
  onParams: (params: {
    asset: string;
    amount: string;
    source: string;
    destination: string;
    network: string;
    mode: "MIX" | "POOL" | null;
  }) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const asset = searchParams.get("asset") || "ETH";
    const amount = searchParams.get("amount") || "1.0";
    const source =
      searchParams.get("source") || "0x71C568a8F9B60471f54aC482C400cCE9C298B319";
    const destination =
      searchParams.get("destination") || "0x98bF32D034c568A9412F581b83F11A48809F32d1";
    const network = searchParams.get("network") || "Sepolia";
    const rawMode = searchParams.get("mode")?.toUpperCase();
    const mode = rawMode === "MIX" || rawMode === "POOL" ? rawMode : null;

    onParams({ asset, amount, source, destination, network, mode });
  }, [searchParams, onParams]);

  return null;
}

export default function ExecutionPage() {
  const router = useRouter();
  const { account, networkName } = useWallet();

  const [asset, setAsset] = useState<string>("ETH");
  const [amount, setAmount] = useState<string>("1.0");
  const [sourceAddress, setSourceAddress] = useState<string>(
    "0x71C568a8F9B60471f54aC482C400cCE9C298B319"
  );
  const [destinationAddress, setDestinationAddress] = useState<string>(
    "0x98bF32D034c568A9412F581b83F11A48809F32d1"
  );
  const [network, setNetwork] = useState<string>("Sepolia");

  const [selectedMode, setSelectedMode] = useState<"MIX" | "POOL" | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const handleSyncParams = useCallback(
    (params: {
      asset: string;
      amount: string;
      source: string;
      destination: string;
      network: string;
      mode: "MIX" | "POOL" | null;
    }) => {
      setAsset(params.asset);
      setAmount(params.amount);
      setSourceAddress(params.source);
      setDestinationAddress(params.destination);
      setNetwork(params.network);
      if (params.mode) {
        setSelectedMode(params.mode);
      }
    },
    []
  );

  const transferBackHref = `/transfer?asset=${encodeURIComponent(
    asset
  )}&amount=${encodeURIComponent(amount)}&source=${encodeURIComponent(
    sourceAddress
  )}&destination=${encodeURIComponent(destinationAddress)}`;

  const handleContinue = () => {
    if (!selectedMode || isNavigating) return;

    setIsNavigating(true);

    const queryParams = new URLSearchParams({
      asset,
      amount,
      source: sourceAddress,
      destination: destinationAddress,
      network: networkName || network,
      mode: selectedMode,
    }).toString();

    const targetRoute = selectedMode === "MIX" ? `/mix?${queryParams}` : `/pool?${queryParams}`;
    router.push(targetRoute);
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <ExecutionParamsSync onParams={handleSyncParams} />
      </Suspense>

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[#161B22]/90 backdrop-blur-md border-b border-[#232B36] py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 hover:opacity-90 transition-opacity focus:outline-none"
            >
              <Logo size={22} />
              <span className="font-sans font-bold tracking-[0.2em] text-xs sm:text-sm text-[#F0F4F8] uppercase">
                NONY
              </span>
            </Link>

            <span className="h-3.5 w-[1px] bg-[#232B36] hidden sm:inline-block" />

            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#232B36] text-[10px] font-mono text-[#3B82F6] tracking-wider uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3B82F6]" />
              </span>
              <span>PRIVATE SESSION</span>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 text-xs font-mono">
            <Link
              href="/#protocol"
              className="hidden md:inline-block text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              PROTOCOL
            </Link>

            {account ? (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] hover:border-[#3A4759] text-[#F0F4F8] text-xs transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] hover:border-[#3B82F6]/60 text-[#F0F4F8] font-medium text-xs transition-colors"
              >
                <Wallet size={12} className="text-[#3B82F6]" />
                <span>Connect Wallet</span>
              </button>
            )}

            <Link
              href={transferBackHref}
              className="inline-flex items-center gap-1.5 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors border-l border-[#232B36] pl-4"
              title="Return to Transfer Configuration"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">TRANSFER</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Progress Indicator */}
      <div className="border-b border-[#232B36] bg-[#12161D]">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between text-xs font-mono">
          <Link
            href="/deposit"
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px]">
              ✓
            </span>
            <span className="group-hover:underline underline-offset-4">1. DEPOSIT</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#232B36]" />

          <Link
            href={transferBackHref}
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px]">
              ✓
            </span>
            <span className="group-hover:underline underline-offset-4">2. TRANSFER</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#232B36]" />

          <div className="flex items-center gap-2 text-[#3B82F6]">
            <span className="w-5 h-5 rounded-full bg-[#1C222B] border border-[#3B82F6] flex items-center justify-center text-[10px] font-bold shadow-[0_0_8px_rgba(59,130,246,0.3)]">
              3
            </span>
            <span className="font-bold tracking-wider">3. EXECUTION</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {/* Context Summary Strip */}
        <div className="w-full mb-8 p-3.5 sm:p-4 rounded-xl bg-[#161B22] border border-[#232B36] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[#94A3B8]">
            <span className="text-[#505D6E] uppercase tracking-wider text-[10px]">
              Session Context:
            </span>
            <span className="text-[#F0F4F8] font-semibold">
              {amount} {asset}
            </span>
            <span className="text-[#232B36] hidden sm:inline">•</span>
            <span>
              From:{" "}
              <span className="text-[#F0F4F8]">
                {sourceAddress.slice(0, 6)}...{sourceAddress.slice(-4)}
              </span>
            </span>
            <span className="text-[#232B36] hidden sm:inline">•</span>
            <span>
              To:{" "}
              <span className="text-[#F0F4F8]">
                {destinationAddress.slice(0, 6)}...{destinationAddress.slice(-4)}
              </span>
            </span>
            <span className="text-[#232B36] hidden sm:inline">•</span>
            <span className="text-[#3B82F6] font-medium">
              {networkName || network}
            </span>
          </div>

          <Link
            href={transferBackHref}
            className="text-[11px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors inline-flex items-center gap-1 self-start sm:self-auto font-sans font-semibold"
          >
            <span>Edit Transfer</span>
            <ChevronRight size={12} />
          </Link>
        </div>

        {/* Page Intro */}
        <div className="w-full text-center max-w-2xl mb-10">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#3B82F6] uppercase mb-2">
            03 / EXECUTION STRATEGY
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F0F4F8] mb-3">
            Choose how you execute.
          </h1>
          <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
            Select the execution strategy that aligns with your transaction requirements.
            Your assets remain within the configured session until you proceed.
          </p>
        </div>

        {/* Cards */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
          <ExecutionModeCard
            mode="MIX"
            badge="PRIVATE EXECUTION"
            title="MIX"
            description="Designed for privacy-oriented asset movement through pooled execution."
            supportingText="Select MIX to enter the private pooling workflow. Review your stake allocation and session details before proceeding."
            features={[
              "Pooled execution workflow",
              "Private balance management",
              "Dedicated stake interface",
            ]}
            isSelected={selectedMode === "MIX"}
            onSelect={() => setSelectedMode("MIX")}
          />

          <ExecutionModeCard
            mode="POOL"
            badge="CONDITIONAL EXECUTION"
            title="POOL"
            description="Access the conditional exchange workflow for asset conversion."
            supportingText="Select POOL to configure an asset exchange, choose a market or limit execution strategy, and review the conditions before proceeding."
            features={[
              "ETH / USDC exchange interface",
              "Market execution",
              "Limit execution with configurable price conditions",
            ]}
            isSelected={selectedMode === "POOL"}
            onSelect={() => setSelectedMode("POOL")}
          />
        </div>

        {/* Comparison */}
        <ModeComparison
          selectedMode={selectedMode}
          onSelectMode={(mode) => setSelectedMode(mode)}
        />
      </main>

      {/* Sticky Bottom Actions */}
      <footer className="sticky bottom-0 z-30 bg-[#161B22]/95 backdrop-blur-md border-t border-[#232B36] py-4 px-4 sm:px-8 shadow-2xl">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            {selectedMode ? (
              <div className="space-y-0.5 animate-fade-in">
                <div className="text-[11px] font-mono uppercase tracking-wider text-[#3B82F6] flex items-center justify-center sm:justify-start gap-1.5 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
                  <span>SELECTED STRATEGY: {selectedMode}</span>
                  <span className="text-[#94A3B8] font-normal">
                    ({selectedMode === "MIX" ? "PRIVATE POOLING" : "CONDITIONAL EXCHANGE"})
                  </span>
                </div>
                <div className="text-xs text-[#94A3B8]">
                  Next destination:{" "}
                  <code className="text-[#F0F4F8] font-mono text-[11px] bg-[#1C222B] px-1.5 py-0.5 rounded border border-[#232B36]">
                    {selectedMode === "MIX" ? "/mix" : "/pool"}
                  </code>{" "}
                  • No blockchain transaction broadcast until final review.
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-mono text-[#94A3B8]">
                <AlertCircle size={14} className="text-[#505D6E]" />
                <span>Select an execution mode to continue.</span>
              </div>
            )}
          </div>

          <div className="w-full sm:w-auto flex items-center gap-3">
            <Link
              href={transferBackHref}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#232B36] bg-[#1C222B] hover:bg-[#232B36] text-xs font-mono text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              <ArrowLeft size={13} />
              <span>BACK</span>
            </Link>

            <button
              type="button"
              disabled={!selectedMode || isNavigating}
              onClick={handleContinue}
              className={cn(
                "w-full sm:w-auto min-w-[200px] py-3 px-6 rounded-xl font-mono text-xs font-bold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2",
                selectedMode && !isNavigating
                  ? "bg-[#3B82F6] text-white hover:bg-[#2563EB] shadow-[0_0_20px_rgba(59,130,246,0.25)] active:scale-[0.98] cursor-pointer"
                  : "bg-[#1C222B] text-[#505D6E] border border-[#232B36] cursor-not-allowed opacity-50"
              )}
            >
              {isNavigating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>PREPARING {selectedMode}...</span>
                </>
              ) : selectedMode ? (
                <>
                  <span>CONTINUE TO {selectedMode}</span>
                  <ArrowRight size={14} />
                </>
              ) : (
                <span>CONTINUE →</span>
              )}
            </button>
          </div>
        </div>
      </footer>

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </div>
  );
}
