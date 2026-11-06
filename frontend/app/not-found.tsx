import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo size={32} />
        </div>
        <div className="font-mono text-xs text-[#A6DCF8] uppercase tracking-widest mb-2">
          404 / NOT FOUND
        </div>
        <h1 className="text-2xl font-bold mb-3">Enclave Route Missing</h1>
        <p className="text-xs text-[#92929B] mb-6 leading-relaxed">
          The requested coordinate or resource does not exist in this deployment.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#141418] border border-[#292930] hover:border-[#3A3A46] text-xs font-mono text-[#F5F5F7] transition-colors"
        >
          <ArrowLeft size={13} />
          <span>RETURN TO OVERVIEW</span>
        </Link>
      </div>
    </div>
  );
}

