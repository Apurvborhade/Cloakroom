import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createDomain, deriveEnclaveSalt, EIP712_TYPES, escapeClaimId, sealEnvelopeWithResponse } from '@cloakroom/shared';
import type { EscapeActivateMsg } from '@cloakroom/shared';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, PublicClient } from 'viem';
import { AuthService } from '../src/auth.js';
import { escapeRoutes } from '../src/escape-routes.js';
import { EscapeHatchService } from '../src/escape.js';
import { KeyManager } from '../src/keys.js';
import { InMemoryLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';

const OWNER = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const SESSION = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const HATCH = '0x3333333333333333333333333333333333333333';
const CODE: Hex = `0x${'44'.repeat(32)}`;
const NOW = 1_800_000_000;
const CHAIN = 11155111;

async function setup() {
  const { journal, events } = memoryJournal();
  const ledger = new InMemoryLedger(), queue = new FifoSerialQueue();
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('aa'.repeat(32), true), true);
  const keys = new KeyManager({ journal, vault, simMode: true, allowCreate: true, policy: {
    chainId: CHAIN, escapeHatch: HATCH, maxGas: 100_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 5n, maxNativeValue: 10n,
  } });
  await keys.init();
  const auth = new AuthService({ journal, ledger, queue, chainId: CHAIN, enclavePubKey: keys.transportPublicKey(),
    clock: () => NOW, config: { sessionGrantTtlSec: 300, maxExpiryFutureSec: 300, maxClockSkewSec: 0 } });
  const service = new EscapeHatchService({ chain: {} as PublicClient, chainId: CHAIN, hatch: HATCH,
    keys, journal, ledger, queue, confirmations: 0n, receiptTimeoutMs: 1, gasMarginPercent: 120n });
  const activation = vi.spyOn(service, 'activate').mockImplementation(async (message) => ({
    id: `escape:${message.owner}:${message.nonce}`, owner: message.owner, hatch: HATCH,
    claimId: message.claimId, amount: message.amount, status: 'reserved',
  }));
  const app = Fastify({ logger: false });
  escapeRoutes(app, { keys, auth, escape: service });
  const domain = createDomain(CHAIN, deriveEnclaveSalt(keys.transportPublicKey()));
  const message: EscapeActivateMsg = { owner: OWNER.address, hatch: HATCH,
    claimId: escapeClaimId(CHAIN, HATCH, OWNER.address, CODE), amount: 123n, nonce: 1n, expiry: BigInt(NOW + 60) };
  const payload = async (signer = OWNER, code = CODE, signed = message) => ({
    message: { ...signed, amount: signed.amount.toString(), nonce: signed.nonce.toString(), expiry: signed.expiry.toString() }, code,
    signature: await signer.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'EscapeActivate', message: signed }),
  });
  async function post(path: string, body: unknown) {
    const client = await sealEnvelopeWithResponse(body, { chainId: CHAIN, path, enclavePubKey: keys.transportPublicKey() });
    const response = await app.inject({ method: 'POST', url: path, payload: client.envelope });
    return { response, body: response.statusCode === 200 ? await client.openResponse(response.json()) : response.json() };
  }
  return { app, auth, ledger, domain, message, payload, post, activation, events };
}

describe('escape authorization', () => {
  it('rejects a substituted code before consuming the owner nonce, then accepts the signed binding', async () => {
    const s = await setup();
    const tampered = await s.post('/escape/activate', await s.payload(OWNER, `0x${'55'.repeat(32)}`));
    expect(tampered.response.statusCode).toBe(400);
    expect(tampered.body).toEqual({ error: 'INVALID_PAYLOAD' });
    expect(s.events).toHaveLength(0);
    expect(s.activation).not.toHaveBeenCalled();
    const valid = await s.post('/escape/activate', await s.payload());
    expect(valid.response.statusCode).toBe(200);
    expect(s.activation).toHaveBeenCalledOnce();
    expect(s.events.filter((event) => event.t === 'NONCE_USED')).toHaveLength(1);
    await s.app.close();
  });

  it('refuses an otherwise valid signature bound to another owner or hatch', async () => {
    const s = await setup();
    for (const message of [{ ...s.message, owner: SESSION.address }, { ...s.message, hatch: SESSION.address }]) {
      const response = await s.post('/escape/activate', await s.payload(SESSION, CODE, message));
      expect(response.body).toEqual({ error: 'INVALID_PAYLOAD' });
    }
    expect(s.events).toHaveLength(0);
    expect(s.activation).not.toHaveBeenCalled();
    await s.app.close();
  });

  it('lets session keys read status but never activate an escape claim', async () => {
    const s = await setup();
    const grant = { owner: OWNER.address, sessionKey: SESSION.address, expiry: BigInt(NOW + 60) };
    await s.auth.createSessionGrant(grant, await OWNER.signTypedData({ domain: s.domain,
      types: EIP712_TYPES, primaryType: 'SessionGrant', message: grant }));
    const denied = await s.post('/escape/activate', await s.payload(SESSION));
    expect(denied.response.statusCode).toBe(401);
    expect(s.activation).not.toHaveBeenCalled();
    const query = { owner: OWNER.address, expiry: BigInt(NOW + 60) };
    const read = await s.post('/escape/status', { message: { ...query, expiry: query.expiry.toString() },
      signature: await SESSION.signTypedData({ domain: s.domain, types: EIP712_TYPES, primaryType: 'SessionQuery', message: query }) });
    expect(read.response.statusCode).toBe(200);
    expect(read.body).toMatchObject({ hatch: HATCH, claim: null });
    expect(s.events).toHaveLength(0);
    await s.app.close();
  });
});
