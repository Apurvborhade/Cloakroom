import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ENV_VARIABLES, loadConfig } from './config.js';

const MAX_BYTES = 65_536;
const VARIABLES = new Set<string>([...ENV_VARIABLES, 'KMS_KEY_ARN', 'KMS_REGION', 'VAULT_ID']);
const unavailable = () => new Error('NITRO_CONFIG_UNAVAILABLE');

/** Only the image's committed configuration may select custody and signing policy. */
export function decodeNitroConfig(bytes: Uint8Array, expectedHash: string): Readonly<Record<string, string>> {
  try {
    if (bytes.byteLength > MAX_BYTES || !/^[a-f0-9]{64}$/.test(expectedHash)
        || createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw unavailable();
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw unavailable();
    const env: Record<string, string> = Object.create(null);
    for (const [name, entry] of Object.entries(value)) {
      if (!VARIABLES.has(name) || typeof entry !== 'string') throw unavailable();
      env[name] = entry;
    }
    if (loadConfig(env).SIM_MODE || !env.KMS_KEY_ARN || !env.KMS_REGION
        || !/^[a-f0-9]{64}$/.test(env.VAULT_ID ?? '')) throw unavailable();
    return Object.freeze(env);
  } catch { throw unavailable(); }
}

function readFrame(socketPath: string, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = connect(socketPath);
    const parts: Buffer[] = [];
    let size = 0;
    const finish = (data?: Buffer, error?: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (data) resolve(data); else reject(error ?? unavailable());
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on('error', (error) => finish(undefined, error));
    socket.once('connect', () => socket.write('GET\n'));
    socket.on('data', (part: Buffer) => {
      size += part.length;
      if (size > MAX_BYTES + 4) { finish(); return; }
      parts.push(part);
    });
    socket.on('end', () => {
      const response = Buffer.concat(parts);
      if (response.length < 4 || response.readUInt32BE() !== response.length - 4) { finish(); return; }
      finish(response.subarray(4));
    });
  });
}

export async function readNitroConfig(expectedHash: string, socketPath = '\0cloakroom-config', timeoutMs = 5000) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw unavailable();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return decodeNitroConfig(await readFrame(socketPath, deadline - Date.now()), expectedHash);
    } catch (error) {
      // The bridge starts its Unix relay alongside Node.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ECONNREFUSED') throw unavailable();
      await delay(Math.min(25, Math.max(0, deadline - Date.now())));
    }
  }
  throw unavailable();
}
