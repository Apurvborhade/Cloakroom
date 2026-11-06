import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0F1318",
};

export const metadata: Metadata = {
  title: "NONY — Private Financial Infrastructure",
  description:
    "Move assets, manage private financial positions and execute conditional swaps without exposing your entire financial activity. Attested TEE private intent network.",
  keywords: [
    "NONY",
    "Privacy DeFi",
    "TEE Enclave",
    "AWS Nitro Enclave",
    "Private Swaps",
    "Anon-RPC",
    "HPKE",
    "Ethereum",
  ],
  authors: [{ name: "NONY Team" }],
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-[#0F1318] text-[#F0F4F8] antialiased selection:bg-[#3B82F6]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
