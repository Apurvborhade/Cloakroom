import {
  NATIVE,
  type IntentMsg,
  type JournalEntry,
  type JournalEvent,
  type PriceReport,
  type StoredIntent,
} from '@cloakroom/shared';
import { getAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { InMemoryIntentStore, replayIntents } from '../src/intents.js';
import { InMemoryLedger } from '../src/ledger.js';

const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

function sampleOwner(): Address {
  return privateKeyToAddress(generatePrivateKey());
}

function sampleIntent(overrides: Partial<IntentMsg> = {}): IntentMsg {
  const owner = sampleOwner();
  return {
    owner,
    tokenIn: NATIVE,
    tokenOut: USDC,
    amountIn: 1_000_000_000_000_000_000n, // 1 ETH
    comparator: 0,
    triggerPrice: 3000n * 10n ** 18n,
    maxSlippageBps: 50,
    nonce: 1n,
    expiry: 1_800_000_000n,
    ...overrides,
  };
}

describe('InMemoryIntentStore', () => {
  describe('add and get', () => {
    it('creates an intent with pending status and normalized addresses', () => {
      const store = new InMemoryIntentStore({ now: () => 1_700_000_000_000 });
      const owner = sampleOwner();
      const msg = sampleIntent({
        owner: owner.toLowerCase() as Address,
        tokenIn: NATIVE.toLowerCase() as Address,
        tokenOut: USDC.toLowerCase() as Address,
      });

      store.add('intent-1', owner, msg);

      const stored = store.get('intent-1');
      expect(stored).toBeDefined();
      expect(stored?.id).toBe('intent-1');
      expect(stored?.owner).toBe(getAddress(owner));
      expect(stored?.status).toBe('pending');
      expect(stored?.createdAt).toBe(1_700_000_000);
      expect(stored?.intent.tokenIn).toBe(getAddress(NATIVE));
      expect(stored?.intent.tokenOut).toBe(getAddress(USDC));
      expect(stored?.intent.amountIn).toBe(msg.amountIn);
      expect(stored?.intent.triggerPrice).toBe(msg.triggerPrice);
      expect(stored?.intent.comparator).toBe(0);
      expect(stored?.intent.nonce).toBe(msg.nonce);
      expect(stored?.intent.expiry).toBe(msg.expiry);
    });

    it('rejects duplicate intent IDs', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });

      store.add('intent-1', owner, msg);
      expect(() => store.add('intent-1', owner, msg)).toThrow(/already exists/);
    });

    it('rejects empty or non-string intent IDs', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });

      expect(() => store.add('', owner, msg)).toThrow(/non-empty string/);
    });

    it('rejects owner mismatch between argument and message', () => {
      const store = new InMemoryIntentStore();
      const owner1 = sampleOwner();
      const owner2 = sampleOwner();
      const msg = sampleIntent({ owner: owner1 });

      expect(() => store.add('intent-1', owner2, msg)).toThrow(/Owner mismatch/);
    });

    it('rejects unsupported comparator values', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();

      const invalidComparators = [2, -1, 3, 99];
      for (const comp of invalidComparators) {
        const msg = sampleIntent({ owner, comparator: comp as any });
        expect(() => store.add(`intent-${comp}`, owner, msg)).toThrow(/Unsupported comparator/);
      }
    });

    it('rejects non-positive amountIn or triggerPrice', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();

      expect(() =>
        store.add('intent-0', owner, sampleIntent({ owner, amountIn: 0n })),
      ).toThrow(/amountIn must be a positive bigint/);

      expect(() =>
        store.add('intent-0', owner, sampleIntent({ owner, triggerPrice: 0n })),
      ).toThrow(/triggerPrice must be a positive bigint/);
    });

    it('rejects non-positive expiry and negative nonce', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();

      expect(() =>
        store.add('intent-0', owner, sampleIntent({ owner, expiry: 0n })),
      ).toThrow(/expiry must be a positive bigint/);

      expect(() =>
        store.add('intent-0', owner, sampleIntent({ owner, nonce: -1n })),
      ).toThrow(/nonce must be a non-negative bigint/);
    });

    it('does not expose internal references to external mutation', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });

      store.add('intent-1', owner, msg);

      // Mutate original message object
      msg.amountIn = 999n;
      expect(store.get('intent-1')?.intent.amountIn).not.toBe(999n);

      // Mutate returned object
      const retrieved = store.get('intent-1')!;
      retrieved.status = 'cancelled';
      retrieved.intent.amountIn = 42n;

      const fresh = store.get('intent-1')!;
      expect(fresh.status).toBe('pending');
      expect(fresh.intent.amountIn).toBe(1_000_000_000_000_000_000n);
    });

    it('returns undefined for non-existent intent', () => {
      const store = new InMemoryIntentStore();
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('listByOwner and size', () => {
    it('lists intents belonging only to the specified owner with case-insensitivity', () => {
      const store = new InMemoryIntentStore();
      const ownerA = sampleOwner();
      const ownerB = sampleOwner();

      store.add('intent-a1', ownerA, sampleIntent({ owner: ownerA }));
      store.add('intent-a2', ownerA, sampleIntent({ owner: ownerA }));
      store.add('intent-b1', ownerB, sampleIntent({ owner: ownerB }));

      expect(store.size).toBe(3);

      const listA = store.listByOwner(ownerA.toLowerCase() as Address);
      expect(listA.length).toBe(2);
      expect(listA.map((i) => i.id).sort()).toEqual(['intent-a1', 'intent-a2']);

      const listB = store.listByOwner(ownerB);
      expect(listB.length).toBe(1);
      expect(listB[0]?.id).toBe('intent-b1');

      const listC = store.listByOwner(sampleOwner());
      expect(listC).toEqual([]);
    });

    it('protects listByOwner results against external mutation', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      const list = store.listByOwner(owner);
      list[0]!.status = 'done';

      expect(store.get('intent-1')?.status).toBe('pending');
    });

    it('all() returns cloned copies of all intents', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));
      store.add('intent-2', owner, sampleIntent({ owner }));

      const all = store.all();
      expect(all.length).toBe(2);
      all[0]!.status = 'failed';
      expect(store.get('intent-1')?.status).toBe('pending');
    });
  });

  describe('cancel', () => {
    it('allows owner to cancel pending intent', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.cancel('intent-1', owner);
      expect(store.get('intent-1')?.status).toBe('cancelled');
    });

    it('rejects cancellation from a non-owner', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      const attacker = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      expect(() => store.cancel('intent-1', attacker)).toThrow(/Unauthorized/);
      expect(store.get('intent-1')?.status).toBe('pending');
    });

    it('rejects cancellation of an executing intent', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));
      store.mark('intent-1', 'executing');

      expect(() => store.cancel('intent-1', owner)).toThrow(/currently executing/);
      expect(store.get('intent-1')?.status).toBe('executing');
    });

    it('rejects cancellation of terminal intents', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();

      const terminalStatuses: Array<StoredIntent['status']> = [
        'cancelled',
        'done',
        'failed',
        'expired',
      ];
      for (const status of terminalStatuses) {
        const id = `intent-${status}`;
        store.add(id, owner, sampleIntent({ owner }));
        store.mark(id, status);

        expect(() => store.cancel(id, owner)).toThrow(/terminal status/);
      }
    });

    it('throws when cancelling non-existent intent', () => {
      const store = new InMemoryIntentStore();
      expect(() => store.cancel('missing', sampleOwner())).toThrow(/not found/);
    });
  });

  describe('expire', () => {
    it('transitions pending intent to expired', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.expire('intent-1');
      expect(store.get('intent-1')?.status).toBe('expired');
    });

    it('rejects expiration of executing intent', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));
      store.mark('intent-1', 'executing');

      expect(() => store.expire('intent-1')).toThrow(/currently executing/);
    });

    it('rejects expiration of already terminal intents', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();

      for (const status of ['done', 'failed', 'cancelled', 'expired'] as const) {
        const id = `intent-${status}`;
        store.add(id, owner, sampleIntent({ owner }));
        store.mark(id, status);

        expect(() => store.expire(id)).toThrow(/terminal status/);
      }
    });

    it('throws when expiring non-existent intent', () => {
      const store = new InMemoryIntentStore();
      expect(() => store.expire('missing')).toThrow(/not found/);
    });
  });

  describe('mark', () => {
    it('supports execution lifecycle: pending -> executing -> done', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'executing');
      expect(store.get('intent-1')?.status).toBe('executing');

      const amountOut = 3_100_000_000n;
      store.mark('intent-1', 'done', amountOut);
      const doneIntent = store.get('intent-1');
      expect(doneIntent?.status).toBe('done');
      expect(doneIntent?.settledAmountOut).toBe(amountOut);
    });

    it('supports execution failure: pending -> executing -> failed', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'executing');
      store.mark('intent-1', 'failed', undefined, 'SLIPPAGE_EXCEEDED');

      const failedIntent = store.get('intent-1');
      expect(failedIntent?.status).toBe('failed');
      expect(failedIntent?.failureReason).toBe('SLIPPAGE_EXCEEDED');
    });

    it('supports stayPending flow: pending -> executing -> pending', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'executing');
      expect(store.get('intent-1')?.status).toBe('executing');

      store.mark('intent-1', 'pending');
      expect(store.get('intent-1')?.status).toBe('pending');
    });

    it('is idempotent when marked with identical status', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'executing');
      store.mark('intent-1', 'executing');
      expect(store.get('intent-1')?.status).toBe('executing');

      store.mark('intent-1', 'done', 100n);
      store.mark('intent-1', 'done', 200n);
      expect(store.get('intent-1')?.status).toBe('done');
      expect(store.get('intent-1')?.settledAmountOut).toBe(200n);
    });

    it('rejects illegal transitions from terminal states', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'done', 1000n);
      expect(() => store.mark('intent-1', 'pending')).toThrow(/Cannot transition intent/);
      expect(() => store.mark('intent-1', 'executing')).toThrow(/Cannot transition intent/);
      expect(() => store.mark('intent-1', 'failed')).toThrow(/Cannot transition intent/);
      expect(() => store.mark('intent-1', 'cancelled')).toThrow(/Cannot transition intent/);
    });

    it('rejects transitioning executing intent directly to cancelled or expired', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      store.mark('intent-1', 'executing');
      expect(() => store.mark('intent-1', 'cancelled')).toThrow(/Cannot transition executing/);
      expect(() => store.mark('intent-1', 'expired')).toThrow(/Cannot transition executing/);
    });

    it('throws when marking non-existent intent', () => {
      const store = new InMemoryIntentStore();
      expect(() => store.mark('missing', 'executing')).toThrow(/not found/);
    });
  });

  describe('due', () => {
    const triggerPrice = 3000n * 10n ** 18n;

    it('evaluates comparator 0 (price >= triggerPrice)', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-ge',
        owner,
        sampleIntent({
          owner,
          comparator: 0,
          triggerPrice,
          expiry: 2000n,
        }),
      );

      const pair = `${NATIVE}/${USDC}`;

      // Price above trigger -> due
      const dueAbove = store.due({
        pair,
        price: 3100n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueAbove.map((i) => i.id)).toEqual(['intent-ge']);

      // Price exactly trigger -> due
      const dueEqual = store.due({
        pair,
        price: 3000n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueEqual.map((i) => i.id)).toEqual(['intent-ge']);

      // Price below trigger -> not due
      const dueBelow = store.due({
        pair,
        price: 2999n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueBelow).toEqual([]);
    });

    it('evaluates comparator 1 (price <= triggerPrice)', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-le',
        owner,
        sampleIntent({
          owner,
          comparator: 1,
          triggerPrice,
          expiry: 2000n,
        }),
      );

      const pair = `${NATIVE}/${USDC}`;

      // Price below trigger -> due
      const dueBelow = store.due({
        pair,
        price: 2900n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueBelow.map((i) => i.id)).toEqual(['intent-le']);

      // Price exactly trigger -> due
      const dueEqual = store.due({
        pair,
        price: 3000n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueEqual.map((i) => i.id)).toEqual(['intent-le']);

      // Price above trigger -> not due
      const dueAbove = store.due({
        pair,
        price: 3001n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      });
      expect(dueAbove).toEqual([]);
    });

    it('matches token pairs with any casing (lowercase, uppercase, mixed, whitespace)', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner, expiry: 2000n }));

      const reports: PriceReport[] = [
        {
          pair: `${NATIVE.toLowerCase()}/${USDC.toLowerCase()}`,
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        },
        {
          pair: `${NATIVE.toUpperCase()}/${USDC.toUpperCase()}`,
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        },
        {
          pair: ` ${getAddress(NATIVE)} / ${getAddress(USDC)} `,
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        },
      ];

      for (const report of reports) {
        const due = store.due(report);
        expect(due.length).toBe(1);
        expect(due[0]?.id).toBe('intent-1');
      }
    });

    it('does not match inverted pair or unrelated pairs', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner, expiry: 2000n }));

      // Inverted pair
      expect(
        store.due({
          pair: `${USDC}/${NATIVE}`,
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        }),
      ).toEqual([]);

      // Unrelated pair
      expect(
        store.due({
          pair: `${NATIVE}/${WETH}`,
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        }),
      ).toEqual([]);

      // Invalid pair format
      expect(
        store.due({
          pair: 'INVALID_PAIR_WITHOUT_SLASH',
          price: 3500n * 10n ** 18n,
          ts: 1000,
          source: 'test',
        }),
      ).toEqual([]);
    });

    it('excludes expired intents based on report.ts', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-expiring',
        owner,
        sampleIntent({
          owner,
          expiry: 1500n,
        }),
      );

      const reportActive: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1499,
        source: 'test',
      };
      expect(store.due(reportActive).length).toBe(1);

      const reportExactExpiry: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1500,
        source: 'test',
      };
      expect(store.due(reportExactExpiry).length).toBe(0);

      const reportAfterExpiry: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1501,
        source: 'test',
      };
      expect(store.due(reportAfterExpiry).length).toBe(0);
    });

    it('excludes expired intents based on custom clock if provided', () => {
      let currentClockMs = 1000 * 1000;
      const store = new InMemoryIntentStore({ now: () => currentClockMs });
      const owner = sampleOwner();

      store.add(
        'intent-clock-exp',
        owner,
        sampleIntent({
          owner,
          expiry: 1500n,
        }),
      );

      // Report ts is 1200 (< 1500), clock is 1000 (< 1500) -> due
      expect(
        store.due({
          pair: `${NATIVE}/${USDC}`,
          price: 3500n * 10n ** 18n,
          ts: 1200,
          source: 'test',
        }).length,
      ).toBe(1);

      // Advance clock past expiry: 1600 > 1500
      currentClockMs = 1600 * 1000;
      expect(
        store.due({
          pair: `${NATIVE}/${USDC}`,
          price: 3500n * 10n ** 18n,
          ts: 1200,
          source: 'test',
        }).length,
      ).toBe(0);
    });

    it('only returns pending intents and never executing or terminal intents', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      const statuses: Array<StoredIntent['status']> = [
        'pending',
        'executing',
        'done',
        'failed',
        'cancelled',
        'expired',
      ];

      for (const s of statuses) {
        const id = `intent-${s}`;
        store.add(id, owner, sampleIntent({ owner, expiry: 2000n }));
        if (s !== 'pending') {
          store.mark(id, s, s === 'done' ? 100n : undefined, s === 'failed' ? 'ERR' : undefined);
        }
      }

      const due = store.due({
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'test',
      });

      expect(due.map((i) => i.id)).toEqual(['intent-pending']);
    });

    it('is a pure query that does not mutate store state or internal objects', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner, expiry: 2000n }));

      const due = store.due({
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'test',
      });

      expect(due.length).toBe(1);
      due[0]!.status = 'executing';
      due[0]!.intent.amountIn = 0n;

      const fresh = store.get('intent-1')!;
      expect(fresh.status).toBe('pending');
      expect(fresh.intent.amountIn).toBe(1_000_000_000_000_000_000n);
    });

    it('validates incoming PriceReport structure', () => {
      const store = new InMemoryIntentStore();
      expect(() => store.due(null as any)).toThrow(/Invalid PriceReport/);
      expect(() => store.due({} as any)).toThrow(/Invalid PriceReport/);
      expect(() => store.due({ pair: 123 } as any)).toThrow(/Invalid PriceReport/);
    });
  });

  describe('Journal Replay & Recovery (replayIntents)', () => {
    it('reconstructs full intent store deterministically from journal events', async () => {
      const owner1 = sampleOwner();
      const owner2 = sampleOwner();
      const msg1 = sampleIntent({ owner: owner1, nonce: 1n });
      const msg2 = sampleIntent({ owner: owner2, nonce: 1n });
      const msg3 = sampleIntent({ owner: owner1, nonce: 2n });
      const msg4 = sampleIntent({ owner: owner2, nonce: 2n });

      const events: Array<{ event: JournalEvent; timestamp: number }> = [
        {
          timestamp: 100,
          event: { t: 'INTENT_CREATED', id: 'i-1', owner: owner1, intent: msg1 },
        },
        {
          timestamp: 110,
          event: { t: 'INTENT_CREATED', id: 'i-2', owner: owner2, intent: msg2 },
        },
        {
          timestamp: 120,
          event: { t: 'INTENT_CREATED', id: 'i-3', owner: owner1, intent: msg3 },
        },
        {
          timestamp: 130,
          event: { t: 'INTENT_CREATED', id: 'i-4', owner: owner2, intent: msg4 },
        },
        {
          timestamp: 140,
          event: {
            t: 'EXEC_BROADCAST',
            opId: 'exec:i-1',
            eoa: sampleOwner(),
            nonce: 0,
            txHash: '0x123' as Hex,
            raw: '0xabc' as Hex,
            intentId: 'i-1',
          },
        },
        {
          timestamp: 150,
          event: {
            t: 'EXEC_SETTLED',
            opId: 'exec:i-1',
            intentId: 'i-1',
            owner: owner1,
            tokenOut: USDC,
            amountOut: 3000n,
            fee: 30n,
          },
        },
        {
          timestamp: 160,
          event: {
            t: 'EXEC_FAILED',
            opId: 'exec:i-2',
            intentId: 'i-2',
            owner: owner2,
            reason: 'REVERTED_ON_CHAIN',
          },
        },
        {
          timestamp: 170,
          event: {
            t: 'INTENT_CANCELLED',
            id: 'i-3',
            owner: owner1,
          },
        },
        {
          timestamp: 180,
          event: {
            t: 'INTENT_EXPIRED',
            id: 'i-4',
            owner: owner2,
          },
        },
        // Unrelated non-intent events in the stream
        {
          timestamp: 190,
          event: {
            t: 'NONCE_USED',
            owner: owner1,
            nonce: 1n,
          },
        },
        {
          timestamp: 200,
          event: {
            t: 'FEE_BOOKED',
            opId: 'exec:i-1',
            token: NATIVE,
            feeAmount: 500n,
          },
        },
      ];

      const store = await replayIntents(events);

      expect(store.size).toBe(4);

      // Check i-1 (settled)
      const i1 = store.get('i-1');
      expect(i1?.status).toBe('done');
      expect(i1?.settledAmountOut).toBe(2970n); // 3000n - 30n fee
      expect(i1?.createdAt).toBe(100);

      // Check i-2 (failed)
      const i2 = store.get('i-2');
      expect(i2?.status).toBe('failed');
      expect(i2?.failureReason).toBe('REVERTED_ON_CHAIN');
      expect(i2?.createdAt).toBe(110);

      // Check i-3 (cancelled)
      const i3 = store.get('i-3');
      expect(i3?.status).toBe('cancelled');
      expect(i3?.createdAt).toBe(120);

      // Check i-4 (expired)
      const i4 = store.get('i-4');
      expect(i4?.status).toBe('expired');
      expect(i4?.createdAt).toBe(130);
    });

    it('is completely deterministic when replayed multiple times', async () => {
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });

      const events: Array<{ event: JournalEvent; timestamp: number }> = [
        { timestamp: 50, event: { t: 'INTENT_CREATED', id: 'i-1', owner, intent: msg } },
        {
          timestamp: 60,
          event: {
            t: 'EXEC_SETTLED',
            opId: 'exec:i-1',
            intentId: 'i-1',
            owner,
            tokenOut: USDC,
            amountOut: 5000n,
            fee: 50n,
          },
        },
      ];

      const store1 = await replayIntents(events);
      const store2 = await replayIntents(events);

      expect(store1.all()).toEqual(store2.all());
    });

    it('works with a Journal-like object that provides replay()', async () => {
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });
      const entry: JournalEntry = {
        sequence: 1,
        timestamp: 42,
        prevHash: '0x00' as Hex,
        entryHash: '0x11' as Hex,
        event: { t: 'INTENT_CREATED', id: 'i-1', owner, intent: msg },
      };

      const mockJournal = {
        async *replay() {
          yield entry;
        },
      };

      const store = await replayIntents(mockJournal);
      expect(store.get('i-1')?.status).toBe('pending');
      expect(store.get('i-1')?.createdAt).toBe(42);
    });

    it('reconstructs broadcast intent as executing if still open', async () => {
      const owner = sampleOwner();
      const msg = sampleIntent({ owner });

      const events: Array<{ event: JournalEvent }> = [
        { event: { t: 'INTENT_CREATED', id: 'i-open', owner, intent: msg } },
        {
          event: {
            t: 'EXEC_BROADCAST',
            opId: 'exec:i-open',
            eoa: sampleOwner(),
            nonce: 0,
            txHash: '0xabc' as Hex,
            raw: '0x123' as Hex,
            intentId: 'i-open',
          },
        },
      ];

      const store = await replayIntents(events);
      expect(store.get('i-open')?.status).toBe('executing');
    });

    it('does NOT mutate ledger or double-reserve funds during replay', async () => {
      const ledger = new InMemoryLedger();
      const owner = sampleOwner();

      // Ledger starts with 10 ETH credited
      ledger.credit(owner, NATIVE, 10n * 10n ** 18n, 'deposit:1');

      const msg = sampleIntent({ owner, amountIn: 2n * 10n ** 18n });

      const events: Array<{ event: JournalEvent }> = [
        { event: { t: 'INTENT_CREATED', id: 'i-1', owner, intent: msg } },
      ];

      // Replaying intents must not touch ledger
      const intentStore = await replayIntents(events);
      expect(intentStore.get('i-1')?.status).toBe('pending');

      // Check that ledger available balance remains 10 ETH and reserved is 0 ETH
      const [bal] = ledger.balances(owner);
      expect(bal?.available).toBe(10n * 10n ** 18n);
      expect(bal?.reserved).toBe(0n);
    });
  });

  describe('Executor compatibility', () => {
    it('implements the mark contract required by ExecutorDeps.swaps.intents', () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner }));

      // Executor uses Pick<IntentStore, 'mark'>
      const intentsMarkDep: { mark(id: string, s: StoredIntent['status'], amountOut?: bigint): void } = store;

      intentsMarkDep.mark('intent-1', 'executing');
      expect(store.get('intent-1')?.status).toBe('executing');

      intentsMarkDep.mark('intent-1', 'pending');
      expect(store.get('intent-1')?.status).toBe('pending');

      intentsMarkDep.mark('intent-1', 'executing');
      intentsMarkDep.mark('intent-1', 'done', 2500n);
      expect(store.get('intent-1')?.status).toBe('done');
      expect(store.get('intent-1')?.settledAmountOut).toBe(2500n);
    });
  });
});
