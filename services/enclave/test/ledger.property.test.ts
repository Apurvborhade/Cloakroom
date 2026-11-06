import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NATIVE, ERROR_CODES } from '@cloakroom/shared';
import type { Address } from '@cloakroom/shared';
import { InMemoryLedger } from '../src/ledger.js';

const freshAddress = (seed: number): Address =>
  `0x${seed.toString(16).padStart(40, '0')}` as Address;

const freshToken = (seed: number): Address =>
  `0x${(seed + 0x2000).toString(16).padStart(40, '0')}` as Address;

const OWNERS: Address[] = [freshAddress(1), freshAddress(2), freshAddress(3)];
const TOKENS: Address[] = [NATIVE, freshToken(1), freshToken(2)];

type Operation =
  | { type: 'credit'; ownerIdx: number; tokenIdx: number; amount: bigint; ref: string }
  | { type: 'reserve'; ownerIdx: number; tokenIdx: number; amount: bigint; ref: string }
  | { type: 'release'; refIdx: number }
  | { type: 'consume'; refIdx: number };

describe('InMemoryLedger Property-Based Tests', () => {
  it('conserves all accounting invariants through arbitrary operation sequences', () => {
    const bigintArb = fc.oneof(
      fc.bigInt({ min: 1n, max: 10_000n }),
      fc.bigInt({ min: 10n ** 15n, max: 10n ** 24n }),
      fc.constant(1n),
      fc.constant(10n ** 18n),
      fc.constant(10n ** 27n),
    );

    const opArb: fc.Arbitrary<Operation> = fc.oneof(
      fc.record({
        type: fc.constant<'credit'>('credit'),
        ownerIdx: fc.integer({ min: 0, max: OWNERS.length - 1 }),
        tokenIdx: fc.integer({ min: 0, max: TOKENS.length - 1 }),
        amount: bigintArb,
        ref: fc.string({ minLength: 1, maxLength: 10 }),
      }),
      fc.record({
        type: fc.constant<'reserve'>('reserve'),
        ownerIdx: fc.integer({ min: 0, max: OWNERS.length - 1 }),
        tokenIdx: fc.integer({ min: 0, max: TOKENS.length - 1 }),
        amount: bigintArb,
        ref: fc.string({ minLength: 1, maxLength: 10 }),
      }),
      fc.record({
        type: fc.constant<'release'>('release'),
        refIdx: fc.integer({ min: 0, max: 50 }),
      }),
      fc.record({
        type: fc.constant<'consume'>('consume'),
        refIdx: fc.integer({ min: 0, max: 50 }),
      }),
    );

    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const ledger = new InMemoryLedger();
        const reservationRefs: string[] = [];
        let seq = 0;

        for (const op of ops) {
          seq++;
          const snapshotTotalsBefore = new Map(ledger.totals());

          if (op.type === 'credit') {
            const owner = OWNERS[op.ownerIdx];
            const token = TOKENS[op.tokenIdx];
            const ref = `cred-${op.ref}-${seq}`;
            ledger.credit(owner, token, op.amount, ref);
          } else if (op.type === 'reserve') {
            const owner = OWNERS[op.ownerIdx];
            const token = TOKENS[op.tokenIdx];
            const ref = `res-${op.ref}-${seq}`;
            const avail = ledger.getBalance(owner, token).available;
            if (avail >= op.amount) {
              ledger.reserve(owner, token, op.amount, ref);
              reservationRefs.push(ref);
            } else {
              expect(() => ledger.reserve(owner, token, op.amount, ref)).toThrow(
                ERROR_CODES.INSUFFICIENT_BALANCE,
              );
            }
          } else if (op.type === 'release') {
            if (reservationRefs.length > 0) {
              const ref = reservationRefs[op.refIdx % reservationRefs.length];
              const res = ledger.getReservation(ref);
              if (res?.status === 'consumed') {
                expect(() => ledger.release(ref)).toThrow();
              } else {
                ledger.release(ref);
              }
            } else {
              expect(() => ledger.release(`nonexistent-${op.refIdx}`)).toThrow();
            }
          } else if (op.type === 'consume') {
            if (reservationRefs.length > 0) {
              const ref = reservationRefs[op.refIdx % reservationRefs.length];
              const res = ledger.getReservation(ref);
              if (res?.status === 'released') {
                expect(() => ledger.consume(ref)).toThrow();
              } else {
                ledger.consume(ref);
              }
            } else {
              expect(() => ledger.consume(`nonexistent-${op.refIdx}`)).toThrow();
            }
          }

          // Assert invariants after every single operation
          ledger.assertInvariants();

          // Assert non-negativity for every owner
          for (const owner of OWNERS) {
            for (const token of TOKENS) {
              const bal = ledger.getBalance(owner, token);
              expect(bal.available >= 0n).toBe(true);
              expect(bal.reserved >= 0n).toBe(true);
              expect(bal.pending).toBe(0n);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('guarantees duplicate credit references never create phantom funds', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (amount, ref) => {
          const ledger = new InMemoryLedger();
          const alice = OWNERS[0];
          const token = TOKENS[0];

          ledger.credit(alice, token, amount, ref);
          const balAfterFirst = ledger.getBalance(alice, token).available;

          // Repeat with identical arguments
          ledger.credit(alice, token, amount, ref);
          const balAfterSecond = ledger.getBalance(alice, token).available;

          expect(balAfterSecond).toBe(balAfterFirst);
          expect(balAfterSecond).toBe(amount);

          // Conflicting amount must throw and leave balance unchanged
          expect(() => ledger.credit(alice, token, amount + 1n, ref)).toThrow();
          expect(ledger.getBalance(alice, token).available).toBe(balAfterFirst);
          ledger.assertInvariants();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('handles extreme 256-bit BigInt amounts without precision loss or overflow', () => {
    const ledger = new InMemoryLedger();
    const alice = OWNERS[0];
    const maxUint256 = 2n ** 256n - 1n;
    const halfMax = maxUint256 / 2n;

    ledger.credit(alice, NATIVE, maxUint256, 'max-cred');
    expect(ledger.getBalance(alice, NATIVE).available).toBe(maxUint256);

    ledger.reserve(alice, NATIVE, halfMax, 'half-res');
    expect(ledger.getBalance(alice, NATIVE).available).toBe(maxUint256 - halfMax);
    expect(ledger.getBalance(alice, NATIVE).reserved).toBe(halfMax);

    ledger.release('half-res');
    expect(ledger.getBalance(alice, NATIVE).available).toBe(maxUint256);
    expect(ledger.getBalance(alice, NATIVE).reserved).toBe(0n);
    ledger.assertInvariants();
  });
});
