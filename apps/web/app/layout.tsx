import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://nony.money'),
  title: 'nony.money',
  description: 'Swap and withdraw without tying your new wallet to the one you deposited from.',
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
  openGraph: {
    title: 'nony.money',
    description: 'Swap and withdraw from a pool address, not your wallet.',
    siteName: 'nony.money',
    url: '/',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'nony.money' }],
  },
  twitter: { card: 'summary_large_image', title: 'nony.money', images: ['/og.png'] },
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#131313', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
