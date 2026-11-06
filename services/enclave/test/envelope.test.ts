import { describe, expect, it } from 'vitest';
import { createTransportSuite, encodeBase64, HPKE_PARAMETERS, sealEnvelope, sealEnvelopeWithResponse } from '@cloakroom/shared';
import type { EncryptedResponse, EnvelopeContext } from '@cloakroom/shared';
import type { Hex } from 'viem';
import { openEnvelope, openEnvelopeWithResponse } from '../src/envelope.js';

async function recipient() {
  const suite = createTransportSuite();
  const key = await suite.kem.generateKeyPair();
  const bytes = new Uint8Array(await suite.kem.serializePublicKey(key.publicKey));
  const enclavePubKey = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex;
  const context: EnvelopeContext = { enclavePubKey, chainId: 11155111, path: '/withdrawals' };
  return { key, context };
}

describe('HPKE transport', () => {
  it('round-trips a wallet-signed request using the browser sealing function', async () => {
    const { key, context } = await recipient();
    const request = { message: { amount: '1000000000000000000', nonce: '9' }, signature: '0x1234' };
    expect(await openEnvelope(key.privateKey, await sealEnvelope(request, context), context)).toEqual(request);
  });

  it('uses independent sender contexts, including concurrent requests', async () => {
    const { key, context } = await recipient();
    const envelopes = await Promise.all(Array.from({ length: 16 }, (_, n) => sealEnvelope({ n }, context)));
    expect(new Set(envelopes.map((envelope) => envelope.enc)).size).toBe(16);
    expect(await Promise.all(envelopes.map((envelope) => openEnvelope(key.privateKey, envelope, context))))
      .toEqual(Array.from({ length: 16 }, (_, n) => ({ n })));
  });

  it('keeps responses confidential when an encrypted request is replayed', async () => {
    const { key, context } = await recipient();
    const client = await sealEnvelopeWithResponse({ query: 'balance' }, context);
    const first = await openEnvelopeWithResponse(key.privateKey, client.envelope, context);
    const replay = await openEnvelopeWithResponse(key.privateKey, client.envelope, context);
    const known = { balance: '1000000000000000000' };
    const updated = { balance: '9000000000000000000' };
    const response = await first.sealResponse(known);
    const replayResponse = await replay.sealResponse(updated);
    const c1 = Buffer.from(response.ct, 'base64');
    const c2 = Buffer.from(replayResponse.ct, 'base64');
    const plaintext = Buffer.from(JSON.stringify(known));
    const recovered = Buffer.from(plaintext.map((byte, index) => byte ^ c1[index]! ^ c2[index]!));

    expect(recovered.equals(Buffer.from(JSON.stringify(updated)))).toBe(false);
    expect(Buffer.from(response.nonce, 'base64')).toHaveLength(12);
    expect(response.nonce).not.toBe(replayResponse.nonce);
    expect(await client.openResponse(replayResponse)).toEqual(updated);
  });

  it.each(['modified', 'missing', 'short', 'long', 'invalid-base64', 'extra-field'] as const)(
    'rejects a response with %s nonce data', async (variation) => {
      const { key, context } = await recipient();
      const client = await sealEnvelopeWithResponse({}, context);
      const server = await openEnvelopeWithResponse(key.privateKey, client.envelope, context);
      const response = await server.sealResponse({ balance: '1' });
      let changed: unknown;
      switch (variation) {
        case 'modified': {
          const nonce = Buffer.from(response.nonce, 'base64');
          nonce[0] = nonce[0]! ^ 1;
          changed = { ...response, nonce: nonce.toString('base64') };
          break;
        }
        case 'missing': changed = { ct: response.ct }; break;
        case 'short': changed = { ...response, nonce: encodeBase64(new Uint8Array(11)) }; break;
        case 'long': changed = { ...response, nonce: encodeBase64(new Uint8Array(13)) }; break;
        case 'invalid-base64': changed = { ...response, nonce: response.nonce + '\n' }; break;
        case 'extra-field': changed = { ...response, extra: true }; break;
      }
      await expect(client.openResponse(changed as EncryptedResponse)).rejects.toThrow('INVALID_PAYLOAD');
    },
  );

  it('rejects tampered ciphertext, wrong recipient, wrong route and wrong chain', async () => {
    const { key, context } = await recipient();
    const envelope = await sealEnvelope({ amount: '7' }, context);
    const bytes = Uint8Array.from(atob(envelope.ct), (char) => char.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 1;
    for (const [secret, body, binding] of [
      [key.privateKey, { ...envelope, ct: encodeBase64(bytes) }, context],
      [(await recipient()).key.privateKey, envelope, context],
      [key.privateKey, envelope, { ...context, path: '/intents' }],
      [key.privateKey, envelope, { ...context, chainId: 1 }],
    ] as const) {
      await expect(openEnvelope(secret, body, binding)).rejects.toThrow('INVALID_PAYLOAD');
    }
  });

  it('rejects malformed base64, truncated encapsulations and extra fields', async () => {
    const { key, context } = await recipient();
    const envelope = await sealEnvelope({ ok: true }, context);
    for (const body of [
      { ...envelope, enc: '!!!!' }, { ...envelope, enc: encodeBase64(new Uint8Array(31)) },
      { ...envelope, ct: envelope.ct + '\n' }, { ...envelope, extra: true },
    ]) await expect(openEnvelope(key.privateKey, body, context)).rejects.toThrow('INVALID_PAYLOAD');
  });

  it('enforces the plaintext cap and rejects non-object decrypted JSON', async () => {
    const { key, context } = await recipient();
    await expect(sealEnvelope({ text: 'x'.repeat(HPKE_PARAMETERS.maxPlaintextBytes) }, context)).rejects.toThrow('INVALID_PAYLOAD');
    for (const value of [null, [], 'text', 1]) {
      const envelope = await sealEnvelope(value, context);
      await expect(openEnvelope(key.privateKey, envelope, context)).rejects.toThrow('INVALID_PAYLOAD');
    }
  });
});
