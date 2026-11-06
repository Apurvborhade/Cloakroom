import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { Hex } from 'viem';

export const MAX_BODY_SIZE_BYTES = 16 * 1024; // 16 KB

export const HPKE_PARAMETERS = Object.freeze({
  version: 1,
  kem: 0x0020,
  kdf: 0x0001,
  aead: 0x0002,
  info: 'cloakroom/hpke/v1',
  maxPlaintextBytes: MAX_BODY_SIZE_BYTES,
});

export interface EnvelopeContext {
  chainId: number;
  path: string;
  enclavePubKey: Hex;
}

export interface Envelope {
  enc: string;
  ct: string;
}

export interface EncryptedResponse {
  nonce: string;
  ct: string;
}

const RESPONSE_LABEL = new TextEncoder().encode('cloakroom/hpke/response/v1');

export function createTransportSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(encoded: string, maxBytes: number): Uint8Array {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    encoded.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error('INVALID_PAYLOAD');
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.length > maxBytes || encodeBase64(bytes) !== encoded) {
    throw new Error('INVALID_PAYLOAD');
  }
  return bytes;
}

export function transportPublicKey(hex: Hex): Uint8Array {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('INVALID_PAYLOAD');
  }
  return Uint8Array.from(hex.slice(2).match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

export function envelopeAad(context: EnvelopeContext): Uint8Array {
  transportPublicKey(context.enclavePubKey);
  if (
    !Number.isSafeInteger(context.chainId) ||
    context.chainId <= 0 ||
    !/^\/[a-z0-9/-]{1,100}$/.test(context.path)
  ) {
    throw new Error('INVALID_PAYLOAD');
  }
  return new TextEncoder().encode(
    JSON.stringify([
      HPKE_PARAMETERS.version,
      context.chainId,
      context.path,
      context.enclavePubKey.toLowerCase(),
    ])
  );
}

/** Request-bound response decryption. */
export async function createResponseChannel(
  exporter: { export(context: Uint8Array, length: number): Promise<ArrayBuffer> },
  context: EnvelopeContext
): Promise<{ open(response: EncryptedResponse): Promise<unknown> }> {
  const key = new Uint8Array(await exporter.export(RESPONSE_LABEL, 32));
  const cipher = new Aes256Gcm().createEncryptionContext(key.slice().buffer);
  key.fill(0);
  const aad = new TextEncoder().encode(`response:${new TextDecoder().decode(envelopeAad(context))}`);
  let used = false;

  return {
    async open(response: EncryptedResponse): Promise<unknown> {
      if (used) throw new Error('RESPONSE_ALREADY_USED');
      used = true;
      try {
        if (!response || Object.keys(response).sort().join(',') !== 'ct,nonce') {
          throw new Error();
        }
        const nonce = decodeBase64(response.nonce, 12);
        if (nonce.length !== 12) throw new Error();
        const ct = decodeBase64(response.ct, HPKE_PARAMETERS.maxPlaintextBytes + 16);
        const plaintext = await cipher.open(nonce, ct, aad);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
      } catch {
        throw new Error('INVALID_PAYLOAD');
      }
    },
  };
}

/**
 * Seals an arbitrary JSON payload into an HPKE envelope bound to the enclave public key and path context.
 * Returns the wire envelope `{ enc, ct }` and an `openResponse` method to decrypt the enclave's encrypted reply.
 */
export async function sealEnvelopeWithResponse(
  payload: unknown,
  context: EnvelopeContext
): Promise<{
  envelope: Envelope;
  openResponse(response: EncryptedResponse): Promise<unknown>;
}> {
  try {
    const encoded = JSON.stringify(payload);
    if (encoded === undefined) throw new Error('EMPTY_PAYLOAD');
    const plaintext = new TextEncoder().encode(encoded);
    if (plaintext.length > HPKE_PARAMETERS.maxPlaintextBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    const suite = createTransportSuite();
    const recipientPublicKey = await suite.kem.deserializePublicKey(
      transportPublicKey(context.enclavePubKey)
    );
    const sender = await suite.createSenderContext({
      recipientPublicKey,
      info: new TextEncoder().encode(HPKE_PARAMETERS.info),
    });
    const ciphertext = await sender.seal(plaintext, envelopeAad(context));
    const responseChannel = await createResponseChannel(sender, context);
    return {
      envelope: {
        enc: encodeBase64(new Uint8Array(sender.enc)),
        ct: encodeBase64(new Uint8Array(ciphertext)),
      },
      openResponse: responseChannel.open,
    };
  } catch (err: any) {
    if (err?.message === 'PAYLOAD_TOO_LARGE') throw err;
    throw new Error('INVALID_PAYLOAD');
  }
}
