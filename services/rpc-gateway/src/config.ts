import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { validHostname } from './identity.js';

export interface RpcConfig {
  hostname: string; chainId: number; upstreamUrl: string; noxRegistryRpcUrl: string; noxRegistryAddress: string;
  kmsKeyArn: string; kmsRegion: string; vaultId: string;
}
function httpsUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && !url.hash && (!url.port || url.port === '443'); } catch { return false; }
}
export function decodeConfig(bytes: Buffer, commitment: string): RpcConfig {
  if (!/^[0-9a-f]{64}$/.test(commitment) || bytes.length > 65_536
    || createHash('sha256').update(bytes).digest('hex') !== commitment) throw new Error('RPC_CONFIG_MISMATCH');
  const value = JSON.parse(bytes.toString('utf8')) as RpcConfig;
  if (!value || typeof value.hostname !== 'string' || !validHostname(value.hostname)
    || !Number.isSafeInteger(value.chainId) || value.chainId < 1
    || !httpsUrl(value.upstreamUrl) || !httpsUrl(value.noxRegistryRpcUrl)
    || !/^0x[0-9a-fA-F]{40}$/.test(value.noxRegistryAddress)
    || !/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/.test(value.kmsKeyArn)
    || !/^[a-z]{2}-[a-z]+-\d$/.test(value.kmsRegion)
    || !/^[0-9a-f]{64}$/.test(value.vaultId)
    || Object.keys(value).length !== 8) throw new Error('INVALID_RPC_CONFIG');
  return Object.freeze(value);
}
export async function readConfig(commitment: string, socketPath = '\0cloakroom-config'): Promise<RpcConfig> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const socket = connect(socketPath), parts: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => socket.destroy(new Error('RPC_CONFIG_TIMEOUT')), 5000);
    socket.once('connect', () => socket.write('GET\n'));
    socket.on('data', (part: Buffer) => {
      size += part.length;
      if (size > 65_540) socket.destroy(new Error('RPC_CONFIG_TOO_LARGE')); else parts.push(part);
    });
    socket.once('error', reject);
    socket.once('close', () => clearTimeout(timer));
    socket.once('end', () => {
      const raw = Buffer.concat(parts);
      if (raw.length < 4 || raw.readUInt32BE() !== raw.length - 4) reject(new Error('RPC_CONFIG_UNAVAILABLE'));
      else resolve(raw.subarray(4));
      socket.destroy();
    });
  });
  return decodeConfig(bytes, commitment);
}
