// @vitest-environment node
import { createTransportSuite } from '@cloakroom/shared';
import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { openEnvelopeWithResponse } from '../../../services/enclave/src/envelope';
import { isEncryptedResponse, sealRequest } from '@/lib/crypto/transport';
import { ApiError } from '@/lib/api/errors';

async function enclaveKeys() {
  const suite = createTransportSuite();
  const pair = await suite.kem.generateKeyPair();
  const raw = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
  return { privateKey: pair.privateKey, publicHex: `0x${Buffer.from(raw).toString('hex')}` as Hex };
}

describe('HPKE request sealing and response opening (shared transport, enclave envelope code)', () => {
  it('seals for the route path and opens the enclave reply exactly once', async () => {
    const keys = await enclaveKeys();
    const context = { chainId: 11155111, enclavePubKey: keys.publicHex };
    const sealed = await sealRequest({ hello: 'enclave' }, '/balance', context);
    expect(Object.keys(sealed.envelope).sort()).toEqual(['ct', 'enc']);
    expect(JSON.stringify(sealed.envelope)).not.toContain('hello');

    const server = await openEnvelopeWithResponse(keys.privateKey, sealed.envelope, { ...context, path: '/balance' });
    expect(server.payload).toEqual({ hello: 'enclave' });
    const reply = await server.sealResponse({ balances: [] });
    expect(isEncryptedResponse(reply)).toBe(true);
    expect(await sealed.openResponse(reply)).toEqual({ balances: [] });
    await expect(sealed.openResponse(reply)).rejects.toThrow('RESPONSE_ALREADY_USED');
  });

  it('cannot be opened for a different path, chain or key', async () => {
    const keys = await enclaveKeys();
    const context = { chainId: 11155111, enclavePubKey: keys.publicHex };
    const sealed = await sealRequest({ a: 1 }, '/withdrawals', context);
    await expect(openEnvelopeWithResponse(keys.privateKey, sealed.envelope, { ...context, path: '/balance' })).rejects.toThrow();
    await expect(openEnvelopeWithResponse(keys.privateKey, sealed.envelope, { ...context, chainId: 1, path: '/withdrawals' })).rejects.toThrow();
    const other = await enclaveKeys();
    await expect(openEnvelopeWithResponse(other.privateKey, sealed.envelope, { chainId: 11155111, enclavePubKey: other.publicHex, path: '/withdrawals' })).rejects.toThrow();
  });

  it('rejects a reply that was modified', async () => {
    const keys = await enclaveKeys();
    const context = { chainId: 11155111, enclavePubKey: keys.publicHex };
    const sealed = await sealRequest({ a: 1 }, '/intents', context);
    const server = await openEnvelopeWithResponse(keys.privateKey, sealed.envelope, { ...context, path: '/intents' });
    const reply = await server.sealResponse({ ok: true });
    const flipped = reply.ct.startsWith('A') ? `B${reply.ct.slice(1)}` : `A${reply.ct.slice(1)}`;
    await expect(sealed.openResponse({ nonce: reply.nonce, ct: flipped })).rejects.toThrow('INVALID_PAYLOAD');
  });

  it('turns a bad enclave key into SEAL_FAILED', async () => {
    await expect(sealRequest({}, '/balance', { chainId: 1, enclavePubKey: '0x1234' })).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'SEAL_FAILED',
    );
  });

  it('recognises only the encrypted response shape', () => {
    expect(isEncryptedResponse({ nonce: 'a', ct: 'b' })).toBe(true);
    expect(isEncryptedResponse({ nonce: 'a', ct: 'b', extra: 1 })).toBe(false);
    expect(isEncryptedResponse({ balances: [] })).toBe(false);
    expect(isEncryptedResponse(null)).toBe(false);
  });
});
