import { ERROR_CODES } from '@cloakroom/shared';
import type {
  MarginAccounting,
  MarginCloseMsg,
  MarginOpenMsg,
  MarginOperation,
  PriceReport,
} from '@cloakroom/shared';
import type { Address, Hex } from 'viem';
import { AuthError } from './auth.js';
import type { Executor } from './executor.js';

export interface MarginOrdersDeps {
  accounting: Pick<MarginAccounting, 'prepareOpen' | 'prepareClose'>;
  executor: Pick<Executor, 'runMarginOperation'>;
  riskPrices: { latest(): PriceReport | null };
  onError: (error: unknown) => void;
}

/**
 * Turns a verified request into an approved operation and starts its swap. Answers once accounting
 * has approved it, without waiting for the chain. Queries show how it ended.
 */
export class MarginOrders {
  private running = 0;

  constructor(private readonly deps: MarginOrdersDeps) {}

  get inFlightCount(): number {
    return this.running;
  }

  async open(owner: Address, message: MarginOpenMsg): Promise<Hex> {
    const operation = await this.deps.accounting.prepareOpen(owner, message, this.freshPrice());
    this.execute(operation);
    return operation.positionId;
  }

  async close(owner: Address, message: MarginCloseMsg): Promise<Hex> {
    const operation = await this.deps.accounting.prepareClose(owner, message, this.freshPrice());
    this.execute(operation);
    return operation.positionId;
  }

  /** Runs an approved operation in the background. The executor reports its result to accounting. */
  execute(operation: MarginOperation): void {
    this.running += 1;
    this.deps.executor
      .runMarginOperation(operation)
      .catch(this.deps.onError)
      .finally(() => {
        this.running -= 1;
      });
  }

  /** Refused rather than guessed: new risk must never be taken on an old price. */
  private freshPrice(): PriceReport {
    const price = this.deps.riskPrices.latest();
    if (!price) throw new AuthError(ERROR_CODES.STALE_PRICE);
    return price;
  }
}
