import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type { Address, Hex, IntentMsg, JournalEvent } from '@cloakroom/shared';
import { FifoSerialQueue } from '../src/queue.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';

const freshAddress = (seed: number): Address =>
  `0x${seed.toString(16).padStart(40, '0')}` as Address;

const freshToken = (seed: number): Address =>
  `0x${(seed + 0x1000).toString(16).padStart(40, '0')}` as Address;

const dummyIntent = (
  owner: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): IntentMsg => ({
  owner,
  tokenIn,
  tokenOut,
  amountIn,
  comparator: 1,
  triggerPrice: 2000n * 10n ** 18n,
  maxSlippageBps: 50,
  nonce: 1n,
  expiry: 1800000000n,
});

describe('InMemoryLedger Unit Tests', () => {
  let ledger: InMemoryLedger;
  const alice = freshAddress(1);
  const bob = freshAddress(2);
  const usdc = freshToken(1);
  const dai = freshToken(2);

  beforeEach(() => {
    ledger = new InMemoryLedger();
  });

  it('1. New owner starts with zero balances', () => {
    expect(ledger.balances(alice)).toEqual([]);
    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(0n);
    expect(bal.reserved).toBe(0n);
    expect(bal.pending).toBe(0n);
    ledger.assertInvariants();
  });

  it('2. Credit increases available balance', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(1000n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('3. Reserve moves available into reserved', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(600n);
    expect(bal.reserved).toBe(400n);
    ledger.assertInvariants();
  });

  it('4. Insufficient balance rejects reservation', () => {
    ledger.credit(alice, NATIVE, 300n, 'cred-1');
    expect(() => ledger.reserve(alice, NATIVE, 301n, 'res-1')).toThrow(
      ERROR_CODES.INSUFFICIENT_BALANCE,
    );

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(300n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('5. Release restores available balance', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.release('res-1');

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(1000n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('6. Consume removes reserved balance without restoring available', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.consume('res-1');

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(600n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('7. Duplicate credit does not double-credit', () => {
    ledger.credit(alice, NATIVE, 500n, 'cred-dup');
    // Repeated credit with identical parameters is idempotent
    ledger.credit(alice, NATIVE, 500n, 'cred-dup');

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(500n);

    // Conflicting credit reference must throw
    expect(() => ledger.credit(alice, NATIVE, 600n, 'cred-dup')).toThrow();
    expect(() => ledger.credit(bob, NATIVE, 500n, 'cred-dup')).toThrow();
    ledger.assertInvariants();
  });

  it('8. Duplicate reservation cannot overwrite an existing reservation', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 300n, 'res-unique');

    expect(() => ledger.reserve(alice, NATIVE, 200n, 'res-unique')).toThrow(
      /already exists/,
    );
    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(700n);
    expect(bal.reserved).toBe(300n);
    ledger.assertInvariants();
  });

  it('9. Repeated release does not double-credit', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.release('res-1');
    ledger.release('res-1'); // Idempotent repeated release

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(1000n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('10. Repeated consume does not mutate balances again', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.consume('res-1');
    ledger.consume('res-1'); // Idempotent repeated consume

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(600n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('11. Releasing a consumed reservation fails', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.consume('res-1');

    expect(() => ledger.release('res-1')).toThrow(/consumed/);
    ledger.assertInvariants();
  });

  it('12. Consuming a released reservation fails', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-1');
    ledger.reserve(alice, NATIVE, 400n, 'res-1');
    ledger.release('res-1');

    expect(() => ledger.consume('res-1')).toThrow(/released/);
    ledger.assertInvariants();
  });

  it('13. Unknown reservation references fail', () => {
    expect(() => ledger.release('unknown-ref')).toThrow(/Unknown/);
    expect(() => ledger.consume('unknown-ref')).toThrow(/Unknown/);
    ledger.assertInvariants();
  });

  it('14. Two owners remain isolated', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-alice');
    ledger.credit(bob, NATIVE, 500n, 'cred-bob');

    ledger.reserve(alice, NATIVE, 700n, 'res-alice');
    expect(() => ledger.reserve(bob, NATIVE, 600n, 'res-bob')).toThrow(
      ERROR_CODES.INSUFFICIENT_BALANCE,
    );

    const aliceBal = ledger.getBalance(alice, NATIVE);
    const bobBal = ledger.getBalance(bob, NATIVE);
    expect(aliceBal.available).toBe(300n);
    expect(aliceBal.reserved).toBe(700n);
    expect(bobBal.available).toBe(500n);
    expect(bobBal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('15. Two tokens remain isolated', () => {
    ledger.credit(alice, usdc, 10_000n, 'cred-usdc');
    expect(() => ledger.reserve(alice, dai, 500n, 'res-dai')).toThrow(
      ERROR_CODES.INSUFFICIENT_BALANCE,
    );

    const usdcBal = ledger.getBalance(alice, usdc);
    const daiBal = ledger.getBalance(alice, dai);
    expect(usdcBal.available).toBe(10_000n);
    expect(daiBal.available).toBe(0n);
    ledger.assertInvariants();
  });

  it('16. balances(owner) returns correct records', () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-eth');
    ledger.credit(alice, usdc, 2000n, 'cred-usdc');
    ledger.reserve(alice, NATIVE, 300n, 'res-eth');

    const bals = ledger.balances(alice);
    expect(bals).toHaveLength(2);

    const ethBal = bals.find((b) => b.token === NATIVE);
    const usdcBal = bals.find((b) => b.token === usdc);

    expect(ethBal).toEqual({
      token: NATIVE,
      available: 700n,
      reserved: 300n,
      pending: 0n,
    });
    expect(usdcBal).toEqual({
      token: usdc,
      available: 2000n,
      reserved: 0n,
      pending: 0n,
    });
    ledger.assertInvariants();
  });

  it('17. totals() aggregates all owners correctly', () => {
    ledger.credit(alice, NATIVE, 1000n, 'c1');
    ledger.credit(bob, NATIVE, 2000n, 'c2');
    ledger.credit(alice, usdc, 5000n, 'c3');
    ledger.reserve(alice, NATIVE, 400n, 'r1');
    ledger.reserve(bob, NATIVE, 600n, 'r2');

    const totals = ledger.totals();
    const ethTotal = totals.get(NATIVE);
    const usdcTotal = totals.get(usdc);

    expect(ethTotal).toEqual({
      available: 2000n, // (1000 - 400) + (2000 - 600) = 600 + 1400 = 2000
      reserved: 1000n, // 400 + 600 = 1000
    });
    expect(usdcTotal).toEqual({
      available: 5000n,
      reserved: 0n,
    });
    ledger.assertInvariants();
  });

  it('18. Pending is returned as 0n by the core Ledger', () => {
    ledger.credit(alice, NATIVE, 1000n, 'c1');
    const records = ledger.balances(alice);
    for (const r of records) {
      expect(r.pending).toBe(0n);
    }
  });

  it('19. Nonces are isolated by owner', () => {
    expect(ledger.getLastNonce(alice)).toBe(0n);
    expect(ledger.getLastNonce(bob)).toBe(0n);

    ledger.setNonce(alice, 1n);
    expect(ledger.getLastNonce(alice)).toBe(1n);
    expect(ledger.getLastNonce(bob)).toBe(0n);

    ledger.setNonce(bob, 5n);
    expect(ledger.getLastNonce(alice)).toBe(1n);
    expect(ledger.getLastNonce(bob)).toBe(5n);
  });

  it('20. Nonces cannot move backwards', () => {
    ledger.setNonce(alice, 10n);
    expect(() => ledger.setNonce(alice, 10n)).toThrow(ERROR_CODES.NONCE_USED);
    expect(() => ledger.setNonce(alice, 9n)).toThrow(ERROR_CODES.NONCE_USED);
    expect(() => ledger.setNonce(alice, 0n)).toThrow(ERROR_CODES.NONCE_USED);

    ledger.setNonce(alice, 11n);
    expect(ledger.getLastNonce(alice)).toBe(11n);
  });

  it('21. Protocol fee accounting is separate from user balances', () => {
    ledger.bookProtocolRevenue(usdc, 50n);
    expect(ledger.getProtocolRevenue(usdc)).toBe(50n);

    // Totals of user claims must NOT include protocol revenue
    const totals = ledger.totals();
    expect(totals.get(usdc)).toBeUndefined();
    ledger.assertInvariants();
  });

  it('22. Operational gas accounting is separate from protocol revenue', () => {
    ledger.bookOperationalGas('op-gas-1', NATIVE, 21000n * 30n);
    expect(ledger.getOperationalGasSpent(NATIVE)).toBe(630000n);
    expect(ledger.getProtocolRevenue(NATIVE)).toBe(0n);

    // Duplicate operational gas booking with same params is idempotent
    ledger.bookOperationalGas('op-gas-1', NATIVE, 630000n);
    expect(ledger.getOperationalGasSpent(NATIVE)).toBe(630000n);

    // Conflicting booking throws
    expect(() => ledger.bookOperationalGas('op-gas-1', NATIVE, 999999n)).toThrow();
    ledger.assertInvariants();
  });

  it('23. Successful settlement credits net output and books protocol revenue', () => {
    ledger.credit(alice, dai, 1000n, 'deposit-dai');
    const intentId = 'intent-1';
    ledger.apply({
      t: 'INTENT_CREATED',
      id: intentId,
      owner: alice,
      intent: dummyIntent(alice, dai, usdc, 1000n),
    });

    const fee = 10n; // 1%
    const grossAmountOut = 1000n;
    ledger.apply({
      t: 'EXEC_SETTLED',
      opId: 'op-1',
      intentId,
      owner: alice,
      tokenOut: usdc,
      amountOut: grossAmountOut,
      fee,
    });

    // Input consumed
    const daiBal = ledger.getBalance(alice, dai);
    expect(daiBal.available).toBe(0n);
    expect(daiBal.reserved).toBe(0n);

    // Net output credited to user
    const usdcBal = ledger.getBalance(alice, usdc);
    expect(usdcBal.available).toBe(990n);

    // Fee booked to protocol revenue
    expect(ledger.getProtocolRevenue(usdc)).toBe(10n);
    ledger.assertInvariants();
  });

  it('24. Failed settlement releases the full input reservation without charging protocol fees', () => {
    ledger.credit(alice, dai, 1000n, 'deposit-dai');
    const intentId = 'intent-1';
    ledger.apply({
      t: 'INTENT_CREATED',
      id: intentId,
      owner: alice,
      intent: dummyIntent(alice, dai, usdc, 1000n),
    });

    ledger.apply({
      t: 'EXEC_FAILED',
      opId: 'op-1',
      intentId,
      owner: alice,
      reason: 'SLIPPAGE_EXCEEDED',
    });

    const daiBal = ledger.getBalance(alice, dai);
    expect(daiBal.available).toBe(1000n);
    expect(daiBal.reserved).toBe(0n);
    expect(ledger.getProtocolRevenue(usdc)).toBe(0n);
    ledger.assertInvariants();
  });

  it('25. Withdrawal confirmation consumes the reservation', () => {
    ledger.credit(alice, NATIVE, 2000n, 'dep-1');
    const withdrawalId = 'with-1';
    ledger.apply({
      t: 'WITHDRAWAL_LOCKED',
      id: withdrawalId,
      owner: alice,
      token: NATIVE,
      amount: 1500n,
      to: alice,
    });

    ledger.apply({
      t: 'WITHDRAWAL_CONFIRMED',
      id: withdrawalId,
      owner: alice,
    });

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(500n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('26. Withdrawal failure restores the reservation', () => {
    ledger.credit(alice, NATIVE, 2000n, 'dep-1');
    const withdrawalId = 'with-1';
    ledger.apply({
      t: 'WITHDRAWAL_LOCKED',
      id: withdrawalId,
      owner: alice,
      token: NATIVE,
      amount: 1500n,
      to: alice,
    });

    ledger.apply({
      t: 'WITHDRAWAL_FAILED',
      id: withdrawalId,
      owner: alice,
      reason: 'REVERTED',
    });

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(2000n);
    expect(bal.reserved).toBe(0n);
    ledger.assertInvariants();
  });

  it('27. Missing owner on DEPOSIT_CREDITED causes replay failure', () => {
    expect(() =>
      ledger.apply({
        t: 'DEPOSIT_CREDITED',
        id: 'dep-missing',
        amount: 1000n,
        block: 100n,
      }),
    ).toThrow(/Missing owner/);
  });

  it('28. Replaying all 15 event variants behaves correctly', () => {
    const eoa = freshAddress(99);
    const intentId = 'intent-15';
    const withdrawalId = 'with-15';

    const events: JournalEvent[] = [
      { t: 'NONCE_USED', owner: alice, nonce: 1n },
      {
        t: 'DEPOSIT_SESSION_OPENED',
        id: 'sess-1',
        owner: alice,
        eoa,
        expiry: 1800000000,
        baseline: 0n,
        baselineBlock: 10n,
      },
      {
        t: 'DEPOSIT_CREDITED',
        id: 'sess-1',
        amount: 5000n,
        block: 12n,
        owner: alice,
        txHash: '0x1234' as Hex,
      },
      { t: 'DEPOSIT_SESSION_CLOSED', id: 'sess-1', eoa },
      {
        t: 'INTENT_CREATED',
        id: intentId,
        owner: alice,
        intent: dummyIntent(alice, NATIVE, usdc, 1000n),
      },
      {
        t: 'EXEC_BROADCAST',
        opId: 'op-exec',
        eoa,
        nonce: 1,
        txHash: '0x2345' as Hex,
        raw: '0xabcd' as Hex,
        intentId,
      },
      {
        t: 'EXEC_SETTLED',
        opId: 'op-exec',
        intentId,
        owner: alice,
        tokenOut: usdc,
        amountOut: 2000n,
        fee: 20n,
      },
      {
        t: 'INTENT_CREATED',
        id: 'intent-cancel',
        owner: alice,
        intent: dummyIntent(alice, NATIVE, usdc, 500n),
      },
      { t: 'INTENT_CANCELLED', id: 'intent-cancel', owner: alice },
      {
        t: 'INTENT_CREATED',
        id: 'intent-expire',
        owner: alice,
        intent: dummyIntent(alice, NATIVE, usdc, 500n),
      },
      { t: 'INTENT_EXPIRED', id: 'intent-expire', owner: alice },
      {
        t: 'WITHDRAWAL_LOCKED',
        id: withdrawalId,
        owner: alice,
        token: usdc,
        amount: 1000n,
        to: alice,
      },
      {
        t: 'WITHDRAWAL_BROADCAST',
        id: withdrawalId,
        eoa,
        nonce: 2,
        txHash: '0x3456' as Hex,
        raw: '0xbcde' as Hex,
      },
      { t: 'WITHDRAWAL_CONFIRMED', id: withdrawalId, owner: alice },
      { t: 'FEE_BOOKED', opId: 'op-fee', token: NATIVE, feeAmount: 21000n * 35n },
    ];

    for (const e of events) {
      ledger.apply(e);
    }

    expect(ledger.getLastNonce(alice)).toBe(1n);
    const ethBal = ledger.getBalance(alice, NATIVE);
    const usdcBal = ledger.getBalance(alice, usdc);

    // ETH: 5000 credited - 1000 settled - 500 (cancelled) + 500 - 500 (expired) + 500 = 4000
    expect(ethBal.available).toBe(4000n);
    expect(ethBal.reserved).toBe(0n);

    // USDC: 1980 net credited from swap - 1000 consumed on withdrawal = 980
    expect(usdcBal.available).toBe(980n);
    expect(usdcBal.reserved).toBe(0n);

    expect(ledger.getProtocolRevenue(usdc)).toBe(20n);
    expect(ledger.getOperationalGasSpent(NATIVE)).toBe(735000n);
    ledger.assertInvariants();
  });

  it('29. Invalid event transitions fail loudly', () => {
    // Attempting to cancel an intent that was never created
    expect(() =>
      ledger.apply({ t: 'INTENT_CANCELLED', id: 'non-existent', owner: alice }),
    ).toThrow();

    // Attempting to confirm a withdrawal that was never locked
    expect(() =>
      ledger.apply({ t: 'WITHDRAWAL_CONFIRMED', id: 'non-existent', owner: alice }),
    ).toThrow();

    // Unknown event type
    expect(() =>
      ledger.apply({ t: 'SOME_UNKNOWN_EVENT' } as any),
    ).toThrow(/Unknown journal event type/);
  });

  it('30. Replaying the same journal into fresh ledger instances produces identical snapshots', async () => {
    const events: JournalEvent[] = [
      { t: 'NONCE_USED', owner: alice, nonce: 1n },
      {
        t: 'DEPOSIT_CREDITED',
        id: 'd1',
        amount: 10_000n,
        block: 100n,
        owner: alice,
      },
      {
        t: 'INTENT_CREATED',
        id: 'i1',
        owner: alice,
        intent: dummyIntent(alice, NATIVE, usdc, 3000n),
      },
      {
        t: 'EXEC_SETTLED',
        opId: 'op1',
        intentId: 'i1',
        owner: alice,
        tokenOut: usdc,
        amountOut: 6000n,
        fee: 60n,
      },
    ];

    const mockJournal = {
      async *replay() {
        for (let i = 0; i < events.length; i++) {
          yield {
            sequence: i + 1,
            timestamp: 1700000000 + i,
            prevHash: '0x' as Hex,
            event: events[i],
            entryHash: '0x' as Hex,
          };
        }
      },
    };

    const l1 = await replayLedger(mockJournal);
    const l2 = await replayLedger(mockJournal);

    expect(l1.balances(alice)).toEqual(l2.balances(alice));
    expect(l1.totals()).toEqual(l2.totals());
    expect(l1.getLastNonce(alice)).toBe(l2.getLastNonce(alice));
    expect(l1.getProtocolRevenue(usdc)).toBe(l2.getProtocolRevenue(usdc));
  });
});

describe('Journal and Queue Integration Tests', () => {
  let tempDir: string;
  let journal: EncryptedJournal;
  let queue: FifoSerialQueue;
  let ledger: InMemoryLedger;
  const testKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const alice = freshAddress(1);

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cloakroom-ledger-int-'));
    journal = new EncryptedJournal({
      filePath: join(tempDir, 'journal.bin'),
      key: testKey,
      fsync: false,
    });
    queue = new FifoSerialQueue();
    ledger = new InMemoryLedger();
  });

  afterEach(async () => {
    await journal.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('1. Journal append succeeds, then ledger mutates', async () => {
    const event: JournalEvent = {
      t: 'DEPOSIT_CREDITED',
      id: 's1',
      amount: 1000n,
      block: 10n,
      owner: alice,
    };

    await queue.run(async () => {
      await journal.append(event);
      ledger.apply(event);
    });

    expect(ledger.getBalance(alice, NATIVE).available).toBe(1000n);
  });

  it('2. Journal append fails, ledger remains unchanged', async () => {
    await journal.close(); // Force subsequent append to fail

    const event: JournalEvent = {
      t: 'DEPOSIT_CREDITED',
      id: 's1',
      amount: 1000n,
      block: 10n,
      owner: alice,
    };

    await expect(
      queue.run(async () => {
        await journal.append(event);
        ledger.apply(event);
      }),
    ).rejects.toThrow();

    expect(ledger.getBalance(alice, NATIVE).available).toBe(0n);
  });

  it('3. Two competing reservations run through the same queue', async () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-initial');

    const res1 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 600n, 'res-1');
      return 'ok1';
    });

    const res2 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 300n, 'res-2');
      return 'ok2';
    });

    const results = await Promise.all([res1, res2]);
    expect(results).toEqual(['ok1', 'ok2']);

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(100n);
    expect(bal.reserved).toBe(900n);
  });

  it('4. Exactly one succeeds when combined requested amounts exceed available balance', async () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-initial');

    const op1 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 700n, 'res-comp-1');
      return 'op1-success';
    });

    const op2 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 700n, 'res-comp-2');
      return 'op2-success';
    });

    const results = await Promise.allSettled([op1, op2]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect((results[1].reason as Error).message).toBe(ERROR_CODES.INSUFFICIENT_BALANCE);
    }

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(300n);
    expect(bal.reserved).toBe(700n);
  });

  it('5. A failed queued operation does not poison later operations', async () => {
    ledger.credit(alice, NATIVE, 1000n, 'cred-initial');

    const op1 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 1500n, 'res-fail'); // Fails: insufficient balance
    });

    const op2 = queue.run(async () => {
      ledger.reserve(alice, NATIVE, 400n, 'res-success'); // Must succeed
      return 'recovered';
    });

    await expect(op1).rejects.toThrow(ERROR_CODES.INSUFFICIENT_BALANCE);
    await expect(op2).resolves.toBe('recovered');

    const bal = ledger.getBalance(alice, NATIVE);
    expect(bal.available).toBe(600n);
    expect(bal.reserved).toBe(400n);
  });

  it('6. Replay after a simulated restart restores the exact ledger snapshot', async () => {
    const usdc = freshToken(1);

    const events: JournalEvent[] = [
      { t: 'NONCE_USED', owner: alice, nonce: 1n },
      {
        t: 'DEPOSIT_CREDITED',
        id: 's1',
        amount: 10_000n,
        block: 10n,
        owner: alice,
      },
      {
        t: 'INTENT_CREATED',
        id: 'intent-restart',
        owner: alice,
        intent: dummyIntent(alice, NATIVE, usdc, 2500n),
      },
      {
        t: 'EXEC_SETTLED',
        opId: 'op-restart',
        intentId: 'intent-restart',
        owner: alice,
        tokenOut: usdc,
        amountOut: 5000n,
        fee: 50n,
      },
      {
        t: 'WITHDRAWAL_LOCKED',
        id: 'with-restart',
        owner: alice,
        token: usdc,
        amount: 1000n,
        to: alice,
      },
    ];

    for (const e of events) {
      await journal.append(e);
      ledger.apply(e);
    }

    // Replay journal into a new InMemoryLedger
    const replayed = await replayLedger(journal);

    expect(replayed.balances(alice)).toEqual(ledger.balances(alice));
    expect(replayed.totals()).toEqual(ledger.totals());
    expect(replayed.getLastNonce(alice)).toBe(ledger.getLastNonce(alice));
    expect(replayed.getProtocolRevenue(usdc)).toBe(ledger.getProtocolRevenue(usdc));
    replayed.assertInvariants();
  });
});
