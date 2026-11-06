import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { Hex } from 'viem';
import { MAX_BODY_SIZE_BYTES } from './constants.js';
import type { Envelope } from './schemas/envelope.js';

export const HPKE_PARAMETERS = Object.freeze({
  version: 1, kem: 0x0020, kdf: 0x0001, aead: 0x0002,
  info: 'cloakroom/hpke/v1', maxPlaintextBytes: MAX_BODY_SIZE_BYTES,
});

export interface EnvelopeContext {
  chainId: number;
  path: string;
  enclavePubKey: Hex;
}

export interface EncryptedResponse { nonce: string; ct: string }
const RESPONSE_LABEL = new TextEncoder().encode('cloakroom/hpke/response/v1');

/** Request-bound response encryption. */
export async function createResponseChannel(
  exporter: { export(context: Uint8Array, length: number): Promise<ArrayBuffer> },
  context: EnvelopeContext,
): Promise<{ seal(payload: unknown): Promise<EncryptedResponse>; open(response: EncryptedResponse): Promise<unknown> }> {
  const key = new Uint8Array(await exporter.export(RESPONSE_LABEL, 32));
  const cipher = new Aes256Gcm().createEncryptionContext(key.slice().buffer);
  key.fill(0);
  const aad = new TextEncoder().encode(`response:${new TextDecoder().decode(envelopeAad(context))}`);
  let used = false;
  return {
    async seal(payload) {
      if (used) throw new Error('RESPONSE_ALREADY_USED');
      used = true;
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      if (plaintext.length > HPKE_PARAMETERS.maxPlaintextBytes) throw new Error('INVALID_PAYLOAD');
      // Replayed requests recreate the same key, so each reply needs a fresh nonce.
      const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await cipher.seal(nonce, plaintext, aad);
      return { nonce: encodeBase64(nonce), ct: encodeBase64(new Uint8Array(ciphertext)) };
    },
    async open(response) {
      if (used) throw new Error('RESPONSE_ALREADY_USED');
      used = true;
      try {
        if (!response || Object.keys(response).sort().join(',') !== 'ct,nonce') throw new Error();
        const nonce = decodeBase64(response.nonce, 12);
        if (nonce.length !== 12) throw new Error();
        const ct = decodeBase64(response.ct, HPKE_PARAMETERS.maxPlaintextBytes + 16);
        const plaintext = await cipher.open(nonce, ct, aad);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
      } catch { throw new Error('INVALID_PAYLOAD'); }
    },
  };
}

export function createTransportSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm(),
  });
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(encoded: string, maxBytes: number): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length === 0
      || encoded.length > Math.ceil(maxBytes / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('INVALID_PAYLOAD');
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.length > maxBytes || encodeBase64(bytes) !== encoded) throw new Error('INVALID_PAYLOAD');
  return bytes;
}

export function transportPublicKey(hex: Hex): Uint8Array {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('INVALID_PAYLOAD');
  return Uint8Array.from(hex.slice(2).match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

export function envelopeAad(context: EnvelopeContext): Uint8Array {
  transportPublicKey(context.enclavePubKey);
  if (!Number.isSafeInteger(context.chainId) || context.chainId <= 0
      || !/^\/[a-z0-9/-]{1,100}$/.test(context.path)) throw new Error('INVALID_PAYLOAD');
  return new TextEncoder().encode(JSON.stringify([
    HPKE_PARAMETERS.version, context.chainId, context.path, context.enclavePubKey.toLowerCase(),
  ]));
}

/** Browser-safe sealing; every request uses a new sender context and encapsulated key. */
export async function sealEnvelope(payload: unknown, context: EnvelopeContext): Promise<Envelope> {
  return (await sealEnvelopeWithResponse(payload, context)).envelope;
}

export async function sealEnvelopeWithResponse(payload: unknown, context: EnvelopeContext): Promise<{
  envelope: Envelope; openResponse(response: EncryptedResponse): Promise<unknown>;
}> {
  try {
    const encoded = JSON.stringify(payload);
    if (encoded === undefined) throw new Error();
    const plaintext = new TextEncoder().encode(encoded);
    if (plaintext.length > HPKE_PARAMETERS.maxPlaintextBytes) throw new Error();
    const suite = createTransportSuite();
    const recipientPublicKey = await suite.kem.deserializePublicKey(transportPublicKey(context.enclavePubKey));
    const sender = await suite.createSenderContext({
      recipientPublicKey, info: new TextEncoder().encode(HPKE_PARAMETERS.info),
    });
    const ciphertext = await sender.seal(plaintext, envelopeAad(context));
    const response = await createResponseChannel(sender, context);
    return {
      envelope: { enc: encodeBase64(new Uint8Array(sender.enc)), ct: encodeBase64(new Uint8Array(ciphertext)) },
      openResponse: response.open,
    };
  } catch {
    throw new Error('INVALID_PAYLOAD');
  }
}
