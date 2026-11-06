// @vitest-environment node
/**
 * The frontend protocol layer against the REAL enclave routes (see test/support/live-enclave.ts):
 * real Fastify server over HTTP, real EIP-712 verification, real HPKE, real ledger and nonces.
 * The chain is a fake that can only answer reads, so nothing here claims on-chain execution works.
 */
import { NATIVE } from '@cloakroom/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CloakroomApi } from '@/lib/api/client';
import * as endpoints from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import { loadEnclaveIdentity } from '@/lib/attestation/enclave-identity';
import { SessionStore } from '@/lib/session/session-store';
import { nextNonce } from '@/lib/wallet/nonce';
import {
  buildCancelIntent,
  buildDepositRequest,
  buildIntent,
  buildMarginAddCollateral,
  buildMarginClose,
  buildMarginLending,
  buildMarginOpen,
  buildWithdrawal,
  mutationExpiry,
  signRequest,
} from '@/lib/wallet/typed-data';
import type { EnclaveBinding, TypedDataSigner } from '@/lib/wallet/typed-data';
import { FIXTURE_CHAIN_ID, FIXTURE_TOKEN, startLiveEnclave } from './support/live-enclave';
import type { LiveEnclave } from './support/live-enclave';

const signerFor = (account: ReturnType<typeof privateKeyToAccount>): TypedDataSigner =>
  (args) => account.signTypedData(args as Parameters<typeof account.signTypedData>[0]);

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === code);
}

function apiFor(live: LiveEnclave): CloakroomApi {
  const address = live.enclave.app.server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return new CloakroomApi({ baseUrl: `http://127.0.0.1:${address.port}` });
}

