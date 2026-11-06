import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createDomain, deriveEnclaveSalt, EIP712_TYPES, sealEnvelopeWithResponse,
  SignedAdminEoasSchema } from '@cloakroom/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { custodyRoutes } from '../src/custody-routes.js';
import { KeyManager } from '../src/keys.js';
import { AttestationService } from '../src/attestation.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';

// Public, deterministic test identities. They never control funded accounts.
const ADMIN = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const NOW = 1_800_000_000n;
const CHAIN = 11155111;

async function setup(enabled = true) {
  const { journal } = memoryJournal();
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('aa'.repeat(32), true), true);
  const options = { journal, vault, simMode: true, allowCreate: true,
    policy: { chainId: CHAIN, maxGas: 100_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 5n, maxNativeValue: 10n } };
  const keys = new KeyManager(options);
  await keys.init();
  const inventory = await keys.allocate('inventory');
  const deposit = await keys.allocate('deposit');
  const app = Fastify({ logger: false });
  const mount = async (target: typeof app, manager: KeyManager) => custodyRoutes(target, {
    keys: manager, adminAddress: ADMIN.address, seedingEnabled: enabled, chainId: CHAIN, now: () => NOW,
  });
  await mount(app, keys);
  async function request(overrides: { signer?: typeof ADMIN; expiry?: bigint; chainId?: number; salt?: `0x${string}`; path?: string; signature?: `0x${string}` } = {}) {
    const message = { admin: (overrides.signer ?? ADMIN).address, nonce: 1n, expiry: overrides.expiry ?? NOW + 60n };
    const signature = await (overrides.signer ?? ADMIN).signTypedData({
      domain: createDomain(overrides.chainId ?? CHAIN, overrides.salt ?? deriveEnclaveSalt(keys.transportPublicKey())),
      types: EIP712_TYPES, primaryType: 'AdminEoas', message,
    });
    return sealEnvelopeWithResponse({ message: { ...message, nonce: '1', expiry: message.expiry.toString() }, signature: overrides.signature ?? signature },
      { chainId: CHAIN, path: overrides.path ?? '/admin/eoas', enclavePubKey: keys.transportPublicKey() });
  }
  return { app, keys, options, inventory, deposit, request, mount };
}

describe('one-time encrypted seeding', () => {
  it('authenticates the admin, returns only inventory, and stays consumed after restart', async () => {
    const { app, keys, options, inventory, deposit, request, mount } = await setup();
    const client = await request();
    const response = await app.inject({ method: 'POST', url: '/admin/eoas', payload: client.envelope });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(inventory.address);
    expect(await client.openResponse(response.json())).toEqual({ addresses: [inventory.address] });
    expect(response.body).not.toContain(deposit.address);
    await expect(client.openResponse(response.json())).rejects.toThrow('RESPONSE_ALREADY_USED');
    const restarted = new KeyManager({ ...options, allowCreate: false });
    await restarted.init();
    expect(restarted.transportPublicKey()).toBe(keys.transportPublicKey());
    const second = Fastify({ logger: false });
    await mount(second, restarted);
    const retry = await request();
    expect((await second.inject({ method: 'POST', url: '/admin/eoas', payload: retry.envelope })).statusCode).toBe(403);
    await Promise.all([app.close(), second.close()]);
  });

  it('permits only one concurrent disclosure', async () => {
    const { app, request } = await setup();
    const requests = await Promise.all(Array.from({ length: 8 }, () => request()));
    const results = await Promise.all(requests.map(({ envelope }) =>
      app.inject({ method: 'POST', url: '/admin/eoas', payload: envelope })));
    expect(results.filter((item) => item.statusCode === 200)).toHaveLength(1);
    expect(results.filter((item) => item.statusCode === 403)).toHaveLength(7);
    await app.close();
  });

  it('rejects another wallet, domain, expired and excessively future signatures without consuming seeding', async () => {
    const { app, request } = await setup();
    for (const [overrides, status] of [
      [{ signer: OTHER }, 403], [{ signature: `0x${'00'.repeat(65)}` as const }, 403], [{ chainId: 1 }, 403], [{ salt: `0x${'00'.repeat(32)}` as const }, 403],
      [{ expiry: NOW - 1n }, 400], [{ expiry: NOW + 301n }, 400], [{ path: '/balance' }, 400],
    ] as const) {
      const client = await request(overrides);
      expect((await app.inject({ method: 'POST', url: '/admin/eoas', payload: client.envelope })).statusCode).toBe(status);
    }
    const valid = await request();
    expect((await app.inject({ method: 'POST', url: '/admin/eoas', payload: valid.envelope })).statusCode).toBe(200);
    await app.close();
  });

  it('does not register the endpoint when seeding is disabled and rejects plaintext when enabled', async () => {
    const disabled = await setup(false);
    expect((await disabled.app.inject({ method: 'POST', url: '/admin/eoas', payload: {} })).statusCode).toBe(404);
    await disabled.app.close();
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/admin/eoas', payload: {} })).json()).toEqual({ error: 'INVALID_PAYLOAD' });
    await app.close();
  });

  it('rejects response tampering and cross-request response substitution', async () => {
    const { keys } = await setup();
    const context = { chainId: CHAIN, path: '/admin/eoas', enclavePubKey: keys.transportPublicKey() };
    const first = await sealEnvelopeWithResponse({}, context);
    const second = await sealEnvelopeWithResponse({}, context);
    const recipient = await keys.decryptWithResponse(first.envelope, context.path);
    const response = await recipient.sealResponse({ addresses: [] });
    await expect(second.openResponse(response)).rejects.toThrow('INVALID_PAYLOAD');
    const bytes = Buffer.from(response.ct, 'base64'); bytes[0] = bytes[0]! ^ 1;
    await expect(first.openResponse({ ct: bytes.toString('base64') })).rejects.toThrow('INVALID_PAYLOAD');
    await expect(recipient.sealResponse({ addresses: [] })).rejects.toThrow('RESPONSE_ALREADY_USED');
  });

  it('attests the same sealed public key used to decrypt requests, including after restart', async () => {
    const { keys, options } = await setup();
    const provider = async () => Buffer.from('test-quote');
    const attestation = new AttestationService('ab'.repeat(32), { identity: keys, chainId: CHAIN, provider });
    const restarted = new KeyManager({ ...options, allowCreate: false });
    await restarted.init();
    const after = new AttestationService('ab'.repeat(32), { identity: restarted, chainId: CHAIN, provider });
    expect((await attestation.response()).enclavePubKey).toBe((await after.response()).enclavePubKey);
    const client = await sealEnvelopeWithResponse({ check: true }, {
      chainId: CHAIN, path: '/admin/eoas', enclavePubKey: (await attestation.response()).enclavePubKey as `0x${string}`,
    });
    expect(await restarted.decrypt(client.envelope, '/admin/eoas')).toEqual({ check: true });
  });

  it('validates admin wire fields strictly', () => {
    const good = { message: { admin: ADMIN.address, nonce: '1', expiry: NOW.toString() }, signature: `0x${'00'.repeat(65)}` };
    expect(SignedAdminEoasSchema.safeParse(good).success).toBe(true);
    for (const bad of [{ ...good, extra: true }, { ...good, message: { ...good.message, nonce: '-1' } },
      { ...good, message: { ...good.message, expiry: '18446744073709551616' } }, { ...good, signature: '0x01' }]) {
      expect(SignedAdminEoasSchema.safeParse(bad).success).toBe(false);
    }
  });
});
