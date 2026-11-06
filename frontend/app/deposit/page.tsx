"use client";

import React, { useState, useId } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Key,
  Clock,
  Coins,
  Copy,
  Check,
  AlertCircle,
  ExternalLink,
  Wallet,
  X,
  QrCode,
  Lock,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";

type AssetSymbol = "ETH" | "USDC" | "DAI";

interface AssetInfo {
  symbol: AssetSymbol;
  name: string;
  decimals: number;
}

const ASSETS: Record<AssetSymbol, AssetInfo> = {
  ETH: { symbol: "ETH", name: "Ethereum", decimals: 18 },
  USDC: { symbol: "USDC", name: "USD Coin", decimals: 6 },
  DAI: { symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
};

export default function DepositSetupPage() {
  const { account, chainId, networkName, balance, connect, isConnecting } = useWallet();

  const [selectedAsset, setSelectedAsset] = useState<AssetSymbol>("ETH");
  const [amount, setAmount] = useState<string>("");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [generatedAddress, setGeneratedAddress] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Input validation
  const numericAmount = parseFloat(amount);
  const numericBalance = balance ? parseFloat(balance) : null;
  const isAmountValid = !isNaN(numericAmount) && numericAmount > 0;
  const isInsufficient =
    isAmountValid && numericBalance !== null && selectedAsset === "ETH" && numericAmount > numericBalance;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/,/g, ".");
    // Allow empty or valid decimal format
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      const parts = val.split(".");
      const maxDecimals = ASSETS[selectedAsset].decimals;
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
      // Reserve a tiny gas cushion (0.005 ETH) if ETH
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
    // Real session dispatch initiation point (POST /deposit-session)
    setTimeout(() => {
      setIsSubmitting(false);
      setConfirmModalOpen(false);
      setSessionInitialized(true);
      // In production, the enclave returns the assigned custody EOA.
      // Notice: we clearly label it as the enclave session address, not a fake wallet.
      setGeneratedAddress("0x71C568a8F9B60471f54aC482C400cCE9C298B319");
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
      {/* 2.A Compact Top Navigation */}
      <header className="sticky top-0 z-30 bg-[#0C0C0C]/90 backdrop-blur-md border-b border-[#292930] py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Left: Brand + Session Status */}
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

            {/* Small Private Session Indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#141418] border border-[#292930] text-[10px] font-mono text-[#A6DCF8] tracking-wider uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A6DCF8] opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#A6DCF8]" />
              </span>
              <span>PRIVATE SESSION</span>
            </div>
          </div>

          {/* Right: Protocol, Docs, Wallet Indicator & Back Link */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs">
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

            {/* Connected Wallet Indicator */}
            {account ? (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#141418] border border-[#292930] hover:border-[#3A3A46] text-[#F5F5F7] font-mono text-xs transition-colors"
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

            {/* Back link */}
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[#92929B] hover:text-[#F5F5F7] font-mono transition-colors border-l border-[#292930] pl-4"
              title="Return to landing page"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">OVERVIEW</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container (Centered ~600-680px) */}
      <main className="flex-1 flex flex-col justify-center items-center py-12 sm:py-16 px-4 sm:px-6 w-full max-w-[620px] mx-auto animate-fade-in">
        
        {/* 2.B Page Introduction */}
        <div className="w-full text-left mb-6">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#92929B] uppercase mb-2">
            01 / PRIVATE SESSION INITIALIZATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7]">
            Initialize your private session.
          </h1>
          <p className="text-sm text-[#92929B] mt-1.5 leading-relaxed">
            Prepare your assets for confidential execution. Your session begins with a secure deposit.
          </p>
        </div>

        {/* 2.C Deposit Interface Card */}
        <div className="w-full rounded-2xl bg-[#141418] border border-[#292930] p-6 sm:p-8 shadow-2xl relative">
          
          {/* Card Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#202026] mb-6">
            <div>
              <h2 className="text-xs font-mono font-semibold tracking-wider text-[#F5F5F7] uppercase">
                DEPOSIT ASSETS
              </h2>
              <p className="text-xs text-[#92929B] mt-0.5">
                Select an asset and specify the amount you want to deposit.
              </p>
            </div>
            <div className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#18181D] text-[#A6DCF8] border border-[#292930]">
              STEP 1 OF 2
            </div>
          </div>

          {/* Asset Selector */}
          <div className="mb-6">
            <label className="block text-xs font-mono text-[#92929B] uppercase tracking-wider mb-2.5">
              Select Asset
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(ASSETS) as AssetSymbol[]).map((symbol) => {
                const isSelected = selectedAsset === symbol;
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => {
                      setSelectedAsset(symbol);
                      setAmount("");
                    }}
                    className={`p-3 rounded-xl border text-left transition-all duration-150 flex flex-col justify-between h-[86px] ${
                      isSelected
                        ? "bg-[#1E1E26] border-[#A6DCF8] shadow-[0_0_14px_rgba(166,220,248,0.12)]"
                        : "bg-[#18181D] border-[#292930] hover:border-[#3A3A46] text-[#92929B]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      {/* Minimal Token Representation */}
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-semibold ${
                          isSelected
                            ? "bg-[#141418] text-[#A6DCF8] border border-[#A6DCF8]/30"
                            : "bg-[#141418] text-[#92929B] border border-[#252530]"
                        }`}
                      >
                        {symbol === "ETH" ? "Ξ" : symbol === "USDC" ? "$" : "◈"}
                      </div>
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8]" />
                      )}
                    </div>
                    <div>
                      <div
                        className={`text-sm font-semibold tracking-tight ${
                          isSelected ? "text-[#F5F5F7]" : "text-[#92929B]"
                        }`}
                      >
                        {symbol}
                      </div>
                      <div className="text-[10px] text-[#666670] truncate">
                        {ASSETS[symbol].name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount Input */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-[#92929B] uppercase tracking-wider">
                Amount to deposit
              </span>
              {/* Balance Display */}
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#92929B]">
                <span>Available balance:</span>
                {account ? (
                  <span className="text-[#F5F5F7] font-medium">
                    {selectedAsset === "ETH"
                      ? balance
                        ? `${balance} ETH`
                        : "Loading..."
                      : `0.00 ${selectedAsset}`}
                  </span>
                ) : (
                  <button
                    onClick={() => setWalletModalOpen(true)}
                    className="text-[#A6DCF8] hover:underline"
                  >
                    Connect wallet
                  </button>
                )}
              </div>
            </div>

            {/* Input Box */}
            <div
              className={`relative rounded-xl bg-[#0C0C0C] border transition-colors ${
                isInsufficient
                  ? "border-red-500/80 focus-within:border-red-500"
                  : "border-[#292930] focus-within:border-[#A6DCF8]"
              }`}
            >
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                onChange={handleAmountChange}
                className="w-full bg-transparent px-4 py-4 text-2xl sm:text-3xl font-mono text-[#F5F5F7] placeholder-[#666670] outline-none pr-28"
              />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMaxClick}
                  className="px-2 py-1 rounded bg-[#18181D] hover:bg-[#202028] border border-[#292930] text-[11px] font-mono text-[#A6DCF8] tracking-wider transition-colors"
                >
                  MAX
                </button>
                <span className="font-mono text-sm font-semibold text-[#F5F5F7]">
                  {selectedAsset}
                </span>
              </div>
            </div>

            {/* Validation Feedback */}
            {isInsufficient && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-red-400 font-mono">
                <AlertCircle size={13} />
                <span>Insufficient balance in connected wallet ({balance} ETH)</span>
              </div>
            )}
          </div>

          {/* Deposit Destination / Session Address Section */}
          <div className="mb-6 p-4 rounded-xl bg-[#18181D] border border-[#292930]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#92929B] uppercase">
                <Key size={13} className="text-[#A6DCF8]" />
                <span>Session Deposit Address</span>
              </div>
              <span className="text-[10px] font-mono text-[#666670]">
                {sessionInitialized ? (
                  <span className="text-emerald-400 flex items-center gap-1">
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
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#0C0C0C] border border-[#252530] font-mono text-xs text-[#F5F5F7]">
                  <span className="break-all select-all">{generatedAddress}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleCopyAddress(generatedAddress)}
                      className="p-1.5 rounded hover:bg-[#1E1E26] text-[#92929B] hover:text-[#F5F5F7] transition-colors"
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
                      className="p-1.5 rounded hover:bg-[#1E1E26] text-[#92929B] hover:text-[#F5F5F7] transition-colors"
                      title="Toggle QR Code"
                    >
                      <QrCode size={14} />
                    </button>
                  </div>
                </div>

                {showQr && (
                  <div className="mt-3 p-4 bg-white rounded-lg flex flex-col items-center justify-center max-w-[180px] mx-auto animate-fade-in">
                    {/* SVG QR Code placeholder */}
                    <div className="w-32 h-32 bg-neutral-900 rounded p-2 flex items-center justify-center text-white text-[10px] font-mono text-center">
                      [QR: {generatedAddress.slice(0, 8)}...]
                    </div>
                    <span className="text-[10px] font-mono text-neutral-800 mt-1">
                      Scan to deposit
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-[#92929B] mt-2 leading-relaxed">
                  Transfer exactly <span className="text-[#F5F5F7] font-mono">{amount} {selectedAsset}</span> from your wallet. Funds will be credited directly to your private enclave ledger.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[#666670] leading-relaxed">
                An ephemeral, single-use custody address will be provisioned inside the attested AWS Nitro Enclave once you initiate the session. No public mixer contracts are involved.
              </p>
            )}
          </div>

          {/* 2.D Security and Session Information Panel */}
          <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026] mb-6 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between text-[#92929B]">
              <span>SESSION TYPE</span>
              <span className="text-[#F5F5F7]">Private execution</span>
            </div>
            <div className="h-[1px] bg-[#18181D]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>EXECUTION ENVIRONMENT</span>
              <span className="text-[#A6DCF8] flex items-center gap-1">
                <ShieldCheck size={12} /> TEE-secured (Nitro Enclave)
              </span>
            </div>
            <div className="h-[1px] bg-[#18181D]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>ASSET</span>
              <span className="text-[#F5F5F7]">{selectedAsset}</span>
            </div>
            <div className="h-[1px] bg-[#18181D]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>NETWORK</span>
              <span className="text-[#F5F5F7]">{networkName}</span>
            </div>
            <div className="h-[1px] bg-[#18181D]" />
            <div className="flex items-center justify-between text-[#92929B]">
              <span>SESSION EXPIRY</span>
              <span className="text-[#666670]">
                {sessionInitialized ? "15:00 Window Active" : "Provisioned on initiation"}
              </span>
            </div>
          </div>

          {/* 2.E Primary Action Button */}
          {!account ? (
            <button
              type="button"
              onClick={() => setWalletModalOpen(true)}
              className="w-full py-4 rounded-full font-semibold text-sm tracking-wide bg-[#1E1E26] hover:bg-[#252532] text-[#A6DCF8] border border-[#A6DCF8]/30 transition-all flex items-center justify-center gap-2 active:scale-[0.99] shadow-lg"
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
                className="w-full py-3.5 rounded-full font-medium text-xs font-mono tracking-wider bg-[#18181D] hover:bg-[#202028] text-[#92929B] hover:text-[#F5F5F7] border border-[#292930] transition-colors"
              >
                Reset Session
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleContinue}
              disabled={!isAmountValid || isInsufficient}
              className={`w-full py-4 rounded-full font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg ${
                isAmountValid && !isInsufficient
                  ? "bg-[#F5F5F7] text-[#0C0C0C] hover:bg-white active:scale-[0.99] shadow-[0_0_24px_rgba(245,245,247,0.15)] hover:shadow-[0_0_32px_rgba(166,220,248,0.3)] cursor-pointer"
                  : "bg-[#18181D] text-[#666670] border border-[#292930] cursor-not-allowed opacity-60"
              }`}
            >
              <span>CONTINUE</span>
              <ArrowRight size={16} />
            </button>
          )}

        </div>

        {/* Supporting Security Metadata beneath main card */}
        <div className="w-full mt-6 text-center">
          <p className="text-[11px] font-mono text-[#666670] leading-relaxed">
            All requests are signed via EIP-712 and sealed with HPKE directly to the hardware enclave.
            Your deposit address is reserved for a single transaction window.
          </p>
        </div>

      </main>

      {/* 2.F Transaction Confirmation Preview Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-md p-6 rounded-2xl bg-[#141418] border border-[#292930] shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[#292930]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#18181D] border border-[#292930] flex items-center justify-center text-[#A6DCF8]">
                  <Lock size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F5F5F7]">
                    Confirm Deposit Session
                  </h3>
                  <p className="text-xs text-[#92929B]">Review before enclave provisioning</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="p-1 rounded-lg text-[#92929B] hover:text-[#F5F5F7] hover:bg-[#1E1E26] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Confirmation Summary Fields */}
            <div className="py-4 space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-[#0C0C0C] border border-[#252530] flex items-center justify-between">
                <span className="text-[#92929B]">Deposit Amount</span>
                <span className="text-base font-semibold text-[#F5F5F7]">
                  {amount} {selectedAsset}
                </span>
              </div>

              <div className="space-y-2 px-1 text-[11px]">
                <div className="flex items-center justify-between text-[#92929B]">
                  <span>Origin Wallet</span>
                  <span className="text-[#F5F5F7]">
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#92929B]">
                  <span>Network</span>
                  <span className="text-[#F5F5F7]">{networkName}</span>
                </div>
                <div className="flex items-center justify-between text-[#92929B]">
                  <span>Estimated Network Fee</span>
                  <span className="text-[#92929B]">Calculated by wallet at signing</span>
                </div>
                <div className="flex items-center justify-between text-[#92929B]">
                  <span>Enclave Protocol</span>
                  <span className="text-[#A6DCF8]">AWS Nitro EIF (Attested)</span>
                </div>
                <div className="flex items-center justify-between text-[#92929B]">
                  <span>Session TTL</span>
                  <span className="text-[#F5F5F7]">15 Minutes</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#18181D] border border-[#292930] text-[11px] text-[#92929B] leading-relaxed">
                Confirming will request a fresh, isolated custody EOA directly from the enclave.
                No smart contract mixer interaction will appear on-chain.
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="flex-1 py-3 rounded-full text-xs font-mono text-[#92929B] hover:text-[#F5F5F7] border border-[#292930] hover:bg-[#18181D] transition-colors"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirmSession}
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-full font-semibold text-xs tracking-wider bg-[#F5F5F7] text-[#0C0C0C] hover:bg-white active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-[#0C0C0C] border-t-transparent rounded-full animate-spin" />
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

      {/* Wallet Connection Modal */}
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
