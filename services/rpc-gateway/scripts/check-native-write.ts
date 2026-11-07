import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createNoxTransport } from '../src/nox.js';
import { createRelayFetch } from '../src/egress.js';

const { NOX_REGISTRY_RPC, NOX_REGISTRY_ADDRESS, RPC_UPSTREAM_URL, NOX_RELAY_SOCKET } = process.env;
if (!NOX_REGISTRY_RPC || !NOX_REGISTRY_ADDRESS || !RPC_UPSTREAM_URL) throw new Error('PROBE_CONFIG_REQUIRED');
const relay = NOX_RELAY_SOCKET ? createRelayFetch(NOX_RELAY_SOCKET) : undefined;
const transport = await createNoxTransport(RPC_UPSTREAM_URL, { ethRpcUrl: NOX_REGISTRY_RPC, registryAddress: NOX_REGISTRY_ADDRESS,
  ...(relay ? { transport: { fetch: relay.fetch, WebSocket: null } } : {}) });
try {
  const chain = await transport.send({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, AbortSignal.timeout(45_000));
  assert.equal(chain.result, '0xaa36a7', 'SEPOLIA_REQUIRED');
  const account = privateKeyToAccount(generatePrivateKey());
  const raw = await account.signTransaction({ chainId: 11155111, type: 'eip1559', nonce: 0, gas: 21_000n,
    maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, to: account.address, value: 1n });
  const reply = await transport.send({ jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: [raw] }, AbortSignal.timeout(45_000));
  assert(reply.error && /insufficient funds/i.test(reply.error.message), 'EXPECTED_UNFUNDED_REJECTION');
  console.log(JSON.stringify({ sepoliaRead: true, signedWriteReachedUpstream: true, assetsSpent: false, e2eTls: true }));
} catch { console.error('NATIVE_NOX_PROBE_FAILED'); process.exitCode = 1; }
finally { transport.close(); relay?.close(); }
