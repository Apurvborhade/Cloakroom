"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Wallet,
  AlertCircle,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";
import { ExecutionModeCard } from "@/components/ExecutionModeCard";
import { ModeComparison } from "@/components/ModeComparison";
import { cn } from "@/lib/utils";

// Helper component inside Suspense to sync query parameters without blocking page SSR
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

  // Transfer parameters carried from Screen 3
  const [asset, setAsset] = useState<string>("ETH");
  const [amount, setAmount] = useState<string>("1.0");
  const [sourceAddress, setSourceAddress] = useState<string>(
    "0x71C568a8F9B60471f54aC482C400cCE9C298B319"
  );
  const [destinationAddress, setDestinationAddress] = useState<string>(
    "0x98bF32D034c568A9412F581b83F11A48809F32d1"
  );
  const [network, setNetwork] = useState<string>("Sepolia");

  // Screen 4 Core State: Mode Selection
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
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
      {/* Parameter sync boundary */}
      <Suspense fallback={null}>
        <ExecutionParamsSync onParams={handleSyncParams} />
      </Suspense>

      {/* 1. Top Navigation Header */}
      <header className="sticky top-0 z-30 bg-[#0C0C0C]/90 backdrop-blur-md border-b border-[#292930] py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Brand + Private Session Indicator */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 hover:opacity-90 transition-opacity focus:outline-none"
            >
              <Logo size={22} />
              <span className="font-sans font-semibold tracking-[0.2em] text-xs sm:text-sm text-[#F5F5F7] uppercase">
                CLOAKROOM
              </span>
            </Link>

            <span className="h-3.5 w-[1px] bg-[#292930] hidden sm:inline-block" />

            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#141418] border border-[#292930] text-[10px] font-mono text-[#A6DCF8] tracking-wider uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A6DCF8] opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#A6DCF8]" />
              </span>
              <span>PRIVATE SESSION</span>
            </div>
          </div>

          {/* Right Links & Wallet */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs font-mono">
            <Link
              href="/#protocol"
              className="hidden md:inline-block text-[#92929B] hover:text-[#F5F5F7] transition-colors"
            >
              PROTOCOL
            </Link>
            <a
              href="https://github.com/Apurvborhade/Cloakroom/blob/main/docs/litepaper.md"
              target="_blank"
              rel="noreferrer"
              className="hidden md:inline-block text-[#92929B] hover:text-[#F5F5F7] transition-colors"
            >
              DOCUMENTATION
            </a>

            {account ? (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#141418] border border-[#292930] hover:border-[#3A3A46] text-[#F5F5F7] text-xs transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141418] border border-[#3A3A46] hover:border-[#A6DCF8]/60 text-[#F5F5F7] font-medium text-xs transition-colors"
              >
                <Wallet size={12} className="text-[#A6DCF8]" />
                <span>Connect Wallet</span>
              </button>
            )}

            <Link
              href={transferBackHref}
              className="inline-flex items-center gap-1.5 text-[#92929B] hover:text-[#F5F5F7] transition-colors border-l border-[#292930] pl-4"
              title="Return to Transfer Configuration"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">TRANSFER</span>
            </Link>
          </div>
        </div>
      </header>

      {/* 2. Three-Step Progress Indicator */}
      <div className="border-b border-[#1C1C24] bg-[#0C0C0C]/60">
        <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center justify-between text-xs font-mono">
          {/* Step 1: Deposit (Completed) */}
          <Link
            href="/deposit"
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px]">
              ✓
            </span>
            <span className="group-hover:underline underline-offset-4">1. DEPOSIT</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#292930]" />

          {/* Step 2: Transfer (Completed) */}
          <Link
            href={transferBackHref}
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px]">
              ✓
            </span>
            <span className="group-hover:underline underline-offset-4">2. TRANSFER</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#292930]" />

          {/* Step 3: Execution (Active) */}
          <div className="flex items-center gap-2 text-[#A6DCF8]">
            <span className="w-5 h-5 rounded-full bg-[#1E1E26] border border-[#A6DCF8] flex items-center justify-center text-[10px] font-semibold shadow-[0_0_8px_rgba(166,220,248,0.3)]">
              3
            </span>
            <span className="font-semibold tracking-wider">3. EXECUTION</span>
          </div>
        </div>
      </div>

      {/* 3. Main Decision Area */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {/* Context Summary Strip */}
        <div className="w-full mb-8 p-3.5 sm:p-4 rounded-xl bg-[#141418] border border-[#292930] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[#92929B]">
            <span className="text-[#666670] uppercase tracking-wider text-[10px]">
              Session Context:
            </span>
            <span className="text-[#F5F5F7] font-semibold">
              {amount} {asset}
            </span>
            <span className="text-[#292930] hidden sm:inline">•</span>
            <span>
              From:{" "}
              <span className="text-[#F5F5F7]">
                {sourceAddress.slice(0, 6)}...{sourceAddress.slice(-4)}
              </span>
            </span>
            <span className="text-[#292930] hidden sm:inline">•</span>
            <span>
              To:{" "}
              <span className="text-[#F5F5F7]">
                {destinationAddress.slice(0, 6)}...{destinationAddress.slice(-4)}
              </span>
            </span>
            <span className="text-[#292930] hidden sm:inline">•</span>
            <span className="text-[#A6DCF8]">
              {networkName || network}
            </span>
          </div>

          <Link
            href={transferBackHref}
            className="text-[11px] text-[#A6DCF8] hover:text-[#BDE7FC] transition-colors inline-flex items-center gap-1 self-start sm:self-auto font-sans"
          >
            <span>Edit Transfer</span>
            <ChevronRight size={12} />
          </Link>
        </div>

        {/* Page Introduction */}
        <div className="w-full text-center max-w-2xl mb-10">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#92929B] uppercase mb-2">
            03 / EXECUTION STRATEGY
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F5F5F7] mb-3">
            Choose how you execute.
          </h1>
          <p className="text-xs sm:text-sm text-[#92929B] leading-relaxed">
            Select the execution strategy that aligns with your transaction requirements.
            Your assets remain within the configured session until you proceed.
          </p>
        </div>

        {/* Mode Selection Cards: Side by Side on Desktop */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
          {/* Option A: MIX */}
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

          {/* Option B: POOL */}
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

        {/* Mode Comparison Matrix */}
        <ModeComparison
          selectedMode={selectedMode}
          onSelectMode={(mode) => setSelectedMode(mode)}
        />
      </main>

      {/* 4. Persistent Bottom Action Area */}
      <footer className="sticky bottom-0 z-30 bg-[#0C0C0C]/95 backdrop-blur-md border-t border-[#292930] py-4 px-4 sm:px-8 shadow-2xl shadow-black">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left Status info */}
          <div className="text-center sm:text-left">
            {selectedMode ? (
              <div className="space-y-0.5 animate-fade-in">
                <div className="text-[11px] font-mono uppercase tracking-wider text-[#A6DCF8] flex items-center justify-center sm:justify-start gap-1.5 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8] animate-pulse" />
                  <span>SELECTED STRATEGY: {selectedMode}</span>
                  <span className="text-[#666670] font-normal">
                    ({selectedMode === "MIX" ? "PRIVATE POOLING" : "CONDITIONAL EXCHANGE"})
                  </span>
                </div>
                <div className="text-xs text-[#92929B]">
                  Next destination:{" "}
                  <code className="text-[#F5F5F7] font-mono text-[11px]">
                    {selectedMode === "MIX" ? "/mix" : "/pool"}
                  </code>{" "}
                  • No blockchain transaction broadcast until final review.
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-mono text-[#92929B]">
                <AlertCircle size={14} className="text-[#666670]" />
                <span>Select an execution mode to continue.</span>
              </div>
            )}
          </div>

          {/* Right Action Button */}
          <div className="w-full sm:w-auto flex items-center gap-3">
            <Link
              href={transferBackHref}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#292930] bg-[#141418] hover:bg-[#18181D] text-xs font-mono text-[#92929B] hover:text-[#F5F5F7] transition-colors"
            >
              <ArrowLeft size={13} />
              <span>BACK</span>
            </Link>

            <button
              type="button"
              disabled={!selectedMode || isNavigating}
              onClick={handleContinue}
              className={cn(
                "w-full sm:w-auto min-w-[200px] py-3 px-6 rounded-xl font-mono text-xs font-semibold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2",
                selectedMode && !isNavigating
                  ? "bg-[#A6DCF8] text-[#0C0C0C] hover:bg-[#BDE7FC] shadow-[0_0_20px_rgba(166,220,248,0.25)] active:scale-[0.98] cursor-pointer"
                  : "bg-[#18181D] text-[#666670] border border-[#292930] cursor-not-allowed opacity-50"
              )}
            >
              {isNavigating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[#0C0C0C] border-t-transparent rounded-full animate-spin" />
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

      {/* Wallet Connection Modal */}
      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </div>
  );
}
