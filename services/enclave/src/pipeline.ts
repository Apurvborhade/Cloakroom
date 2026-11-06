import type { IntentStore, PriceReport, StoredIntent } from '@cloakroom/shared';
import type { Executor, SwapOutcome } from './executor.js';
import type { PricePoller } from './price-poller.js';

export interface IntentExecutionPipelineDeps {
  intents: IntentStore;
  executor: Pick<Executor, 'runIntent'>;
  poller?: Pick<PricePoller, 'start' | 'latest'>;
  /**
   * Called when an intent execution finishes with a known outcome (settled, failed, or stayed pending).
   */
  onExecuted?: (intent: StoredIntent, outcome: SwapOutcome) => void | Promise<void>;
  /**
   * Called when an individual intent execution throws an unexpected error.
   * Ensures the polling loop is not aborted.
   */
  onIntentError?: (intent: StoredIntent, error: unknown) => void;
  /**
   * Optional clock provider (in milliseconds). Defaults to Date.now.
   */
  now?: () => number;
}

/**
 * Connects the price polling lifecycle to conditional intent execution.
 *
 * Guarantees:
 * 1. Checks IntentStore.due(report) on incoming price reports.
 * 2. Passes eligible pending intents to Executor.runIntent.
 * 3. Prevents duplicate concurrent execution of the same intent across overlapping price reports.
 * 4. Preserves journal-first accounting and reservation guarantees (no direct ledger or journal mutations).
 * 5. Handles execution retry transitions consistently (stayPending keeps intent eligible for future reports).
 * 6. Ensures terminal, cancelled, and expired intents are never executed.
 * 7. Isolates individual intent errors so polling continues uninterrupted.
 */
export class IntentExecutionPipeline {
  private readonly inFlight = new Set<string>();
  private pollerStop?: () => void;
  private readonly now: () => number;

  constructor(private readonly deps: IntentExecutionPipelineDeps) {
    this.now = deps.now ?? Date.now;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  isInFlight(id: string): boolean {
    return this.inFlight.has(id);
  }

  /**
   * Starts the attached PricePoller, if provided.
   * Returns a cleanup function that stops polling.
   */
  start(): () => void {
    if (this.deps.poller) {
      this.pollerStop = this.deps.poller.start();
    }
    return () => this.stop();
  }

  /**
   * Stops the attached PricePoller, if running.
   */
  stop(): void {
    if (this.pollerStop) {
      this.pollerStop();
      this.pollerStop = undefined;
    }
  }

  /**
   * Bound onReport handler suitable for passing directly to PricePollerDeps.onReport.
   */
  readonly onReport = async (report: PriceReport): Promise<void> => {
    await this.handleReport(report);
  };

  /**
   * Evaluates due intents for an incoming price report and dispatches eligible intents.
   * Returns outcomes for all intents processed in this run.
   */
  async handleReport(report: PriceReport): Promise<SwapOutcome[]> {
    if (
      !report ||
      typeof report.pair !== 'string' ||
      typeof report.price !== 'bigint' ||
      typeof report.ts !== 'number'
    ) {
      throw new Error('Invalid PriceReport');
    }

    const dueIntents = this.deps.intents.due(report);
    if (dueIntents.length === 0) {
      return [];
    }

    const nowSec = BigInt(Math.floor(this.now() / 1000));

    const tasks = dueIntents.map(async (dueIntent): Promise<SwapOutcome | null> => {
      // 1. Guard against concurrent execution of the same intent across overlapping price updates
      if (this.inFlight.has(dueIntent.id)) {
        return null;
      }
      this.inFlight.add(dueIntent.id);

      try {
        // 2. Re-verify the intent's current state from the store
        const current = this.deps.intents.get(dueIntent.id);
        if (!current || current.status !== 'pending') {
          return null;
        }

        // 3. Ensure expired intents are not dispatched
        if (current.intent.expiry <= nowSec) {
          return null;
        }

        // 4. Dispatch execution through Executor
        const outcome = await this.deps.executor.runIntent(current);
        await this.deps.onExecuted?.(current, outcome);
        return outcome;
      } catch (error) {
        // 5. Individual intent failure must not stop other intents or the polling loop
        this.deps.onIntentError?.(dueIntent, error);
        return null;
      } finally {
        this.inFlight.delete(dueIntent.id);
      }
    });

    const results = await Promise.all(tasks);
    return results.filter((outcome): outcome is SwapOutcome => outcome !== null);
  }
}
