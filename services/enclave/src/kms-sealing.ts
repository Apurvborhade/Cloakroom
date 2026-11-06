import { createHash, createSecretKey, generateKeyPair } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Agent } from 'node:https';
import type { RequestOptions } from 'node:https';
import { connect } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { z } from 'zod';
import { nitroQuote } from './attestation.js';
import type { QuoteProvider } from './attestation.js';
import type { CipherBlobStore, SealingKeyProvider } from './sealed-state.js';

const pair = promisify(generateKeyPair);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new Error('KMS_SEALING_UNAVAILABLE');

export interface RecipientKms {
  generate(request: { keyArn: string; context: Record<string, string>; quote: Uint8Array }): Promise<{
    keyArn?: string; ciphertext?: Uint8Array; recipientCiphertext?: Uint8Array; plaintext?: Uint8Array;
  }>;
  decrypt(request: { keyArn: string; context: Record<string, string>; quote: Uint8Array; ciphertext: Uint8Array }): Promise<{
    keyArn?: string; recipientCiphertext?: Uint8Array; plaintext?: Uint8Array;
  }>;
}

/** TLS terminates inside the enclave, even though the parent relays the TCP bytes. */
export class KmsRelayAgent extends Agent {
  constructor(readonly endpoint: string, readonly relaySocket: string, readonly trustedCa?: string) {
    super({ keepAlive: false });
    if (!/^kms\.[a-z0-9-]+\.amazonaws\.com$/.test(endpoint)) throw unavailable();
  }
  override createConnection(options: RequestOptions): TLSSocket {
    if (options.host !== this.endpoint && options.hostname !== this.endpoint) throw unavailable();
    return connect({ path: this.relaySocket, servername: this.endpoint, rejectUnauthorized: true,
      minVersion: 'TLSv1.2', ...(this.trustedCa ? { ca: this.trustedCa } : {}) });
  }
}

/** Credentials come from the parent role; they never authorize unattested plaintext release. */
export function createRecipientKms(options: {
  region: string; relaySocket: string;
  credentials: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date }>;
}): RecipientKms {
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(options.region)) throw unavailable();
  const endpoint = `kms.${options.region}.amazonaws.com`;
  const client = new KMSClient({ region: options.region, endpoint: `https://${endpoint}`,
    credentials: options.credentials, maxAttempts: 2,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 10_000,
      httpsAgent: new KmsRelayAgent(endpoint, options.relaySocket) }),
  });
  return {
    async generate({ keyArn, context, quote }) {
      const response = await client.send(new GenerateDataKeyCommand({ KeyId: keyArn, KeySpec: 'AES_256',
        EncryptionContext: context, Recipient: { KeyEncryptionAlgorithm: 'RSAES_OAEP_SHA_256', AttestationDocument: quote } }));
      return { keyArn: response.KeyId, ciphertext: response.CiphertextBlob,
        recipientCiphertext: response.CiphertextForRecipient, plaintext: response.Plaintext };
    },
    async decrypt({ keyArn, context, quote, ciphertext }) {
      const response = await client.send(new DecryptCommand({ KeyId: keyArn, CiphertextBlob: ciphertext,
        EncryptionContext: context, Recipient: { KeyEncryptionAlgorithm: 'RSAES_OAEP_SHA_256', AttestationDocument: quote } }));
      return { keyArn: response.KeyId, recipientCiphertext: response.CiphertextForRecipient, plaintext: response.Plaintext };
    },
  };
}

