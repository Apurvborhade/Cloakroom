import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NATIVE,
  type IntentMsg,
  type JournalEvent,
  type PriceReport,
  type StoredIntent,
} from '@cloakroom/shared';
import { getAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import type { Executor, SwapOutcome } from '../src/executor.js';
import { InMemoryIntentStore, replayIntents } from '../src/intents.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { IntentExecutionPipeline } from '../src/pipeline.js';
import { PricePoller } from '../src/price-poller.js';

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
    expiry: 2_000_000_000n,
    ...overrides,
  };
}

describe('IntentExecutionPipeline', () => {
  describe('Triggered and Non-Triggered Execution', () => {
    it('executes due intent when price meets condition', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'done', 3100n * 10n ** 6n);
        return {
          status: 'settled',
          txHash: '0x123' as Hex,
          amountOut: 3100n * 10n ** 6n,
          fee: 31n * 10n ** 6n,
        };
      });

      const executorMock: Pick<Executor, 'runIntent'> = {
        runIntent: runIntentMock,
      };

      const onExecutedMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: executorMock,
        onExecuted: onExecutedMock,
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3050n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);

      expect(runIntentMock).toHaveBeenCalledTimes(1);
      expect(runIntentMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'intent-1', status: 'pending' }),
      );
      expect(outcomes.length).toBe(1);
      expect(outcomes[0]?.status).toBe('settled');
      expect(onExecutedMock).toHaveBeenCalledTimes(1);
      expect(store.get('intent-1')?.status).toBe('done');

      // Subsequent price report does not re-execute the finished intent
      const secondOutcomes = await pipeline.handleReport(report);
      expect(runIntentMock).toHaveBeenCalledTimes(1);
      expect(secondOutcomes).toEqual([]);
    });

    it('does not execute when price does not meet trigger condition', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-1', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const reportBelow: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 2950n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(reportBelow);
      expect(runIntentMock).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
      expect(store.get('intent-1')?.status).toBe('pending');
    });

    it('does not execute intents with different token pair', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-weth',
        owner,
        sampleIntent({ owner, tokenIn: NATIVE, tokenOut: WETH, triggerPrice: 3000n * 10n ** 18n }),
      );

      const runIntentMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const reportUsdc: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(reportUsdc);
      expect(runIntentMock).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
      expect(store.get('intent-weth')?.status).toBe('pending');
    });
  });

  describe('Concurrent Price Reports & Mutual Exclusion', () => {
    it('prevents concurrent execution of the same intent during overlapping price reports', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-concurrency', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      let resolveExecution: (outcome: SwapOutcome) => void;
      const executionPromise = new Promise<SwapOutcome>((resolve) => {
        resolveExecution = resolve;
      });

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'executing');
        return executionPromise;
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3100n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      // Launch first price update
      const run1 = pipeline.handleReport(report);

      expect(pipeline.isInFlight('intent-concurrency')).toBe(true);
      expect(pipeline.inFlightCount).toBe(1);

      // Launch overlapping second price update before first completes
      const run2 = pipeline.handleReport(report);

      // Run 2 completes immediately because intent is already in flight / executing
      const outcomes2 = await run2;
      expect(outcomes2).toEqual([]);
      expect(runIntentMock).toHaveBeenCalledTimes(1);

      // Now resolve the first execution
      resolveExecution!({
        status: 'settled',
        txHash: '0x999' as Hex,
        amountOut: 3100n,
        fee: 31n,
      });
      store.mark('intent-concurrency', 'done', 3069n);

      const outcomes1 = await run1;
      expect(outcomes1.length).toBe(1);
      expect(outcomes1[0]?.status).toBe('settled');

      expect(pipeline.isInFlight('intent-concurrency')).toBe(false);
      expect(pipeline.inFlightCount).toBe(0);
    });

    it('dispatches multiple distinct due intents concurrently', async () => {
      const store = new InMemoryIntentStore();
      const owner1 = sampleOwner();
      const owner2 = sampleOwner();

      store.add('intent-1', owner1, sampleIntent({ owner: owner1, triggerPrice: 3000n * 10n ** 18n }));
      store.add('intent-2', owner2, sampleIntent({ owner: owner2, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'done', 3000n);
        return {
          status: 'settled',
          txHash: `0x${intent.id}` as Hex,
          amountOut: 3000n,
          fee: 30n,
        };
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3200n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(runIntentMock).toHaveBeenCalledTimes(2);
      expect(outcomes.length).toBe(2);
      expect(store.get('intent-1')?.status).toBe('done');
      expect(store.get('intent-2')?.status).toBe('done');
    });
  });

  describe('Retry and Pending Transitions', () => {
    it('keeps intent eligible for future polls when Executor returns pending (stayPending)', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-retry', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      let attempts = 0;
      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        attempts++;
        if (attempts === 1) {
          // Simulation or inventory unavailable -> stays pending
          return { status: 'pending', reason: 'INVENTORY_UNAVAILABLE' };
        }
        store.mark(intent.id, 'done', 3000n);
        return {
          status: 'settled',
          txHash: '0xpass' as Hex,
          amountOut: 3000n,
          fee: 30n,
        };
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3100n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      // First report: stays pending
      const outcomes1 = await pipeline.handleReport(report);
      expect(outcomes1).toEqual([{ status: 'pending', reason: 'INVENTORY_UNAVAILABLE' }]);
      expect(store.get('intent-retry')?.status).toBe('pending');

      // Second report arrives: retries and succeeds
      const outcomes2 = await pipeline.handleReport(report);
      expect(outcomes2).toEqual([
        expect.objectContaining({ status: 'settled', txHash: '0xpass' }),
      ]);
      expect(store.get('intent-retry')?.status).toBe('done');
    });
  });

  describe('Execution Failures and Terminal States', () => {
    it('marks intent failed and prevents further execution when Executor returns failed', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-fail', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'failed', undefined, 'REVERTED');
        return { status: 'failed', reason: 'REVERTED' };
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3100n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(outcomes).toEqual([{ status: 'failed', reason: 'REVERTED' }]);
      expect(store.get('intent-fail')?.status).toBe('failed');

      // Subsequent price reports never execute it again
      const outcomes2 = await pipeline.handleReport(report);
      expect(outcomes2).toEqual([]);
      expect(runIntentMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Expired and Cancelled Intents', () => {
    it('never executes expired intents', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-expired',
        owner,
        sampleIntent({
          owner,
          triggerPrice: 3000n * 10n ** 18n,
          expiry: 1500n,
        }),
      );

      const runIntentMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
        now: () => 1600 * 1000, // clock is 1600 > 1500
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3200n * 10n ** 18n,
        ts: 1550, // report ts is 1550 > 1500
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(runIntentMock).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
    });

    it('never executes cancelled intents', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add(
        'intent-cancelled',
        owner,
        sampleIntent({
          owner,
          triggerPrice: 3000n * 10n ** 18n,
        }),
      );

      // User cancels the intent
      store.cancel('intent-cancelled', owner);
      expect(store.get('intent-cancelled')?.status).toBe('cancelled');

      const runIntentMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(runIntentMock).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
    });
  });

  describe('Error Isolation and Loop Resilience', () => {
    it('isolates errors for individual intents without stopping execution of sibling intents', async () => {
      const store = new InMemoryIntentStore();
      const owner1 = sampleOwner();
      const owner2 = sampleOwner();

      store.add('intent-error', owner1, sampleIntent({ owner: owner1, triggerPrice: 3000n * 10n ** 18n }));
      store.add('intent-success', owner2, sampleIntent({ owner: owner2, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        if (intent.id === 'intent-error') {
          throw new Error('RPC_NODE_DISCONNECTED');
        }
        store.mark(intent.id, 'done', 2500n);
        return {
          status: 'settled',
          txHash: '0xok' as Hex,
          amountOut: 2500n,
          fee: 25n,
        };
      });

      const onIntentErrorMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
        onIntentError: onIntentErrorMock,
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      // Does not throw and processes the second intent
      const outcomes = await pipeline.handleReport(report);

      expect(onIntentErrorMock).toHaveBeenCalledTimes(1);
      expect(onIntentErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'intent-error' }),
        expect.any(Error),
      );

      expect(outcomes.length).toBe(1);
      expect(outcomes[0]?.status).toBe('settled');
      expect(store.get('intent-success')?.status).toBe('done');

      // Error lock was cleared
      expect(pipeline.isInFlight('intent-error')).toBe(false);
    });
  });

  describe('Restart and Executor.recover Compatibility', () => {
    it('does not re-execute intents that were recovered to terminal states after restart', async () => {
      const owner = sampleOwner();
      const msg = sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n });

      // Simulated journal history before restart: intent created, broadcast, and settled
      const journalEvents: Array<{ event: JournalEvent; timestamp: number }> = [
        { timestamp: 10, event: { t: 'INTENT_CREATED', id: 'intent-recovered', owner, intent: msg } },
        {
          timestamp: 20,
          event: {
            t: 'EXEC_SETTLED',
            opId: 'exec:intent-recovered',
            intentId: 'intent-recovered',
            owner,
            tokenOut: USDC,
            amountOut: 3000n,
            fee: 30n,
          },
        },
      ];

      // Reconstruct store on reboot
      const store = await replayIntents(journalEvents);
      expect(store.get('intent-recovered')?.status).toBe('done');

      const runIntentMock = vi.fn();
      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3500n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(runIntentMock).not.toHaveBeenCalled();
      expect(outcomes).toEqual([]);
    });

    it('executes still-pending intents normally after reboot replay', async () => {
      const owner = sampleOwner();
      const msg = sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n });

      // Journal history has unbroadcast intent
      const journalEvents: Array<{ event: JournalEvent; timestamp: number }> = [
        { timestamp: 10, event: { t: 'INTENT_CREATED', id: 'intent-unbroadcast', owner, intent: msg } },
      ];

      const store = await replayIntents(journalEvents);
      expect(store.get('intent-unbroadcast')?.status).toBe('pending');

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'done', 3100n);
        return {
          status: 'settled',
          txHash: '0xboot' as Hex,
          amountOut: 3100n,
          fee: 31n,
        };
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      const report: PriceReport = {
        pair: `${NATIVE}/${USDC}`,
        price: 3200n * 10n ** 18n,
        ts: 1000,
        source: 'uniswap',
      };

      const outcomes = await pipeline.handleReport(report);
      expect(runIntentMock).toHaveBeenCalledTimes(1);
      expect(outcomes.length).toBe(1);
      expect(store.get('intent-unbroadcast')?.status).toBe('done');
    });
  });

  describe('Integration with PricePoller', () => {
    it('triggers execution when PricePoller fires a valid report', async () => {
      const store = new InMemoryIntentStore();
      const owner = sampleOwner();
      store.add('intent-poller', owner, sampleIntent({ owner, triggerPrice: 3000n * 10n ** 18n }));

      const runIntentMock = vi.fn<[StoredIntent], Promise<SwapOutcome>>(async (intent) => {
        store.mark(intent.id, 'done', 3000n);
        return {
          status: 'settled',
          txHash: '0xpoll' as Hex,
          amountOut: 3000n,
          fee: 30n,
        };
      });

      const pipeline = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
      });

      // Price report produces quote of 3200 USDC per 1 ETH
      const quoter = {
        quote: async () => ({
          amountIn: 100_000_000_000_000_000n, // 0.1 ETH
          amountOut: 320_000_000n, // 320 USDC (rate: 3200 USDC/ETH)
          minAmountOut: 319_000_000n,
        }),
      };

      const poller = new PricePoller({
        quoter,
        tokenOut: USDC,
        tokenOutDecimals: 6,
        referenceAmountWei: 100_000_000_000_000_000n,
        intervalSec: 10,
        swapper: sampleOwner(),
        onReport: pipeline.onReport,
        onError: vi.fn(),
      });

      // Start poller via pipeline
      const pipelineWithPoller = new IntentExecutionPipeline({
        intents: store,
        executor: { runIntent: runIntentMock },
        poller,
      });

      const stop = pipelineWithPoller.start();

      // Wait a tick for poll to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      stop();

      expect(runIntentMock).toHaveBeenCalledTimes(1);
      expect(store.get('intent-poller')?.status).toBe('done');
    });
  });

  describe('Journal-first Accounting and Non-Duplication End-to-End', () => {
    it('preserves accounting conservation and deterministically reconstructs both ledger and intents from journal', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'cloakroom-pipeline-test-'));
      const journalFile = join(tempDir, 'journal.bin');
      const testKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex;

      try {
        const journal = new EncryptedJournal({
          filePath: journalFile,
          key: testKey,
          fsync: false,
        });

        const ledger = new InMemoryLedger();
        const store = new InMemoryIntentStore();
        const alice = sampleOwner();

        // 1. Deposit 5 ETH to Alice
        const depositEvent: JournalEvent = {
          t: 'DEPOSIT_CREDITED',
          id: 'dep:1',
          amount: 5n * 10n ** 18n,
          block: 100n,
          owner: alice,
        };
        const depSessionEvent: JournalEvent = {
          t: 'DEPOSIT_SESSION_OPENED',
          id: 'dep:1',
          owner: alice,
          eoa: sampleOwner(),
          expiry: 2000,
          baseline: 0n,
          baselineBlock: 100n,
        };
        await journal.append(depSessionEvent);
        ledger.apply(depSessionEvent);
        await journal.append(depositEvent);
        ledger.apply(depositEvent);

        // 2. Alice creates intent for 1 ETH -> USDC at price >= 3000
        const intentMsg = sampleIntent({
          owner: alice,
          amountIn: 1n * 10n ** 18n,
          triggerPrice: 3000n * 10n ** 18n,
        });
        store.add('intent-alice', alice, intentMsg);
        const intentCreatedEvent: JournalEvent = {
          t: 'INTENT_CREATED',
          id: 'intent-alice',
          owner: alice,
          intent: intentMsg,
        };
        await journal.append(intentCreatedEvent);
        ledger.apply(intentCreatedEvent);

        // Verify balance: available=4 ETH, reserved=1 ETH
        let [balEth] = ledger.balances(alice);
        expect(balEth?.available).toBe(4n * 10n ** 18n);
        expect(balEth?.reserved).toBe(1n * 10n ** 18n);

        // 3. Executor mock that mirrors real executor's journaled settlement
        const executor: Pick<Executor, 'runIntent'> = {
          runIntent: async (stored) => {
            const amountOut = 3200n * 10n ** 6n;
            const fee = 32n * 10n ** 6n;

            const settledEvent: JournalEvent = {
              t: 'EXEC_SETTLED',
              opId: `exec:${stored.id}`,
              intentId: stored.id,
              owner: stored.owner,
              tokenOut: USDC,
              amountOut,
              fee,
            };
            await journal.append(settledEvent);
            ledger.apply(settledEvent);
            store.mark(stored.id, 'done', amountOut - fee);

            return {
              status: 'settled',
              txHash: '0xsettle' as Hex,
              amountOut,
              fee,
            };
          },
        };

        const pipeline = new IntentExecutionPipeline({
          intents: store,
          executor,
        });

        // 4. Report arrives with price 3100
        const report: PriceReport = {
          pair: `${NATIVE}/${USDC}`,
          price: 3100n * 10n ** 18n,
          ts: 1000,
          source: 'uniswap',
        };

        const outcomes = await pipeline.handleReport(report);
        expect(outcomes.length).toBe(1);
        expect(outcomes[0]?.status).toBe('settled');

        // Check balances after settlement: 4 ETH available, 0 ETH reserved, 3168 USDC available
        [balEth] = ledger.balances(alice);
        expect(balEth?.available).toBe(4n * 10n ** 18n);
        expect(balEth?.reserved).toBe(0n);

        const balUsdc = ledger.balances(alice).find((b) => b.token === USDC);
        expect(balUsdc?.available).toBe(3168n * 10n ** 6n); // 3200 - 32 fee

        await journal.close();

        // 5. Open journal in a fresh restart scenario
        const recoverJournal = new EncryptedJournal({
          filePath: journalFile,
          key: testKey,
          fsync: false,
        });

        const recoveredLedger = await replayLedger(recoverJournal);
        const recoveredStore = await replayIntents(recoverJournal);

        // Verify recovered state matches live state exactly
        const [recEth] = recoveredLedger.balances(alice);
        expect(recEth?.available).toBe(4n * 10n ** 18n);
        expect(recEth?.reserved).toBe(0n);

        const recUsdc = recoveredLedger.balances(alice).find((b) => b.token === USDC);
        expect(recUsdc?.available).toBe(3168n * 10n ** 6n);

        const recIntent = recoveredStore.get('intent-alice');
        expect(recIntent?.status).toBe('done');
        expect(recIntent?.settledAmountOut).toBe(3168n * 10n ** 6n);

        await recoverJournal.close();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
