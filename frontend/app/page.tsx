"use client";

import React from "react";
import { Navigation } from "@/components/Navigation";
import { HeroSection } from "@/components/HeroSection";
import { ProtocolSection } from "@/components/ProtocolSection";
import { Footer } from "@/components/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col">
      {/* Minimal Top Navigation Bar */}
      <Navigation />

      {/* Hero Section (Primary Focus: 85–90vh Viewport) */}
      <main className="flex-1">
        <HeroSection />

        {/* Protocol Architecture & How It Works Section */}
        <ProtocolSection />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

