"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { AttestationBadge } from "./AttestationBadge";
import { WalletModal } from "./WalletModal";
import { useWallet } from "@/hooks/useWallet";
import { Menu, X, Wallet, Shield } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const { account, networkName, isConnecting } = useWallet();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 15);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-200 ${
          isScrolled
            ? "bg-[#161B22]/95 backdrop-blur-md border-b border-[#232B36] py-3.5 shadow-md shadow-black/30"
            : "bg-[#0F1318]/80 backdrop-blur-sm border-b border-[#232B36]/60 py-4"
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 flex items-center justify-between">
          {/* Left: Brand */}
          <Link
            href="/"
            className="group flex items-center gap-3 transition-opacity hover:opacity-90 focus:outline-none"
          >
            <Logo size={24} />
            <div className="flex items-center gap-2">
              <span className="font-sans font-bold tracking-[0.2em] text-sm sm:text-base text-[#F0F4F8] uppercase">
                NONY
              </span>
              <span className="hidden sm:inline-block text-[9px] font-mono tracking-widest text-[#3B82F6] px-1.5 py-0.5 rounded border border-[#3B82F6]/30 bg-[#3B82F6]/10 uppercase">
                TEE Enclave
              </span>
            </div>
          </Link>

          {/* Center: Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-mono">
            <Link
              href="/deposit"
              className={`hover:text-[#F0F4F8] transition-colors py-1 ${
                pathname === "/deposit" ? "text-[#3B82F6] font-semibold" : "text-[#94A3B8]"
              }`}
            >
              Deposit
            </Link>
            <Link
              href="/execution"
              className={`hover:text-[#F0F4F8] transition-colors py-1 ${
                pathname === "/execution" ? "text-[#3B82F6] font-semibold" : "text-[#94A3B8]"
              }`}
            >
              Strategy
            </Link>
            <Link
              href="/pool"
              className={`hover:text-[#F0F4F8] transition-colors py-1 ${
                pathname.startsWith("/pool") ? "text-[#3B82F6] font-semibold" : "text-[#94A3B8]"
              }`}
            >
              Pool Trading
            </Link>
            <Link
              href="/mix"
              className={`hover:text-[#F0F4F8] transition-colors py-1 ${
                pathname.startsWith("/mix") ? "text-[#3B82F6] font-semibold" : "text-[#94A3B8]"
              }`}
            >
              Privacy Mix
            </Link>
            <Link
              href="/wallet"
              className={`hover:text-[#F0F4F8] transition-colors py-1 ${
                pathname.startsWith("/wallet") ? "text-[#3B82F6] font-semibold" : "text-[#94A3B8]"
              }`}
            >
              Portfolio
            </Link>
          </nav>

          {/* Right: Attestation & Wallet */}
          <div className="hidden md:flex items-center gap-3">
            <AttestationBadge />

            {account ? (
              <button
                type="button"
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1C222B] border border-[#232B36] hover:border-[#3A4759] text-xs font-mono text-[#F0F4F8] transition-colors focus:outline-none"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setWalletModalOpen(true)}
                disabled={isConnecting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold tracking-wide transition-colors focus:outline-none shadow-sm"
              >
                <Wallet size={13} />
                <span>{isConnecting ? "Connecting..." : "Connect"}</span>
              </button>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <AttestationBadge />
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222B] transition-colors focus:outline-none"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#232B36] bg-[#161B22] px-4 py-4 space-y-3 font-mono text-xs">
            <Link
              href="/deposit"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-[#94A3B8] hover:text-[#F0F4F8]"
            >
              Deposit
            </Link>
            <Link
              href="/execution"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-[#94A3B8] hover:text-[#F0F4F8]"
            >
              Strategy Selection
            </Link>
            <Link
              href="/pool"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-[#94A3B8] hover:text-[#F0F4F8]"
            >
              Pool Trading
            </Link>
            <Link
              href="/mix"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-[#94A3B8] hover:text-[#F0F4F8]"
            >
              Privacy Mix
            </Link>
            <Link
              href="/wallet"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-[#94A3B8] hover:text-[#F0F4F8]"
            >
              Portfolio &amp; Cash Out
            </Link>
            <div className="pt-2 border-t border-[#232B36]">
              {account ? (
                <div className="py-2 text-[#10B981] font-semibold">
                  Connected: {account.slice(0, 8)}...{account.slice(-4)}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setWalletModalOpen(true);
                  }}
                  className="w-full py-2.5 rounded-lg bg-[#3B82F6] text-white font-semibold text-center"
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </>
  );
}
