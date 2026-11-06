// @vitest-environment node
import { createTransportSuite, BalanceResponseSchema } from '@cloakroom/shared';
import type { Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { openEnvelopeWithResponse } from '../../../services/enclave/src/envelope';
import { CloakroomApi } from '@/lib/api/client';
import { ApiError, describeError, isUserRejection } from '@/lib/api/errors';

async function keys() {
  const suite = createTransportSuite();
  const pair = await suite.kem.generateKeyPair();
  const raw = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
  return { privateKey: pair.privateKey, publicHex: `0x${Buffer.from(raw).toString('hex')}` as Hex };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: unknown) => (error instanceof ApiError ? error.code : 'other'));

describe('CloakroomApi', () => {
  it('never sends plaintext to a private route and validates the opened reply', async () => {
    const k = await keys();
    const context = { chainId: 11155111, enclavePubKey: k.publicHex };
    const sent: string[] = [];
    const telemetry = { onSuccess: vi.fn(), onError: vi.fn() };
    const api = new CloakroomApi({
      baseUrl: 'https://api.example',
      telemetry,
      fetchFn: async (url, init) => {
        sent.push(String(init?.body));
        expect(url).toBe('https://api.example/balance');
        const server = await openEnvelopeWithResponse(k.privateKey, JSON.parse(String(init?.body)), { ...context, path: '/balance' });
        return json(await server.sealResponse({ balances: [{ token: `0x${'00'.repeat(20)}`, available: '1', reserved: '0', pending: '0' }] }));
      },
    });
    const result = await api.postPrivate('/balance', { message: { owner: 'secret-owner' }, signature: '0xsig' }, context, BalanceResponseSchema);
    expect(result.balances[0]!.available).toBe('1');
    expect(sent[0]).not.toContain('secret-owner');
    expect(sent[0]).not.toContain('0xsig');
    expect(telemetry.onSuccess).toHaveBeenCalledWith('/balance');
  });

  it('maps plaintext error codes and never leaks payloads to telemetry', async () => {
    const k = await keys();
    const context = { chainId: 1, enclavePubKey: k.publicHex };
    const telemetry = { onError: vi.fn() };
    const cases: Array<[Response, string]> = [
      [json({ error: 'INSUFFICIENT_BALANCE' }, 400), 'INSUFFICIENT_BALANCE'],
      [json({ error: 'UNKNOWN_SESSION' }, 401), 'UNKNOWN_SESSION'],
      [json({ error: 'NONCE_USED' }, 409), 'NONCE_USED'],
      [json({ error: 'NO_INVENTORY' }, 409), 'NO_INVENTORY'],
      [json({ error: 'INTENT_NOT_FOUND' }, 404), 'INTENT_NOT_FOUND'],
      [json({ error: 'INVALID_PAYLOAD' }, 404), 'ROUTE_NOT_FOUND'],
      [json({ error: 'INVALID_PAYLOAD' }, 400), 'INVALID_PAYLOAD'],
      [json({ error: 'SOMETHING_NEW' }, 500), 'INTERNAL_ERROR'],
      [new Response('rate limited', { status: 429 }), 'RATE_LIMITED'],
      [new Response('<html>', { status: 502 }), 'BAD_RESPONSE'],
      [json({ not: 'encrypted' }), 'BAD_RESPONSE'],
      [json({ nonce: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAAAA' }), 'BAD_RESPONSE'],
    ];
    for (const [response, expected] of cases) {
      const api = new CloakroomApi({ baseUrl: 'https://api.example', telemetry, fetchFn: async () => response });
      expect(await codeOf(api.postPrivate('/balance', { secret: 'x' }, context, BalanceResponseSchema))).toBe(expected);
    }
    for (const call of telemetry.onError.mock.calls) {
      expect(call).toHaveLength(2);
      expect(JSON.stringify(call)).not.toContain('secret');
    }
  });

  it('reports network failures and missing configuration', async () => {
    const k = await keys();
    const context = { chainId: 1, enclavePubKey: k.publicHex };
    const offline = new CloakroomApi({ baseUrl: 'https://api.example', fetchFn: async () => { throw new TypeError('fetch failed'); } });
    expect(await codeOf(offline.postPrivate('/balance', {}, context, BalanceResponseSchema))).toBe('NETWORK_ERROR');
    const unconfigured = new CloakroomApi({ baseUrl: null });
    expect(await codeOf(unconfigured.getAttestation())).toBe('NOT_CONFIGURED');
  });

  it('rejects a decrypted reply that does not match the schema', async () => {
    const k = await keys();
    const context = { chainId: 1, enclavePubKey: k.publicHex };
    const api = new CloakroomApi({
      baseUrl: 'https://api.example',
      fetchFn: async (_url, init) => {
        const server = await openEnvelopeWithResponse(k.privateKey, JSON.parse(String(init?.body)), { ...context, path: '/balance' });
        return json(await server.sealResponse({ balances: [{ token: 'nope' }] }));
      },
    });
    expect(await codeOf(api.postPrivate('/balance', {}, context, BalanceResponseSchema))).toBe('BAD_RESPONSE');
  });

  it('validates the attestation response shape', async () => {
    const api = new CloakroomApi({ baseUrl: 'https://api.example', fetchFn: async () => json({ quote: 'q', enclavePubKey: '0x12', buildHash: '0x34', chainId: 1 }) });
    expect(await codeOf(api.getAttestation())).toBe('BAD_RESPONSE');
  });

  it('describes errors for people and detects wallet rejections', () => {
    expect(describeError(new ApiError('NO_INVENTORY'))).toMatch(/released/);
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ name: 'Wrapped', cause: { name: 'UserRejectedRequestError' } })).toBe(true);
    expect(isUserRejection(new Error('boom'))).toBe(false);
  });
});
