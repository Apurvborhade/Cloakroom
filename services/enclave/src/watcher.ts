import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent } from '@cloakroom/shared';
import type { Address, PublicClient } from 'viem';

/**
 * The journal events the watcher writes. Every field it needs is required here, while
 * JournalEvent makes some optional: see docs/decisions/2026-11-06-0258-deposit-journal-events.md.
 */
export type DepositEvent =
  | {
      t: 'DEPOSIT_SESSION_OPENED';
      id: string;
      owner: Address;
      eoa: Address;
      expiry: number;
      baseline: bigint;
      baselineBlock: bigint;
    }
  | { t: 'DEPOSIT_CREDITED'; id: string; owner: Address; amount: bigint; block: bigint }
  | { t: 'DEPOSIT_SESSION_CLOSED'; id: string; eoa: Address };

/** The parts of Shreyas's Journal, Ledger and SerialQueue that the watcher uses. */
export interface WatcherJournal {
  append(event: DepositEvent): Promise<unknown>;
}
export interface WatcherLedger {
  credit(owner: Address, token: Address, amount: bigint, ref: string): void;
}
export interface WatcherQueue {
  run<T>(op: () => Promise<T>): Promise<T>;
}

export type WatcherChain = Pick<PublicClient, 'getBalance' | 'getBlock' | 'getBlockNumber'>;

export interface WatcherDeps {
  chain: WatcherChain;
  journal: WatcherJournal;
  ledger: WatcherLedger;
  queue: WatcherQueue;
  confirmations: bigint;
  /** Called once when a session closes, so the EOA can be relabelled as inventory. */
  onSessionClosed?: (eoa: Address) => void;
}

export interface OpenSessionParams {
  id: string;
  owner: Address;
  eoa: Address;
  /** Unix seconds. Blocks after this time are not credited. */
  expiry: number;
}

export interface DepositSession extends OpenSessionParams {
  baseline: bigint;
  credited: bigint;
  lastCheckedBlock: bigint;
  open: boolean;
}

/**
 * Credits deposits by watching each session's EOA balance on-chain.
 *
 * Crediting uses the balance, not the sender, so it also works for smart-contract wallets.
 * Each credit is journaled before it reaches the ledger, and the amount is always measured
 * against what was already credited, so re-reading the same balance cannot credit twice.
 */
export class DepositWatcher {
  private readonly sessions = new Map<string, DepositSession>();
  private running: Promise<void> | null = null;

  constructor(private readonly deps: WatcherDeps) {}

  /** Opens a session and records the EOA's current confirmed balance as its baseline. */
  async openSession(params: OpenSessionParams): Promise<DepositSession> {
    const baselineBlock = await this.confirmedBlock();
    const baseline = await this.deps.chain.getBalance({
      address: params.eoa,
      blockNumber: baselineBlock,
    });

    return this.deps.queue.run(async () => {
      if (this.sessions.has(params.id)) throw new Error('DUPLICATE_SESSION');
      for (const session of this.sessions.values()) {
        if (session.open && session.eoa === params.eoa) throw new Error('EOA_IN_USE');
      }

      await this.deps.journal.append({
        t: 'DEPOSIT_SESSION_OPENED',
        ...params,
        baseline,
        baselineBlock,
      });

      const session: DepositSession = {
        ...params,
        baseline,
        credited: 0n,
        lastCheckedBlock: baselineBlock,
        open: true,
      };
      this.sessions.set(params.id, session);
      return session;
    });
  }

  getSession(id: string): Readonly<DepositSession> | undefined {
    return this.sessions.get(id);
  }

