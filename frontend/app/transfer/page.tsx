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

  const defaultEnclaveAddress = "0x71C568a8F9B60471f54aC482C400cCE9C298B319";
  const [sourceType, setSourceType] = useState<"enclave" | "wallet">("enclave");
  const [destinationAddress, setDestinationAddress] = useState<string>("");
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedDest, setCopiedDest] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const activeSourceAddress =
    sourceType === "enclave"
      ? paramSource || defaultEnclaveAddress
      : account || defaultEnclaveAddress;

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
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <SearchParamsSync onParams={handleSyncParams} />
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
              href="/deposit"
              className="inline-flex items-center gap-1.5 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors border-l border-[#232B36] pl-4"
              title="Return to deposit setup"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">DEPOSIT</span>
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
            <span className="font-medium tracking-wide">1. DEPOSIT</span>
          </Link>

          <div className="h-[1px] w-8 sm:w-16 bg-[#232B36]" />

          <div className="flex items-center gap-2 text-[#3B82F6]">
            <span className="w-5 h-5 rounded-full bg-[#1C222B] border border-[#3B82F6] flex items-center justify-center text-[10px] font-bold shadow-[0_0_8px_rgba(59,130,246,0.3)]">
              2
            </span>
            <span className="font-bold tracking-wide">2. TRANSFER</span>
          </div>

          <div className="h-[1px] w-8 sm:w-16 bg-[#232B36]" />

          <div className="flex items-center gap-2 text-[#505D6E]">
            <span className="w-5 h-5 rounded-full bg-[#161B22] border border-[#232B36] flex items-center justify-center text-[10px]">
              3
            </span>
            <span className="tracking-wide">3. EXECUTION MODE</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center items-center py-10 sm:py-14 px-4 sm:px-6 w-full max-w-[680px] mx-auto animate-fade-in">
        <div className="w-full text-left mb-6">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#3B82F6] uppercase mb-1.5">
            02 / TRANSFER CONFIGURATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8]">
            Where should your assets move?
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1.5 leading-relaxed">
            Configure the source and destination of your private transfer before selecting an execution strategy.
          </p>
        </div>

        {/* Card */}
        <div className="w-full rounded-2xl bg-[#161B22] border border-[#232B36] p-6 sm:p-8 shadow-2xl relative">
          {/* Source Address */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-mono font-semibold tracking-wider text-[#F0F4F8] uppercase">
                SOURCE ADDRESS
              </label>
              {account && (
                <div className="flex items-center gap-1 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setSourceType("enclave")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      sourceType === "enclave"
                        ? "bg-[#1C222B] text-[#3B82F6] border border-[#3B82F6]/30 font-semibold"
                        : "text-[#505D6E] hover:text-[#94A3B8]"
                    }`}
                  >
                    Enclave Session
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType("wallet")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      sourceType === "wallet"
                        ? "bg-[#1C222B] text-[#3B82F6] border border-[#3B82F6]/30 font-semibold"
                        : "text-[#505D6E] hover:text-[#94A3B8]"
                    }`}
                  >
                    My Wallet
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-[#94A3B8] mb-3">
              Select the address holding your deposited assets.
            </p>

            <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#0F1318] border border-[#232B36] flex items-center justify-center text-[#3B82F6] shrink-0">
                  <ShieldCheck size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-[#F0F4F8] font-medium truncate select-all">
                      {activeSourceAddress}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0F1318] border border-[#232B36] text-[#3B82F6] uppercase shrink-0 font-medium">
                      {sourceType === "enclave" ? "TEE Custody" : "Origin Wallet"}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8] flex items-center gap-2 mt-0.5">
                    <span>Balance: {amount} {asset}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-medium">Verified</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(activeSourceAddress, "source")}
                className="p-2 rounded-lg hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors shrink-0"
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

          {/* Direction */}
          <div className="relative flex items-center justify-center my-4">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[1px] h-full bg-[#232B36]" />
            </div>
            <div className="relative z-10 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center gap-1.5 text-[10px] font-mono text-[#94A3B8] shadow-sm">
              <span>TRANSFER DIRECTION</span>
              <ArrowDown size={11} className="text-[#3B82F6]" />
            </div>
          </div>

          {/* Destination */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-mono font-semibold tracking-wider text-[#F0F4F8] uppercase">
                DESTINATION ADDRESS
              </label>
              {account && account.toLowerCase() !== activeSourceAddress.toLowerCase() && (
                <button
                  type="button"
                  onClick={handleUseConnectedWallet}
                  className="text-[11px] font-mono text-[#3B82F6] hover:underline"
                >
                  Use connected wallet
                </button>
              )}
            </div>
            <p className="text-xs text-[#94A3B8] mb-3">
              Enter the address where you want to receive your assets.
            </p>

            <div
              className={`relative rounded-xl bg-[#0F1318] border transition-colors ${
                isIdentical
                  ? "border-red-500/80 focus-within:border-red-500"
                  : hasEnteredDest && !isDestValid
                  ? "border-red-500/80 focus-within:border-red-500"
                  : isDestValid
                  ? "border-emerald-500/60 focus-within:border-emerald-500"
                  : "border-[#232B36] focus-within:border-[#3B82F6]"
              }`}
            >
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter destination wallet address (0x...)"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                className="w-full bg-transparent px-4 py-3.5 text-sm font-mono text-[#F0F4F8] placeholder-[#505D6E] outline-none pr-24"
              />

              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-mono">
                {hasEnteredDest && (
                  <button
                    type="button"
                    onClick={() => setDestinationAddress("")}
                    className="p-1.5 rounded hover:bg-[#1C222B] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
                    title="Clear input"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePaste}
                  className="px-2.5 py-1 rounded bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[11px] text-[#3B82F6] transition-colors flex items-center gap-1 font-semibold"
                >
                  <Clipboard size={11} />
                  <span>PASTE</span>
                </button>
              </div>
            </div>

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
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle2 size={13} />
                  <span>Valid EVM destination address</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(cleanDest, "dest")}
                  className="text-[11px] text-[#94A3B8] hover:text-[#F0F4F8] flex items-center gap-1"
                >
                  {copiedDest ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedDest ? "Copied" : "Copy"}</span>
                </button>
              </div>
            )}
          </div>

          {/* Network Info */}
          <div className="p-3.5 rounded-xl bg-[#0F1318] border border-[#232B36] mb-6 font-mono text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
              <div>
                <div className="text-[10px] uppercase text-[#505D6E] mb-0.5">Network</div>
                <div className="text-[#F0F4F8] truncate">{networkName}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#505D6E] mb-0.5">Chain ID</div>
                <div className="text-[#F0F4F8]">{chainId || "11155111"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#505D6E] mb-0.5">Native Asset</div>
                <div className="text-[#3B82F6] font-semibold">{asset}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-[#505D6E] mb-0.5">Layer Compatibility</div>
                <div className="text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>EVM Compatible</span>
                </div>
              </div>
            </div>
          </div>

          {/* Transfer Summary */}
          <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] mb-6 font-mono text-xs space-y-2">
            <div className="text-[10px] uppercase text-[#94A3B8] tracking-wider mb-1 font-semibold">
              Transfer Summary
            </div>
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Source:</span>
              <span className="text-[#F0F4F8] select-all font-medium">
                {activeSourceAddress.slice(0, 8)}...{activeSourceAddress.slice(-6)}
              </span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Destination:</span>
              <span className={isDestValid ? "text-[#F0F4F8] select-all font-medium" : "text-[#505D6E]"}>
                {isDestValid
                  ? `${cleanDest.slice(0, 8)}...${cleanDest.slice(-6)}`
                  : "Awaiting valid address"}
              </span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Asset & Amount:</span>
              <span className="text-[#3B82F6] font-bold">
                {amount} {asset}
              </span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Network:</span>
              <span className="text-[#F0F4F8]">{networkName}</span>
            </div>
          </div>

          {/* Action Button */}
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg ${
              canContinue
                ? "bg-[#3B82F6] text-white hover:bg-[#2563EB] active:scale-[0.99] shadow-[0_0_20px_rgba(59,130,246,0.3)] cursor-pointer"
                : "bg-[#1C222B] text-[#505D6E] border border-[#232B36] cursor-not-allowed opacity-60"
            }`}
          >
            {isValidating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>VALIDATING CONFIGURATION...</span>
              </>
            ) : (
              <>
                <span>CONTINUE TO EXECUTION</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>

          <div className="mt-4 text-center">
            <Link
              href="/deposit"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              <ArrowLeft size={12} />
              <span>BACK TO DEPOSIT</span>
            </Link>
          </div>
        </div>

        <div className="w-full mt-6 text-center">
          <p className="text-[11px] font-mono text-[#94A3B8] leading-relaxed">
            Transfer configuration is sealed locally. Execution parameters (MIX or POOL) will be chosen on the next screen.
          </p>
        </div>
      </main>

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onConnect={() => setWalletModalOpen(false)}
      />
    </div>
  );
}
