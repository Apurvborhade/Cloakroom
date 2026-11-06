"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Key,
  Copy,
  Check,
  AlertCircle,
  Wallet,
  X,
  QrCode,
  Lock,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";
import { AssetSelector, SupportedAsset, SUPPORTED_ASSETS } from "@/components/AssetSelector";

export default function DepositSetupPage() {
  const { account, networkName, balance } = useWallet();

  const [selectedAsset, setSelectedAsset] = useState<"ETH" | "USDC">("ETH");
  const [amount, setAmount] = useState<string>("");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [generatedAddress, setGeneratedAddress] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const currentAssetConfig =
    SUPPORTED_ASSETS.find((a) => a.symbol === selectedAsset) || SUPPORTED_ASSETS[0];

  // Input validation
  const numericAmount = parseFloat(amount);
  const numericBalance = balance ? parseFloat(balance) : null;
  const isAmountValid = !isNaN(numericAmount) && numericAmount > 0;
  const isInsufficient =
    isAmountValid && numericBalance !== null && selectedAsset === "ETH" && numericAmount > numericBalance;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/,/g, ".");
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      const parts = val.split(".");
      const maxDecimals = currentAssetConfig.decimals;
      if (parts[1] && parts[1].length > maxDecimals) return;
      setAmount(val);
    }
  };

  const handleMaxClick = () => {
    if (!account) {
      setWalletModalOpen(true);
      return;
    }
    if (balance && selectedAsset === "ETH") {
      const raw = parseFloat(balance);
      const safeMax = Math.max(0, raw - 0.005);
      setAmount(safeMax > 0 ? safeMax.toFixed(4) : balance);
    } else if (balance) {
      setAmount(balance);
    }
  };

  const handleCopyAddress = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleContinue = () => {
    if (!account) {
      setWalletModalOpen(true);
      return;
    }
    if (!isAmountValid || isInsufficient) return;
    setConfirmModalOpen(true);
  };

  const handleConfirmSession = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setConfirmModalOpen(false);
      setSessionInitialized(true);
      setGeneratedAddress("0x71C568a8F9B60471f54aC482C400cCE9C298B319");
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      {/* Navigation Header */}
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

          <div className="flex items-center gap-4 sm:gap-6 text-xs">
            <Link
              href="/#protocol"
              className="hidden md:inline-block text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              PROTOCOL
            </Link>

            {account ? (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] hover:border-[#3A4759] text-[#F0F4F8] font-mono text-xs transition-colors"
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
              href="/"
              className="inline-flex items-center gap-1.5 text-[#94A3B8] hover:text-[#F0F4F8] font-mono transition-colors border-l border-[#232B36] pl-4"
              title="Return to landing page"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">OVERVIEW</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center items-center py-12 sm:py-16 px-4 sm:px-6 w-full max-w-[620px] mx-auto animate-fade-in">
        {/* Page Intro */}
        <div className="w-full text-left mb-6">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#3B82F6] uppercase mb-2">
            01 / PRIVATE SESSION INITIALIZATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8]">
            Initialize your private session.
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1.5 leading-relaxed">
            Prepare your assets for confidential execution. Supported assets are held directly by your attested session enclave.
          </p>
        </div>

        {/* Deposit Card */}
        <div className="w-full rounded-2xl bg-[#161B22] border border-[#232B36] p-6 sm:p-8 shadow-2xl relative">
          {/* Card Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#232B36] mb-6">
            <div>
              <h2 className="text-xs font-mono font-semibold tracking-wider text-[#F0F4F8] uppercase">
                DEPOSIT ASSETS
              </h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Select an asset and specify the amount you want to deposit.
              </p>
            </div>
            <div className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C222B] text-[#3B82F6] border border-[#232B36]">
              STEP 1 OF 2
            </div>
          </div>

          {/* Asset Selector Dropdown Integration */}
          <div className="mb-6">
            <label className="block text-xs font-mono text-[#94A3B8] uppercase tracking-wider mb-2.5">
              Select Asset
            </label>
            <AssetSelector
              selectedSymbol={selectedAsset}
              onSelect={(asset: SupportedAsset) => {
                setSelectedAsset(asset.symbol);
                setAmount("");
              }}
            />
          </div>

          {/* Amount Input */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-[#94A3B8] uppercase tracking-wider">
                Amount to deposit
              </span>
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#94A3B8]">
                <span>Available:</span>
                {account ? (
                  <span className="text-[#F0F4F8] font-medium">
                    {selectedAsset === "ETH"
                      ? balance
                        ? `${balance} ETH`
                        : "Loading..."
                      : `0.00 ${selectedAsset}`}
                  </span>
                ) : (
                  <button
                    onClick={() => setWalletModalOpen(true)}
                    className="text-[#3B82F6] hover:underline"
                  >
                    Connect wallet
                  </button>
                )}
              </div>
            </div>

            <div
              className={`relative rounded-xl bg-[#0F1318] border transition-colors ${
                isInsufficient
                  ? "border-red-500/80 focus-within:border-red-500"
                  : "border-[#232B36] focus-within:border-[#3B82F6]"
              }`}
            >
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                onChange={handleAmountChange}
                className="w-full bg-transparent px-4 py-4 text-2xl sm:text-3xl font-mono text-[#F0F4F8] placeholder-[#505D6E] outline-none pr-28"
              />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMaxClick}
                  className="px-2.5 py-1 rounded bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[11px] font-mono text-[#3B82F6] font-semibold tracking-wider transition-colors"
                >
                  MAX
                </button>
                <span className="font-mono text-sm font-semibold text-[#F0F4F8]">
                  {selectedAsset}
                </span>
              </div>
            </div>

            {isInsufficient && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-red-400 font-mono">
                <AlertCircle size={13} />
                <span>Insufficient balance in connected wallet ({balance} ETH)</span>
              </div>
            )}
          </div>

          {/* Session Deposit Address Panel */}
          <div className="mb-6 p-4 rounded-xl bg-[#1C222B] border border-[#232B36]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#94A3B8] uppercase">
                <Key size={13} className="text-[#3B82F6]" />
                <span>Session Deposit Address</span>
              </div>
              <span className="text-[10px] font-mono text-[#666670]">
                {sessionInitialized ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    RESERVED
                  </span>
                ) : (
                  "AWAITING INITIALIZATION"
                )}
              </span>
            </div>

            {sessionInitialized && generatedAddress ? (
              <div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#0F1318] border border-[#232B36] font-mono text-xs text-[#F0F4F8]">
                  <span className="break-all select-all">{generatedAddress}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleCopyAddress(generatedAddress)}
                      className="p-1.5 rounded hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
                      title="Copy Address"
                    >
                      {copied ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => setShowQr(!showQr)}
                      className="p-1.5 rounded hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
                      title="Toggle QR Code"
                    >
                      <QrCode size={14} />
                    </button>
                  </div>
                </div>

                {showQr && (
                  <div className="mt-3 p-4 bg-white rounded-lg flex flex-col items-center justify-center max-w-[180px] mx-auto animate-fade-in">
                    <div className="w-32 h-32 bg-slate-900 rounded p-2 flex items-center justify-center text-white text-[10px] font-mono text-center">
                      [QR: {generatedAddress.slice(0, 8)}...]
                    </div>
                    <span className="text-[10px] font-mono text-slate-800 mt-1 font-semibold">
                      Scan to deposit
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-[#94A3B8] mt-2 leading-relaxed">
                  Transfer exactly <span className="text-[#F0F4F8] font-mono font-medium">{amount} {selectedAsset}</span> from your wallet. Funds will be credited directly to your private enclave ledger.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                An ephemeral, single-use custody address will be provisioned inside the attested AWS Nitro Enclave once you initiate the session. No public mixer contracts are involved.
              </p>
            )}
          </div>

          {/* Security Information Panel */}
          <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36] mb-6 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>SESSION TYPE</span>
              <span className="text-[#F0F4F8]">Private execution</span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>EXECUTION ENVIRONMENT</span>
              <span className="text-[#3B82F6] flex items-center gap-1 font-semibold">
                <ShieldCheck size={12} /> TEE-secured (Nitro Enclave)
              </span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>ASSET</span>
              <span className="text-[#F0F4F8]">{selectedAsset} ({currentAssetConfig.decimals} decimals)</span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>NETWORK</span>
              <span className="text-[#F0F4F8]">{networkName}</span>
            </div>
            <div className="h-[1px] bg-[#232B36]" />
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>SESSION EXPIRY</span>
              <span className="text-[#94A3B8]">
                {sessionInitialized ? "15:00 Window Active" : "Provisioned on initiation"}
              </span>
            </div>
          </div>

          {/* Action Button */}
          {!account ? (
            <button
              type="button"
              onClick={() => setWalletModalOpen(true)}
              className="w-full py-4 rounded-xl font-semibold text-sm tracking-wide bg-[#1C222B] hover:bg-[#232B36] text-[#3B82F6] border border-[#3B82F6]/40 transition-all flex items-center justify-center gap-2 active:scale-[0.99] shadow-lg cursor-pointer"
            >
              <Wallet size={16} />
              <span>Connect Wallet to Deposit</span>
            </button>
          ) : sessionInitialized ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2 font-mono">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>Session address active. Send {amount} {selectedAsset} to finalize.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSessionInitialized(false);
                  setGeneratedAddress(null);
                  setAmount("");
                }}
                className="w-full py-3.5 rounded-xl font-medium text-xs font-mono tracking-wider bg-[#1C222B] hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] border border-[#232B36] transition-colors cursor-pointer"
              >
                Reset Session
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleContinue}
              disabled={!isAmountValid || isInsufficient}
              className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg ${
                isAmountValid && !isInsufficient
                  ? "bg-[#3B82F6] text-white hover:bg-[#2563EB] active:scale-[0.99] shadow-[0_0_20px_rgba(59,130,246,0.3)] cursor-pointer"
                  : "bg-[#1C222B] text-[#505D6E] border border-[#232B36] cursor-not-allowed opacity-60"
              }`}
            >
              <span>CONTINUE</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>

        {/* Security Footnote */}
        <div className="w-full mt-6 text-center">
          <p className="text-[11px] font-mono text-[#94A3B8] leading-relaxed">
            All requests are signed via EIP-712 and sealed with HPKE directly to the hardware enclave.
            Your deposit address is reserved for a single transaction window.
          </p>
        </div>
      </main>

      {/* Confirmation Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-md p-6 rounded-2xl bg-[#161B22] border border-[#232B36] shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#232B36]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6]">
                  <Lock size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F0F4F8]">
                    Confirm Deposit Session
                  </h3>
                  <p className="text-xs text-[#94A3B8]">Review before enclave provisioning</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="p-1 rounded-lg text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222B] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="py-4 space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-[#0F1318] border border-[#232B36] flex items-center justify-between">
                <span className="text-[#94A3B8]">Deposit Amount</span>
                <span className="text-base font-semibold text-[#F0F4F8]">
                  {amount} {selectedAsset}
                </span>
              </div>

              <div className="space-y-2 px-1 text-[11px]">
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Origin Wallet</span>
                  <span className="text-[#F0F4F8]">
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Network</span>
                  <span className="text-[#F0F4F8]">{networkName}</span>
                </div>
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Enclave Protocol</span>
                  <span className="text-[#3B82F6]">AWS Nitro EIF (Attested)</span>
                </div>
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span>Session TTL</span>
                  <span className="text-[#F0F4F8]">15 Minutes</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#1C222B] border border-[#232B36] text-[11px] text-[#94A3B8] leading-relaxed">
                Confirming will request a fresh, isolated custody EOA directly from the enclave.
                No smart contract mixer interaction will appear on-chain.
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="flex-1 py-3 rounded-xl text-xs font-mono text-[#94A3B8] hover:text-[#F0F4F8] border border-[#232B36] hover:bg-[#1C222B] transition-colors"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirmSession}
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-xl font-bold text-xs tracking-wider bg-[#3B82F6] text-white hover:bg-[#2563EB] active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>PROVISIONING...</span>
                  </>
                ) : (
                  <>
                    <span>INITIATE SESSION</span>
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onConnect={() => {
          setWalletModalOpen(false);
        }}
      />
    </div>
  );
}
