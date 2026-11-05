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
    return { enc: encodeBase64(new Uint8Array(sender.enc)), ct: encodeBase64(new Uint8Array(ciphertext)) };
  } catch {
    throw new Error('INVALID_PAYLOAD');
  }
}
