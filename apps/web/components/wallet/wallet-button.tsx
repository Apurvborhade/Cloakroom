'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { truncateMiddle } from '@/lib/format/address';
import { Button } from '../ui/button';

/** RainbowKit's connect flow, styled to match. Balance display is off: it would be a chain read. */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return <div className="h-9 w-32 rounded-lg bg-ink-800" aria-hidden />;
        if (!account || !chain) {
          return (
            <Button size="sm" onClick={openConnectModal}>
              Connect wallet
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button size="sm" variant="danger" onClick={openChainModal}>
              Wrong network
            </Button>
          );
        }
        return (
          <button
            type="button"
            onClick={openAccountModal}
            className="flex h-9 items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 text-xs font-medium text-fg hover:border-ink-500"
            aria-label={`Connected wallet ${account.address}. Open account menu`}
            title={account.address}
          >
            <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
            <span className="font-mono">{truncateMiddle(account.address, 6, 4)}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
