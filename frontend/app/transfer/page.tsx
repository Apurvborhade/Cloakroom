"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  Copy,
  Check,
  AlertCircle,
  Wallet,
  ShieldCheck,
  Clipboard,
  X,
  CheckCircle2,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";
import { isAddress } from "viem";

// Helper component inside Suspense to sync query parameters without blocking page SSR
function SearchParamsSync({
  onParams,
}: {
  onParams: (asset: string, amount: string, source: string | null) => void;
}) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const a = searchParams.get("asset") || "ETH";
    const amt = searchParams.get("amount") || "1.0";
    const src = searchParams.get("source");
    onParams(a, amt, src);
  }, [searchParams, onParams]);
  return null;
}

export default function TransferPage() {
  const router = useRouter();
  const { account, chainId, networkName } = useWallet();

  // Transfer parameters (inherited from Screen 2 or defaults)
  const [asset, setAsset] = useState<string>("ETH");
  const [amount, setAmount] = useState<string>("1.0");
  const [paramSource, setParamSource] = useState<string | null>(null);

  const handleSyncParams = useCallback(
    (newAsset: string, newAmount: string, newSource: string | null) => {
      if (newAsset) setAsset(newAsset);
      if (newAmount) setAmount(newAmount);
      if (newSource) setParamSource(newSource);
    },
    []
  );

  // Default enclave session address
  const defaultEnclaveAddress = "0x71C568a8F9B60471f54aC482C400cCE9C298B319";
  const [sourceType, setSourceType] = useState<"enclave" | "wallet">("enclave");
  const [destinationAddress, setDestinationAddress] = useState<string>("");
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedDest, setCopiedDest] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  // Active source address
  const activeSourceAddress =
    sourceType === "enclave"
      ? paramSource || defaultEnclaveAddress
      : account || defaultEnclaveAddress;

  // Address validation
  const cleanDest = destinationAddress.trim();
  const hasEnteredDest = cleanDest.length > 0;
  const isDestValid = hasEnteredDest && isAddress(cleanDest);
  const isIdentical =
    isDestValid && cleanDest.toLowerCase() === activeSourceAddress.toLowerCase();

  const canContinue = isDestValid && !isIdentical && !isValidating;

  const handleCopy = (text: string, type: "source" | "dest") => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === "source") {
        setCopiedSource(true);
        setTimeout(() => setCopiedSource(false), 2000);
      } else {
        setCopiedDest(true);
        setTimeout(() => setCopiedDest(false), 2000);
      }
    }
  };

  const handlePaste = async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) setDestinationAddress(text.trim());
      } catch {
        // clipboard access declined
      }
    }
  };

  const handleUseConnectedWallet = () => {
    if (account) {
      setDestinationAddress(account);
    } else {
      setWalletModalOpen(true);
    }
  };

  const handleContinue = () => {
    if (!canContinue) return;
    setIsValidating(true);
    setTimeout(() => {
      setIsValidating(false);
      // Navigate to Screen 4 — Execution Mode Selection
      router.push(
        `/execution?asset=${encodeURIComponent(asset)}&amount=${encodeURIComponent(
          amount
        )}&source=${encodeURIComponent(activeSourceAddress)}&destination=${encodeURIComponent(
          cleanDest
        )}`
      );
    }, 450);
  };

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
      {/* Search Params Sync boundary */}
      <Suspense fallback={null}>
        <SearchParamsSync onParams={handleSyncParams} />
      </Suspense>

      {/* 3. Compact Top Navigation Header */}
      <header className="sticky top-0 z-30 bg-[#0C0C0C]/90 backdrop-blur-md border-b border-[#292930] py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Left: Brand + Private Session Indicator */}
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

          {/* Right: Protocol, Docs, Wallet Connection */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs font-mono">
            <Link
              href="/#protocol"
              className="hidden md:inline-block text-[#92929B] hover:text-[#F5F5F7] transition-colors"
            >
              PROTOCOL
            </Link>
            <a
              href="https://github.com/Apurvborhade/Cloakroom/tree/main/docs"
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
              href="/deposit"
              className="inline-flex items-center gap-1.5 text-[#92929B] hover:text-[#F5F5F7] transition-colors border-l border-[#292930] pl-4"
              title="Return to deposit setup"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">DEPOSIT</span>
            </Link>
          </div>
        </div>
      </header>

      {/* 3. Compact Three-Step Progress Indicator */}
      <div className="border-b border-[#1C1C24] bg-[#0C0C0C]/60">
        <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center justify-between text-xs font-mono">
          {/* Step 1: Completed */}
          <Link
            href="/deposit"
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors group"
          >
            <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px]">
              ✓
            </span>
            <span className="font-medium tracking-wide">1. DEPOSIT</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#292930]" />

          {/* Step 2: Active */}
          <div className="flex items-center gap-2 text-[#A6DCF8]">
            <span className="w-5 h-5 rounded-full bg-[#1E1E26] border border-[#A6DCF8] flex items-center justify-center text-[10px] font-semibold shadow-[0_0_8px_rgba(166,220,248,0.2)]">
              2
            </span>
            <span className="font-semibold tracking-wide">2. TRANSFER</span>
          </div>

          <div className="h-[1px] w-8 sm:w-16 bg-[#292930]" />

          {/* Step 3: Upcoming */}
          <div className="flex items-center gap-2 text-[#666670]">
            <span className="w-5 h-5 rounded-full bg-[#141418] border border-[#202026] flex items-center justify-center text-[10px]">
              3
            </span>
            <span className="tracking-wide">3. EXECUTION MODE</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center items-center py-10 sm:py-14 px-4 sm:px-6 w-full max-w-[680px] mx-auto animate-fade-in">

        {/* 4. Page Introduction */}
        <div className="w-full text-left mb-6">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#92929B] uppercase mb-1.5">
            02 / TRANSFER CONFIGURATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7]">
            Where should your assets move?
          </h1>
          <p className="text-sm text-[#92929B] mt-1.5 leading-relaxed">
            Configure the source and destination of your private transfer before selecting an execution strategy.
          </p>
        </div>

        {/* 5. Main Transfer Configuration Card */}
        <div className="w-full rounded-[18px] bg-[#141418] border border-[#292930] p-6 sm:p-8 shadow-2xl relative">

          {/* 5.A SOURCE ADDRESS */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-mono font-semibold tracking-wider text-[#F5F5F7] uppercase">
                SOURCE ADDRESS
              </label>
              {account && (
                <div className="flex items-center gap-1 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setSourceType("enclave")}
                    className={`px-2 py-0.5 rounded transition-colors ${sourceType === "enclave"
                      ? "bg-[#1E1E26] text-[#A6DCF8] border border-[#A6DCF8]/30"
                      : "text-[#666670] hover:text-[#92929B]"
                      }`}
                  >
                    Enclave Session
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType("wallet")}
                    className={`px-2 py-0.5 rounded transition-colors ${sourceType === "wallet"
                      ? "bg-[#1E1E26] text-[#A6DCF8] border border-[#A6DCF8]/30"
                      : "text-[#666670] hover:text-[#92929B]"
                      }`}
                  >
                    My Wallet
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-[#92929B] mb-3">
              Select the address holding your deposited assets.
            </p>

            {/* Source Address Box */}
            <div className="p-3.5 rounded-xl bg-[#18181D] border border-[#292930] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#141418] border border-[#252530] flex items-center justify-center text-[#A6DCF8] shrink-0">
                  <ShieldCheck size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-[#F5F5F7] font-medium truncate select-all">
                      {activeSourceAddress}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#141418] border border-[#252530] text-[#A6DCF8] uppercase shrink-0">
                      {sourceType === "enclave" ? "TEE Custody" : "Origin Wallet"}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#666670] flex items-center gap-2 mt-0.5">
                    <span>Balance: {amount} {asset}</span>
                    <span>•</span>
                    <span className="text-emerald-400">Verified</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(activeSourceAddress, "source")}
                className="p-2 rounded-lg hover:bg-[#1E1E26] text-[#92929B] hover:text-[#F5F5F7] transition-colors shrink-0"
                title="Copy Source Address"
              >
                {copiedSource ? (
                  <Check size={15} className="text-emerald-400" />
                ) : (
                  <Copy size={15} />
                )}
              </button>
            </div>
          </div>

          {/* 5.B Minimal Directional Indicator (SOURCE ↓ DESTINATION) */}
          <div className="relative flex items-center justify-center my-4">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[1px] h-full bg-[#292930]" />
            </div>
            <div className="relative z-10 px-3 py-1 rounded-full bg-[#18181D] border border-[#292930] flex items-center gap-1.5 text-[10px] font-mono text-[#92929B] shadow-sm">
              <span>TRANSFER DIRECTION</span>
              <ArrowDown size={11} className="text-[#A6DCF8]" />
            </div>
          </div>

          {/* 5.C DESTINATION ADDRESS */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-mono font-semibold tracking-wider text-[#F5F5F7] uppercase">
                DESTINATION ADDRESS
              </label>
              {account && account.toLowerCase() !== activeSourceAddress.toLowerCase() && (
                <button
                  type="button"
                  onClick={handleUseConnectedWallet}
                  className="text-[11px] font-mono text-[#A6DCF8] hover:underline"
                >
                  Use connected wallet
                </button>
              )}
            </div>
            <p className="text-xs text-[#92929B] mb-3">
              Enter the address where you want to receive your assets.
            </p>

            {/* Destination Input Box */}
            <div
              className={`relative rounded-xl bg-[#0C0C0C] border transition-colors ${isIdentical
                ? "border-red-500/80 focus-within:border-red-500"
                : hasEnteredDest && !isDestValid
                  ? "border-red-500/80 focus-within:border-red-500"
                  : isDestValid
                    ? "border-emerald-500/60 focus-within:border-emerald-500"
                    : "border-[#292930] focus-within:border-[#A6DCF8]"
                }`}
            >
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter destination wallet address (0x...)"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                className="w-full bg-transparent px-4 py-3.5 text-sm font-mono text-[#F5F5F7] placeholder-[#666670] outline-none pr-24"
              />

              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-mono">
                {hasEnteredDest && (
                  <button
                    type="button"
                    onClick={() => setDestinationAddress("")}
                    className="p-1.5 rounded hover:bg-[#18181D] text-[#92929B] hover:text-[#F5F5F7] transition-colors"
                    title="Clear input"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePaste}
                  className="px-2.5 py-1 rounded bg-[#18181D] hover:bg-[#202028] border border-[#292930] text-[11px] text-[#A6DCF8] transition-colors flex items-center gap-1"
                >
                  <Clipboard size={11} />
                  <span>PASTE</span>
                </button>
              </div>
            </div>

            {/* Validation Feedback Messages */}
            {isIdentical && (
              <div className="flex items-start gap-1.5 mt-2 text-xs text-red-400 font-mono">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Destination cannot be identical to source address. Private execution requires a distinct recipient to decouple on-chain ownership.
                </span>
              </div>
            )}
            {!isIdentical && hasEnteredDest && !isDestValid && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-red-400 font-mono">
                <AlertCircle size={14} />
                <span>Invalid Ethereum address format (must be 42-character 0x hex).</span>
              </div>
            )}
            {!isIdentical && isDestValid && (
              <div className="flex items-center justify-between mt-2 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>Valid EVM destination address</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(cleanDest, "dest")}
                  className="text-[11px] text-[#92929B] hover:text-[#F5F5F7] flex items-center gap-1"
                >
                  {copiedDest ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedDest ? "Copied" : "Copy"}</span>
                </button>
              </div>
            )}
          </div>

          {/* 5.D Network Information Row */}
          <div className="p-3.5 rounded-xl bg-[#0C0C0C] border border-[#202026] mb-6 font-mono text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
              <div>
                <div className="text-[10px] uppercase text-[#666670] mb-0.5">Network</div>
                <div className="text-[#F5F5F7] truncate">{networkName}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#666670] mb-0.5">Chain ID</div>
                <div className="text-[#F5F5F7]">{chainId || "11155111"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#666670] mb-0.5">Native Asset</div>
                <div className="text-[#A6DCF8] font-semibold">{asset}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#666670] mb-0.5">Layer Compatibility</div>
                <div className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>EVM Compatible</span>
                </div>
              </div>
            </div>
          </div>

          {/* 6. TRANSFER SUMMARY */}
          <div className="p-4 rounded-xl bg-[#18181D] border border-[#292930] mb-6 font-mono text-xs space-y-2">
            <div className="text-[10px] uppercase text-[#92929B] tracking-wider mb-1 font-semibold">
              Transfer Summary
            </div>
            <div className="flex items-center justify-between text-[#92929B]">
              <span>Source:</span>
              <span className="text-[#F5F5F7] select-all">
                {activeSourceAddress.slice(0, 8)}...{activeSourceAddress.slice(-6)}
              </span>
            </div>
            <div className="h-[1px] bg-[#202028]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>Destination:</span>
              <span className={isDestValid ? "text-[#F5F5F7] select-all" : "text-[#666670]"}>
                {isDestValid
                  ? `${cleanDest.slice(0, 8)}...${cleanDest.slice(-6)}`
                  : "Awaiting valid address"}
              </span>
            </div>
            <div className="h-[1px] bg-[#202028]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>Asset & Amount:</span>
              <span className="text-[#A6DCF8] font-semibold">
                {amount} {asset}
              </span>
            </div>
            <div className="h-[1px] bg-[#202028]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>Network:</span>
              <span className="text-[#F5F5F7]">{networkName}</span>
            </div>
          </div>

          {/* 7. Primary Action Button */}
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className={`w-full py-4 rounded-full font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg ${canContinue
              ? "bg-[#F5F5F7] text-[#0C0C0C] hover:bg-white active:scale-[0.99] shadow-[0_0_24px_rgba(245,245,247,0.15)] hover:shadow-[0_0_32px_rgba(166,220,248,0.3)] cursor-pointer"
              : "bg-[#18181D] text-[#666670] border border-[#292930] cursor-not-allowed opacity-60"
              }`}
          >
            {isValidating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-[#0C0C0C] border-t-transparent rounded-full animate-spin" />
                <span>VALIDATING CONFIGURATION...</span>
              </>
            ) : (
              <>
                <span>CONTINUE TO EXECUTION</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>

          {/* 8. Secondary Action: Back to Deposit */}
          <div className="mt-4 text-center">
            <Link
              href="/deposit"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-[#92929B] hover:text-[#F5F5F7] transition-colors"
            >
              <ArrowLeft size={12} />
              <span>BACK TO DEPOSIT</span>
            </Link>
          </div>

        </div>

        {/* Supporting Security Metadata */}
        <div className="w-full mt-6 text-center">
          <p className="text-[11px] font-mono text-[#666670] leading-relaxed">
            Transfer configuration is sealed locally. Execution parameters (MIX or POOL) will be chosen on the next screen.
          </p>
        </div>

      </main>

      {/* Wallet Connection Modal */}
      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onConnect={() => setWalletModalOpen(false)}
      />
    </div>
  );
}
