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
  themeColor: "#0C0C0C",
};

export const metadata: Metadata = {
  title: "Cloakroom — Private Financial Infrastructure",
  description:
    "Move assets, manage private financial positions and execute conditional swaps without exposing your entire financial activity. Attested TEE private intent network.",
  keywords: [
    "Cloakroom",
    "Privacy DeFi",
    "TEE Enclave",
    "AWS Nitro Enclave",
    "Private Swaps",
    "Anon-RPC",
    "HPKE",
    "Ethereum",
  ],
  authors: [{ name: "Cloakroom Team" }],
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
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="bg-[#0C0C0C] text-[#F5F5F7] antialiased selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
        {children}
      </body>
    </html>
  );
}
