'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { darkTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wallet/wagmi';
import { ToastProvider } from './ui/toast';
import { SessionGuard } from './wallet/session-guard';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: '#5cc8f0', accentColorForeground: '#0a0a0b', borderRadius: 'medium', overlayBlur: 'small' })}
          modalSize="compact"
          showRecentTransactions={false}
          appInfo={{ appName: 'nony.money' }}
        >
          <ToastProvider>
            <SessionGuard />
            {children}
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
