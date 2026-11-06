/**
 * No analytics, no remote fonts, no third-party scripts.
 *
 * connect-src stays at https:/wss: because the Anon-RPC worker resolves its hash-pinned bundle
 * from resolvers named on-chain and dials KPS relays, which cannot be listed ahead of time.
 * Plain-http origins (a local enclave or chain) are added only when configured.
 * script-src needs 'unsafe-inline' for Next's inline runtime and the harness's srcdoc bootstrap.
 */
const isDev = process.env.NODE_ENV !== 'production';

function httpOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

const plainHttp = [
  process.env.NEXT_PUBLIC_CLOAKROOM_API_URL,
  process.env.NEXT_PUBLIC_ANON_RPC_TARGET_URL,
  process.env.NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL,
  process.env.NEXT_PUBLIC_DEV_DIRECT_RPC_URL,
]
  .map(httpOrigin)
  .filter(Boolean);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' blob: data:${isDev ? " 'unsafe-eval'" : ''}`,
  "worker-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https: wss: ${[...new Set(plainHttp)].join(' ')}${isDev ? ' ws:' : ''}`.trim(),
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Optional peer dependencies of wallet SDKs that are never used in the browser bundle.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = { ...config.resolve.fallback, '@react-native-async-storage/async-storage': false };
    // x402 payment modules referenced by the Coinbase CDP SDK inside @wagmi/connectors. Cloakroom
    // never loads that connector, so these optional modules are stubbed out instead of installed.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/core/client': false,
      '@x402/evm': false,
      '@x402/evm/exact/client': false,
      '@x402/evm/upto/client': false,
      '@x402/svm/exact/client': false,
    };
    return config;
  },
};

export default nextConfig;
