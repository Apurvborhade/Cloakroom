import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { braveWallet, injectedWallet, rabbyWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, custom } from 'wagmi';
import { appConfig } from '../config';
import { chainReader } from '../chain';

/**
 * Wallet connection only. Injected wallets (MetaMask, Rabby, Brave and any EIP-6963 wallet) work
 * with no third-party service. WalletConnect is added only when a project ID is configured. The
 * MetaMask and Coinbase SDK connectors are deliberately not used: they ship their own telemetry.
 *
 * wagmi's public transport is routed through the same ChainReader as every other browser read, so
 * nothing in wagmi or RainbowKit can quietly reach a plain RPC.
 */
const walletGroups = [
  {
    groupName: 'Browser wallets',
    wallets: [injectedWallet, rabbyWallet, braveWallet],
  },
  ...(appConfig.walletConnectProjectId ? [{ groupName: 'Mobile', wallets: [walletConnectWallet] }] : []),
];

const connectors = connectorsForWallets(walletGroups, {
  appName: 'nony.money',
  projectId: appConfig.walletConnectProjectId ?? 'not-configured',
});

export const wagmiConfig = createConfig({
  chains: [appConfig.chain],
  connectors,
  ssr: true,
  multiInjectedProviderDiscovery: true,
  transports: {
    [appConfig.chain.id]: custom({ request: (args) => chainReader.request(args) }),
  },
});
