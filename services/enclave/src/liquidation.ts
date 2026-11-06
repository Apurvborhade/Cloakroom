import type { MarginAccounting, MarginOperation, PriceReport } from '@cloakroom/shared';

export interface LiquidationMonitorDeps {
  accounting: Pick<MarginAccounting, 'liquidationCandidates' | 'prepareLiquidation'>;
  orders: { execute(operation: MarginOperation): void };
  onError: (error: unknown) => void;
}

/**
 * Closes unhealthy positions on each risk price. It decides nothing itself and changes no balance:
 * accounting names the candidates and approves each close. A failed attempt is simply tried again
 * on the next price, and accounting refuses a position that is already closing.
 */
export class LiquidationMonitor {
  private checking = false;

  constructor(private readonly deps: LiquidationMonitorDeps) {}

  readonly onReport = async (price: PriceReport): Promise<void> => {
    if (this.checking) return;
    this.checking = true;
    try {
      const { accounting, onError, orders } = this.deps;
      for (const positionId of await accounting.liquidationCandidates(price)) {
        try {
          const operation = await accounting.prepareLiquidation(positionId, price);
          if (operation) orders.execute(operation);
        } catch (error) {
          // One position's problem must not stop the others being closed.
          onError(error);
        }
      }
    } finally {
      this.checking = false;
    }
  };
}
