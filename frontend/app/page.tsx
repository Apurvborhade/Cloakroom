"use client";

import React from "react";
import { Navigation } from "@/components/Navigation";
import { HeroSection } from "@/components/HeroSection";
import { ProtocolSection } from "@/components/ProtocolSection";
import { Footer } from "@/components/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col font-mono selection:bg-[#3B82F6]/30 selection:text-white">
      {/* Top Navigation */}
      <Navigation />

      {/* Main Content */}
      <main className="flex-1">
        <HeroSection />
        <ProtocolSection />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