describe('frontend protocol against the real enclave routes (margin disabled)', () => {
  let live: LiveEnclave;
  let api: CloakroomApi;
  let binding: EnclaveBinding;
  const owner = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const sessions = new SessionStore();

  beforeAll(async () => {
    live = await startLiveEnclave();
    api = apiFor(live);
  });
  afterAll(async () => live?.stop());

  it('refuses the simulated key unless explicitly allowed, then loads it as simulated', async () => {
    await expectCode(loadEnclaveIdentity(api, { expectedChainId: FIXTURE_CHAIN_ID, allowSimulated: false }), 'ENCLAVE_UNAVAILABLE');
    const identity = await loadEnclaveIdentity(api, { expectedChainId: FIXTURE_CHAIN_ID, allowSimulated: true });
    expect(identity.mode).toBe('simulated');
    expect(identity.enclavePubKey).toBe(live.enclave.parts.keys.transportPublicKey().toLowerCase());
    expect(identity.salt).toBe(live.enclave.parts.auth.getEnclaveSalt());
    binding = { chainId: identity.chainId, enclavePubKey: identity.enclavePubKey };
  });

  it('rejects a simulated key for the wrong chain', async () => {
    await expectCode(loadEnclaveIdentity(api, { expectedChainId: 1, allowSimulated: true }), 'WRONG_CHAIN');
  });

  it('answers UNKNOWN_SESSION for reads before a grant, then reads balances with a session key', async () => {
    const query = await signRequest(signerFor(stranger), {
      primaryType: 'SessionQuery',
      domain: (await import('@/lib/wallet/typed-data')).domainFor(binding),
      message: { owner: owner.address, expiry: mutationExpiry() },
      wire: { owner: owner.address, expiry: mutationExpiry().toString() },
    });
    await expectCode(endpoints.getBalances(api, binding, query), 'UNKNOWN_SESSION');

    const session = await sessions.establish({ owner: owner.address, binding, ownerSigner: signerFor(owner), api });
    expect(session.owner).toBe(owner.address);
    expect(sessions.isActive(owner.address, binding)).toBe(true);
    const balances = await endpoints.getBalances(api, binding, await sessions.signQuery(owner.address, binding));
    expect(balances.balances.map((item) => item.token)).toEqual([NATIVE, FIXTURE_TOKEN.toLowerCase()]);
    expect(balances.balances.every((item) => item.available === '0')).toBe(true);
  });

  it('a session key cannot authorise a mutation', async () => {
    // Even a valid grant does not let anything but the owner sign a DepositRequest.
    const request = buildDepositRequest(binding, { owner: owner.address, asset: NATIVE, nonce: nextNonce(), expiry: mutationExpiry() });
    await expectCode(endpoints.openDepositSession(api, binding, await signRequest(signerFor(stranger), request)), 'BAD_SIGNATURE');
  });

  let depositAddress: Address;
  it('opens a deposit session and credits ETH once the chain shows it', async () => {
    const request = buildDepositRequest(binding, { owner: owner.address, asset: NATIVE, nonce: nextNonce(), expiry: mutationExpiry() });
    const signed = await signRequest(signerFor(owner), request);
    const session = await endpoints.openDepositSession(api, binding, signed);
    depositAddress = session.depositAddress as Address;
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // The same signed request cannot be replayed.
    await expectCode(endpoints.openDepositSession(api, binding, signed), 'NONCE_USED');

    live.chain.setBalance(depositAddress, parseEther('0.5') + BigInt(session.gasReserveWei ?? '0'));
    await vi.waitFor(async () => {
      await live.enclave.parts.watcher.tick();
      const balances = await endpoints.getBalances(api, binding, await sessions.signQuery(owner.address, binding));
      expect(balances.balances[0]!.available).toBe(parseEther('0.5').toString());
    }, { timeout: 5_000, interval: 100 });
  });

  it('opens a USDC deposit with a gas reserve, and reports its progress to its owner only', async () => {
    const request = buildDepositRequest(binding, { owner: owner.address, asset: FIXTURE_TOKEN, nonce: nextNonce(), expiry: mutationExpiry() });
    const session = await endpoints.openDepositSession(api, binding, await signRequest(signerFor(owner), request));
    expect(session.singleUse).toBe(true);
    expect(session.asset?.toLowerCase()).toBe(FIXTURE_TOKEN.toLowerCase());
    expect(BigInt(session.gasReserveWei ?? '0')).toBeGreaterThan(0n);

    const { deposits } = await endpoints.getDepositStatuses(api, binding, await sessions.signQuery(owner.address, binding));
    const status = deposits.find((item) => item.sessionId === session.sessionId);
    expect(status).toMatchObject({ status: 'awaiting_funds', nativeReceived: '0', tokenReceived: '0', singleUse: true });
  });

  let intentId: Hex;
  it('creates an intent, reserves funds, reports status, and cancels exactly once', async () => {
    const signer = signerFor(owner);
    const comparatorOne = buildIntent(binding, {
      owner: owner.address, tokenIn: NATIVE, tokenOut: FIXTURE_TOKEN, amountIn: parseEther('0.1'), comparator: 1,
      triggerPrice: 2_000n * 10n ** 18n, maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    await expectCode(endpoints.createIntent(api, binding, await signRequest(signer, comparatorOne)), 'INVALID_PAYLOAD');

    const wrongToken = buildIntent(binding, {
      owner: owner.address, tokenIn: NATIVE, tokenOut: stranger.address, amountIn: parseEther('0.1'), comparator: 0,
      triggerPrice: 2_000n * 10n ** 18n, maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    await expectCode(endpoints.createIntent(api, binding, await signRequest(signer, wrongToken)), 'UNSUPPORTED_ASSET');

    const request = buildIntent(binding, {
      owner: owner.address, tokenIn: NATIVE, tokenOut: FIXTURE_TOKEN, amountIn: parseEther('0.1'), comparator: 0,
      triggerPrice: 2_000n * 10n ** 18n, maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    const created = await endpoints.createIntent(api, binding, await signRequest(signer, request));
    expect(created.status).toBe('pending');
    intentId = created.intentId;

    const query = () => sessions.signQuery(owner.address, binding);
    const statuses = await endpoints.getIntentStatuses(api, binding, await query());
    expect(statuses.intents).toEqual([{ id: intentId, status: 'pending' }]);
    const reserved = await endpoints.getBalances(api, binding, await query());
    expect(reserved.balances[0]).toMatchObject({ available: parseEther('0.4').toString(), reserved: parseEther('0.1').toString() });

    const cancel = () => buildCancelIntent(binding, { owner: owner.address, intentId, nonce: nextNonce(), expiry: mutationExpiry() });
    expect(await endpoints.cancelIntent(api, binding, await signRequest(signer, cancel()))).toEqual({ status: 'cancelled' });
    await expectCode(endpoints.cancelIntent(api, binding, await signRequest(signer, cancel())), 'INTENT_NOT_FOUND');
    const after = await endpoints.getIntentStatuses(api, binding, await query());
    expect(after.intents[0]!.status).toBe('cancelled');
  });

  it('rejects an intent above the available balance', async () => {
    const request = buildIntent(binding, {
      owner: owner.address, tokenIn: NATIVE, tokenOut: FIXTURE_TOKEN, amountIn: parseEther('0.9'), comparator: 0,
      triggerPrice: 1n, maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    await expectCode(endpoints.createIntent(api, binding, await signRequest(signerFor(owner), request)), 'INSUFFICIENT_BALANCE');
  });

  it('locks a withdrawal, then reports its real outcome (failed: the fixture chain cannot execute)', async () => {
    for (const eoa of live.enclave.parts.keys.list().filter((item) => item.role === 'inventory')) {
      live.chain.setBalance(eoa.address, parseEther('5'));
    }
    await live.enclave.parts.inventory.refresh();
    const destination = privateKeyToAccount(generatePrivateKey()).address;
    const request = buildWithdrawal(binding, { owner: owner.address, token: NATIVE, amount: parseEther('0.05'), to: destination, nonce: nextNonce(), expiry: mutationExpiry() });
    const created = await endpoints.createWithdrawal(api, binding, await signRequest(signerFor(owner), request));
    expect(created.status).toBe('locked');
    await vi.waitFor(async () => {
      const statuses = await endpoints.getWithdrawalStatuses(api, binding, await sessions.signQuery(owner.address, binding));
      const item = statuses.withdrawals.find((entry) => entry.id === created.withdrawalId);
      expect(item?.status).toBe('failed');
    }, { timeout: 5_000, interval: 100 });
  });

  it('reports margin as a missing route when MARGIN_ENABLED is off', async () => {
    await expectCode(endpoints.getMarginLending(api, binding, await sessions.signQuery(owner.address, binding)), 'ROUTE_NOT_FOUND');
  });

  it('treats a reply sealed for another request as BAD_RESPONSE', async () => {
    const query = await sessions.signQuery(owner.address, binding);
    // Proxy: forward the request, but answer with a reply that belongs to a different request.
    const realBase = api.baseUrl!;
    const other = await fetch(`${realBase}/balance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify((await (await import('@/lib/crypto/transport')).sealRequest(query, '/balance', binding)).envelope),
    }).then((response) => response.json());
    const tampering = new CloakroomApi({ baseUrl: realBase, fetchFn: async () => new Response(JSON.stringify(other), { status: 200 }) });
    await expectCode(endpoints.getBalances(tampering, binding, query), 'BAD_RESPONSE');
  });

  it('ends the read session locally when the owner changes', () => {
    expect(sessions.isActive(stranger.address, binding)).toBe(false);
    sessions.end('account-changed');
    expect(sessions.getSnapshot()).toBeNull();
  });
});

describe('frontend margin flows against the real margin routes (mock accounting)', () => {
  let live: LiveEnclave;
  let api: CloakroomApi;
  let binding: EnclaveBinding;
  const owner = privateKeyToAccount(generatePrivateKey());
  const sessions = new SessionStore();
  const signer = signerFor(owner);

  beforeAll(async () => {
    live = await startLiveEnclave({ margin: true });
    api = apiFor(live);
    const identity = await loadEnclaveIdentity(api, { expectedChainId: FIXTURE_CHAIN_ID, allowSimulated: true });
    binding = { chainId: identity.chainId, enclavePubKey: identity.enclavePubKey };
    await sessions.establish({ owner: owner.address, binding, ownerSigner: signer, api });
  });
  afterAll(async () => live?.stop());

  const query = () => sessions.signQuery(owner.address, binding);

  it('supplies and redeems lending liquidity', async () => {
    const supply = buildMarginLending(binding, 'MarginSupply', { owner: owner.address, token: FIXTURE_TOKEN, amount: 1_000_000_000n, nonce: nextNonce(), expiry: mutationExpiry() });
    expect(await endpoints.marginSupply(api, binding, await signRequest(signer, supply))).toEqual({ ok: true });
    const lending = await endpoints.getMarginLending(api, binding, await query());
    const usdc = lending.lending.find((item) => item.token === FIXTURE_TOKEN.toLowerCase());
    expect(usdc).toMatchObject({ supplied: '1000000000', available: '1000000000' });

    const redeem = buildMarginLending(binding, 'MarginRedeem', { owner: owner.address, token: FIXTURE_TOKEN, amount: 100_000_000n, nonce: nextNonce(), expiry: mutationExpiry() });
    expect(await endpoints.marginRedeem(api, binding, await signRequest(signer, redeem))).toEqual({ ok: true });
    const tooMuch = buildMarginLending(binding, 'MarginRedeem', { owner: owner.address, token: FIXTURE_TOKEN, amount: 10_000_000_000n, nonce: nextNonce(), expiry: mutationExpiry() });
    await expectCode(endpoints.marginRedeem(api, binding, await signRequest(signer, tooMuch)), 'INSUFFICIENT_BALANCE');
  });

  it('opens a long (side signed as uint8, sent as a word), and the position leaves "opening" only when the backend says so', async () => {
    const open = buildMarginOpen(binding, {
      owner: owner.address, side: 0, collateral: 100_000_000n, leverageBps: 20_000, limitPrice: 2_100n * 10n ** 18n,
      maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    expect(open.wire.side).toBe('long');
    const opened = await endpoints.marginOpen(api, binding, await signRequest(signer, open));
    expect(opened.status).toBe('opening');
    const first = await endpoints.getMarginPositions(api, binding, await query());
    expect(first.positions[0]).toMatchObject({ id: opened.positionId, side: 'long', collateral: '100000000', sizeUsd: '200000000' });

    // The fixture has no quotes, so execution fails and the backend records it.
    await vi.waitFor(async () => {
      const positions = await endpoints.getMarginPositions(api, binding, await query());
      expect(positions.positions[0]!.status).toBe('failed');
    }, { timeout: 5_000, interval: 100 });

    const close = buildMarginClose(binding, { owner: owner.address, positionId: opened.positionId, limitPrice: 1_900n * 10n ** 18n, maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry() });
    await expectCode(endpoints.marginClose(api, binding, await signRequest(signer, close)), 'POSITION_BUSY');
    const add = buildMarginAddCollateral(binding, { owner: owner.address, positionId: `0x${'11'.repeat(32)}`, amount: 1n, nonce: nextNonce(), expiry: mutationExpiry() });
    await expectCode(endpoints.marginAddCollateral(api, binding, await signRequest(signer, add)), 'POSITION_NOT_FOUND');
  });

  it('refuses leverage beyond the mock accounting limit', async () => {
    const open = buildMarginOpen(binding, {
      owner: owner.address, side: 1, collateral: 100_000_000n, leverageBps: 50_000, limitPrice: 1_900n * 10n ** 18n,
      maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
    });
    await expectCode(endpoints.marginOpen(api, binding, await signRequest(signer, open)), 'INSUFFICIENT_COLLATERAL');
  });
});

describe('margin with no fresh risk price', () => {
  it('answers STALE_PRICE to an open', async () => {
    const live = await startLiveEnclave({ margin: true, riskPrice: null });
    try {
      const api = apiFor(live);
      const identity = await loadEnclaveIdentity(api, { expectedChainId: FIXTURE_CHAIN_ID, allowSimulated: true });
      const binding = { chainId: identity.chainId, enclavePubKey: identity.enclavePubKey };
      const owner = privateKeyToAccount(generatePrivateKey());
      const open = buildMarginOpen(binding, {
        owner: owner.address, side: 0, collateral: 1_000_000n, leverageBps: 10_000, limitPrice: 1n,
        maxSlippageBps: 50, nonce: nextNonce(), expiry: mutationExpiry(),
      });
      await expectCode(endpoints.marginOpen(api, binding, await signRequest(signerFor(owner), open)), 'STALE_PRICE');
    } finally {
      await live.stop();
    }
  });
});