/** CMS is recipient encryption, not server authentication. Call only over authenticated KMS TLS. */
async function unwrapRecipient(ciphertext: Uint8Array, privateKey: KeyObject): Promise<KeyObject> {
  if (ciphertext.byteLength === 0 || ciphertext.byteLength > 16_384) throw unavailable();
  const pem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  try {
    const plaintext = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn('python3', [fileURLToPath(new URL('../nitro/cms-decrypt.py', import.meta.url))],
        { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });
      const pieces: Buffer[] = [];
      let length = 0;
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.stdout!.on('data', (bytes: Buffer) => {
        length += bytes.length;
        if (length > 32) child.kill('SIGKILL');
        else pieces.push(bytes);
      });
      child.on('error', () => { clearTimeout(timer); reject(unavailable()); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && length === 32) resolve(Buffer.concat(pieces));
        else { for (const bytes of pieces) bytes.fill(0); reject(unavailable()); }
      });
      child.stdin!.on('error', () => undefined);
      child.stdin!.end(ciphertext);
      const secretPipe = child.stdio[3];
      if (!secretPipe || !('end' in secretPipe)) { child.kill(); reject(unavailable()); return; }
      secretPipe.on('error', () => undefined);
      secretPipe.end(pem);
    });
    try { return createSecretKey(plaintext); }
    finally { plaintext.fill(0); }
  } finally { pem.fill(0); }
}

const WRAPPED = z.object({ version: z.literal(1), keyArn: z.string(), vaultId: z.string(),
  ciphertext: z.string().min(1).max(8192),
}).strict();

export class NitroKmsSealingKey implements SealingKeyProvider {
  readonly protection = 'nitro-kms' as const;
  readonly #options: {
    keyArn: string; vaultId: string; store: CipherBlobStore; kms: RecipientKms;
    allowCreate?: boolean; quote?: QuoteProvider;
  };
  #key: Promise<KeyObject> | undefined;
  constructor(options: {
    keyArn: string; vaultId: string; store: CipherBlobStore; kms: RecipientKms;
    allowCreate?: boolean; quote?: QuoteProvider;
  }) {
    if (!/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/.test(options.keyArn)
        || !/^[a-f0-9]{64}$/.test(options.vaultId)) throw unavailable();
    this.#options = { ...options };
  }
  getKey(): Promise<KeyObject> {
    this.#key ??= this.#load().catch(() => { throw unavailable(); });
    return this.#key;
  }
  async #load(): Promise<KeyObject> {
    const options = this.#options;
    const context = { purpose: 'cloakroom/vault/v1', vaultId: options.vaultId };
    const saved = await options.store.read();
    const wrapped = saved ? WRAPPED.parse(JSON.parse(Buffer.from(saved).toString('utf8'))) : undefined;
    if (wrapped && (wrapped.keyArn !== options.keyArn || wrapped.vaultId !== options.vaultId)) throw unavailable();
    if (!wrapped && !options.allowCreate) throw unavailable();
    const keys = await pair('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' });
    const userData = createHash('sha256').update(JSON.stringify(context)).digest();
    const quote = await (options.quote ?? nitroQuote)({ publicKey, userData });
    const common = { keyArn: options.keyArn, context, quote };
    let sealed: Uint8Array | undefined;
    let response: Awaited<ReturnType<RecipientKms['decrypt']>>;
    if (wrapped) {
      sealed = Buffer.from(wrapped.ciphertext, 'base64');
      if (sealed.length === 0 || sealed.length > 6144 || Buffer.from(sealed).toString('base64') !== wrapped.ciphertext) throw unavailable();
      response = await options.kms.decrypt({ ...common, ciphertext: sealed });
    } else {
      const generated = await options.kms.generate(common);
      sealed = generated.ciphertext;
      response = generated;
    }
    if (response.keyArn !== options.keyArn || response.plaintext !== undefined || !response.recipientCiphertext
        || !sealed || sealed.byteLength === 0 || sealed.byteLength > 6144) throw unavailable();
    const key = await unwrapRecipient(response.recipientCiphertext, keys.privateKey);
    if (!wrapped) await options.store.compareAndSwap(saved ? hash(saved) : null, Buffer.from(JSON.stringify({
      version: 1, keyArn: options.keyArn, vaultId: options.vaultId, ciphertext: Buffer.from(sealed).toString('base64'),
    })));
    return key;
  }
}
