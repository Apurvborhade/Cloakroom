import React from "react";
import { Logo } from "./Logo";
import { ArrowUpRight } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-[#1C1C22] bg-[#0C0C0C] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Logo size={20} />
          <span className="font-sans font-semibold tracking-[0.2em] text-xs text-[#F5F5F7] uppercase">
            CLOAKROOM
          </span>
          <span className="text-xs text-[#666672] ml-2">
            Confidential TEE Financial Infrastructure
          </span>
        </div>

        <div className="flex items-center gap-6 text-xs text-[#92929B]">
          <a
            href="https://github.com/Apurvborhade/Cloakroom"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#F5F5F7] transition-colors flex items-center gap-1"
          >
            <span>GitHub</span>
            <ArrowUpRight size={11} className="text-[#666672]" />
          </a>
          <a
            href="https://github.com/Apurvborhade/Cloakroom/blob/main/docs/README.md"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#F5F5F7] transition-colors flex items-center gap-1"
          >
            <span>Docs</span>
            <ArrowUpRight size={11} className="text-[#666672]" />
          </a>
          <a
            href="https://ethereum.github.io/anon-rpc/wallets/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#F5F5F7] transition-colors flex items-center gap-1"
          >
            <span>Anon-RPC</span>
            <ArrowUpRight size={11} className="text-[#666672]" />
          </a>
          <span className="text-[#666672]">MIT License</span>
        </div>
      </div>
    </footer>
  );
}