  /**
   * Rebuilds session state from one journal event on boot. Rebuilding the ledger's balances
   * from the same events is the ledger's job, so this never calls ledger.credit.
   * Events that are not about deposits are ignored.
   */
  replay(event: JournalEvent): void {
    switch (event.t) {
      case 'DEPOSIT_SESSION_OPENED':
        // Assuming a missing baseline is zero would credit funds the address already held.
        if (event.baseline === undefined || event.baselineBlock === undefined) {
          throw new Error('MISSING_BASELINE');
        }
        this.sessions.set(event.id, {
          id: event.id,
          owner: event.owner,
          eoa: event.eoa,
          expiry: event.expiry,
          baseline: event.baseline,
          credited: 0n,
          lastCheckedBlock: event.baselineBlock,
          open: true,
        });
        break;
      case 'DEPOSIT_CREDITED': {
        const session = this.requireSession(event.id);
        session.credited += event.amount;
        session.lastCheckedBlock = event.block;
        break;
      }
      case 'DEPOSIT_SESSION_CLOSED':
        this.requireSession(event.id).open = false;
        break;
      default:
        break;
    }
  }

  private requireSession(id: string): DepositSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error('UNKNOWN_SESSION');
    return session;
  }

  /** Checks every open session once. Overlapping calls share the same run. */
  tick(): Promise<void> {
    this.running ??= this.checkOpenSessions().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Runs tick on every new block until the returned function is called. */
  start(
    client: Pick<PublicClient, 'watchBlockNumber'>,
    onError: (error: unknown) => void,
  ): () => void {
    return client.watchBlockNumber({
      emitMissed: false,
      onBlockNumber: () => {
        this.tick().catch(onError);
      },
      onError,
    });
  }

  private async checkOpenSessions(): Promise<void> {
    const confirmed = await this.confirmedBlock();
    for (const session of this.sessions.values()) {
      if (session.open && session.lastCheckedBlock < confirmed) {
        await this.checkSession(session, confirmed);
      }
    }
  }

  private async checkSession(session: DepositSession, confirmed: bigint): Promise<void> {
    const lastInWindow = await this.lastBlockBeforeExpiry(session, confirmed);
    const expired = lastInWindow < confirmed;

    if (lastInWindow > session.lastCheckedBlock) {
      await this.creditIncrease(session, lastInWindow);
      session.lastCheckedBlock = lastInWindow;
    }

    if (expired) await this.closeSession(session);
  }

  private async creditIncrease(session: DepositSession, block: bigint): Promise<void> {
    const balance = await this.deps.chain.getBalance({
      address: session.eoa,
      blockNumber: block,
    });

    await this.deps.queue.run(async () => {
      const amount = balance - session.baseline - session.credited;
      if (amount <= 0n) return;

      await this.deps.journal.append({
        t: 'DEPOSIT_CREDITED',
        id: session.id,
        owner: session.owner,
        amount,
        block,
      });
      session.credited += amount;
      this.deps.ledger.credit(
        session.owner,
        NATIVE,
        amount,
        `deposit:${session.id}:${block.toString()}`,
      );
    });
  }

  private async closeSession(session: DepositSession): Promise<void> {
    await this.deps.queue.run(async () => {
      await this.deps.journal.append({
        t: 'DEPOSIT_SESSION_CLOSED',
        id: session.id,
        eoa: session.eoa,
      });
      session.open = false;
    });
    this.deps.onSessionClosed?.(session.eoa);
  }

  /** Finds the newest block up to `confirmed` whose timestamp is not past the session's expiry. */
  private async lastBlockBeforeExpiry(session: DepositSession, confirmed: bigint): Promise<bigint> {
    const isInWindow = async (blockNumber: bigint) => {
      const block = await this.deps.chain.getBlock({ blockNumber });
      return block.timestamp <= BigInt(session.expiry);
    };

    if (await isInWindow(confirmed)) return confirmed;

    let inWindow = session.lastCheckedBlock;
    let pastExpiry = confirmed;
    while (pastExpiry - inWindow > 1n) {
      const middle = (inWindow + pastExpiry) / 2n;
      if (await isInWindow(middle)) inWindow = middle;
      else pastExpiry = middle;
    }
    return inWindow;
  }

  private async confirmedBlock(): Promise<bigint> {
    const head = await this.deps.chain.getBlockNumber({ cacheTime: 0 });
    return head > this.deps.confirmations ? head - this.deps.confirmations : 0n;
  }
}
