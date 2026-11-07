'use client';

import { useState } from 'react';
import { numberToHex } from 'viem';
import type { EIP1193Provider } from 'viem';
import { useAccount } from 'wagmi';
import { isUserRejection } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { CopyButton } from '../ui/copy-button';

/** One click asks the connected wallet to add the gateway. The wallet still shows its own approval. */
export function WalletRpc() {
  const { connector } = useAccount();
  const [result, setResult] = useState<'added' | 'rejected' | 'failed' | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const url = appConfig.walletRpcUrl;
  if (!url || !connector) return null;

  const add = async () => {
    setResult(null);
    setWalletError(null);
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: numberToHex(appConfig.chainId),
          chainName: `${appConfig.chain.name} (nony.money RPC)`,
          nativeCurrency: appConfig.chain.nativeCurrency,
          rpcUrls: [url],
          blockExplorerUrls: appConfig.explorerUrl ? [appConfig.explorerUrl] : undefined,
        }],
      });
      setResult('added');
    } catch (cause) {
      // Wallets often reject with a plain { code, message } object rather than an Error.
      const message = (cause as { message?: unknown } | null)?.message;
      setWalletError(typeof message === 'string' ? message : null);
      setResult(isUserRejection(cause) ? 'rejected' : 'failed');
    }
  };

  return (
    <div className="mt-3 px-3 text-xs text-fg-subtle">
      <button type="button" onClick={() => void add()} className="font-medium text-accent hover:text-accent-strong">
        Use nony.money RPC in my wallet
      </button>
      {result === 'added' && <p role="status" className="mt-1">Done. Check it's the selected RPC in your wallet's network list.</p>}
      {result === 'rejected' && <p role="status" className="mt-1">You rejected it, so your RPC hasn't changed.</p>}
      {result === 'failed' && (
        <div role="alert" className="mt-1 space-y-1">
          <p className="text-warn">Your wallet wouldn't add it automatically, so add it by hand. In MetaMask, open the network list, choose Edit on {appConfig.chain.name}, then add this RPC URL and select it.</p>
          <p className="flex flex-wrap items-center gap-2"><span className="font-mono">{url}</span><CopyButton value={url} label="Copy" /></p>
          {walletError && <p>Wallet said: {walletError}</p>}
        </div>
      )}
    </div>
  );
}
