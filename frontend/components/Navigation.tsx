"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { AttestationBadge } from "./AttestationBadge";
import { WalletModal } from "./WalletModal";
import { Menu, X, ArrowUpRight } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

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
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          isScrolled
            ? "bg-[#0C0C0C]/90 backdrop-blur-md border-b border-[#292930]/80 py-3.5 shadow-lg shadow-black/40"
            : "bg-transparent border-b border-transparent py-5"
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
              <span className="font-sans font-semibold tracking-[0.22em] text-xs sm:text-sm text-[#F5F5F7] uppercase">
                CLOAKROOM
              </span>
              <span className="hidden sm:inline-block text-[9px] font-mono tracking-widest text-[#A6DCF8]/80 px-1.5 py-0.5 rounded border border-[#A6DCF8]/20 bg-[#A6DCF8]/5 uppercase">
                v0.1 TEE
              </span>
            </div>
          </Link>

          {/* Right: Desktop Navigation Links & Action */}
          <nav className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-7">
              <a
                href="/#protocol"
                className="text-xs font-medium tracking-wide text-[#92929B] hover:text-[#F5F5F7] transition-colors relative py-1 after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[#A6DCF8] hover:after:w-full after:transition-all after:duration-200"
              >
                Protocol
              </a>
              <a
                href="/#how-it-works"
                className="text-xs font-medium tracking-wide text-[#92929B] hover:text-[#F5F5F7] transition-colors relative py-1 after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[#A6DCF8] hover:after:w-full after:transition-all after:duration-200"
              >
                How It Works
              </a>
              <a
                href="https://github.com/Apurvborhade/Cloakroom/tree/main/docs"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium tracking-wide text-[#92929B] hover:text-[#F5F5F7] transition-colors group"
              >
                <span>Documentation</span>
                <ArrowUpRight
                  size={12}
                  className="text-[#666672] group-hover:text-[#A6DCF8] transition-colors"
                />
              </a>
            </div>

            <div className="h-4 w-[1px] bg-[#292930]" />

            <div className="flex items-center gap-3">
              <AttestationBadge />

              <button
                onClick={() => setWalletModalOpen(true)}
                className="group relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 border border-[#3A3A46] bg-[#141418] hover:bg-[#1A1A22] hover:border-[#A6DCF8]/50 text-[#F5F5F7] active:scale-[0.98] shadow-sm hover:shadow-[0_0_12px_rgba(166,220,248,0.15)]"
              >
                {connectedAddress ? (
                  <span className="font-mono text-xs text-[#A6DCF8]">
                    {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
                  </span>
                ) : (
                  <span>Connect Wallet</span>
                )}
              </button>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <AttestationBadge />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-[#92929B] hover:text-[#F5F5F7] hover:bg-[#141418] transition-colors"
              aria-label="Toggle Menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden px-4 pt-4 pb-6 bg-[#0C0C0C]/95 backdrop-blur-xl border-b border-[#292930] animate-fade-in">
            <div className="flex flex-col space-y-4">
              <a
                href="/#protocol"
                onClick={() => setMobileMenuOpen(false)}
                className="text-sm font-medium text-[#92929B] hover:text-[#F5F5F7] py-1"
              >
                Protocol
              </a>
              <a
                href="/#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="text-sm font-medium text-[#92929B] hover:text-[#F5F5F7] py-1"
              >
                How It Works
              </a>
              <a
                href="https://github.com/Apurvborhade/Cloakroom/tree/main/docs"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between text-sm font-medium text-[#92929B] hover:text-[#F5F5F7] py-1"
              >
                <span>Documentation</span>
                <ArrowUpRight size={14} className="text-[#666672]" />
              </a>

              <div className="pt-2 border-t border-[#202026]">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setWalletModalOpen(true);
                  }}
                  className="w-full py-2.5 rounded-full text-xs font-medium tracking-wide border border-[#3A3A46] bg-[#141418] text-[#F5F5F7] text-center"
                >
                  {connectedAddress ? connectedAddress.slice(0, 8) + "..." : "Connect Wallet"}
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onConnect={(addr) => setConnectedAddress(addr)}
      />
    </>
  );
}

