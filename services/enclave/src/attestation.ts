import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const helper = fileURLToPath(new URL('../nitro/nsm.py', import.meta.url));

export type AttestationResponse = {
  quote: string;
  enclavePubKey: string;
  buildHash: string;
  chainId: number;
};

type QuoteRequest = { publicKey: Buffer; userData: Buffer; nonce?: Buffer };
export type QuoteProvider = (request: QuoteRequest) => Promise<Buffer>;

export const nitroQuote: QuoteProvider = async ({ publicKey, userData, nonce }) => {
  const { stdout } = await run('/opt/nsm/bin/python', [
    helper, publicKey.toString('hex'), userData.toString('hex'),
    ...(nonce ? [nonce.toString('hex')] : []),
  ], { timeout: 10_000, maxBuffer: 32_768 });
  const encoded = stdout.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid NSM output');
  const document = Buffer.from(encoded, 'base64');
  if (document.length === 0 || document.length > 16_384) throw new Error('Invalid quote size');
  return document;
};

export class AttestationService {
  readonly #privateKey = generateKeyPairSync('x25519').privateKey;

  constructor(readonly buildHash: string, readonly provider: QuoteProvider = nitroQuote) {
    if (!/^[a-f0-9]{64}$/.test(buildHash)) throw new Error('Invalid build hash');
  }

  async response(nonce?: Buffer): Promise<AttestationResponse> {
    if (nonce && (nonce.length < 32 || nonce.length > 64)) throw new Error('Invalid nonce');
    const jwk = createPublicKey(this.#privateKey).export({ format: 'jwk' });
    const publicKey = Buffer.from(jwk.x!, 'base64url');
    const userData = createHash('sha256')
      .update(publicKey).update(Buffer.from(this.buildHash, 'hex')).digest();
    // The raw X25519 public key also occupies the signed public_key field.
    const quote = await this.provider({ publicKey, userData, nonce });
    return {
      quote: quote.toString('base64'),
      enclavePubKey: `0x${publicKey.toString('hex')}`,
      buildHash: `0x${this.buildHash}`,
      chainId: 11155111,
    };
  }
}
