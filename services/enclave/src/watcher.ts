import { DepositCompletedEventSchema, DepositSessionOpenedEventSchema, NATIVE, type JournalEvent,
  type DepositStatusResponse } from '@cloakroom/shared';
import { getAddress, parseAbi } from 'viem';
import type { Address, PublicClient } from 'viem';

const BALANCE_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

/**
 * The deposit-related subset of JournalEvent that the watcher reads and writes.
 */
export type DepositEvent = Extract<
  JournalEvent,
  { t: 'DEPOSIT_SESSION_OPENED' | 'DEPOSIT_CREDITED' | 'DEPOSIT_SESSION_CLOSED' | 'DEPOSIT_COMPLETED' }
>;

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

export type WatcherChain = Pick<PublicClient, 'getBalance' | 'getBlock' | 'getBlockNumber'>
  & Partial<Pick<PublicClient, 'readContract'>>;

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
  /** Unix seconds. A new deposit must start by this time; a partial pair may finish later. */
  expiry: number;
  funding?: { asset: Address; gasReserveWei: bigint };
}

export interface DepositSession extends OpenSessionParams {
  funding?: { asset: Address; gasReserveWei: bigint; tokenBaseline: bigint };
  baseline: bigint;
  baselineBlock: bigint;
  credited: bigint;
  lastCheckedBlock: bigint;
  open: boolean;
  nativeReceived: bigint;
  tokenReceived: bigint;
  tokenCredited: bigint;
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
    const funding = params.funding && {
      ...params.funding,
      asset: getAddress(params.funding.asset),
      tokenBaseline: await this.tokenBalance(params.funding.asset, params.eoa, baselineBlock),
    };
    DepositSessionOpenedEventSchema.parse({
      t: 'DEPOSIT_SESSION_OPENED', ...params, funding, baseline, baselineBlock,
    });

    return this.deps.queue.run(async () => {
      if (this.sessions.has(params.id)) throw new Error('DUPLICATE_SESSION');
      for (const session of this.sessions.values()) {
        if (session.open && session.eoa === params.eoa) throw new Error('EOA_IN_USE');
      }

      await this.deps.journal.append({
        t: 'DEPOSIT_SESSION_OPENED',
        ...params,
        funding,
        baseline,
        baselineBlock,
      });

      const session: DepositSession = {
        ...params,
        funding,
        baseline,
        baselineBlock,
        credited: 0n,
        lastCheckedBlock: baselineBlock,
        open: true,
        nativeReceived: 0n,
        tokenReceived: 0n,
        tokenCredited: 0n,
      };
      this.sessions.set(params.id, session);
      return session;
    });
  }

  getSession(id: string): Readonly<DepositSession> | undefined {
    return this.sessions.get(id);
  }

  listByOwner(owner: Address): DepositStatusResponse['deposits'] {
    return [...this.sessions.values()]
      .filter((session) => getAddress(session.owner) === getAddress(owner))
      .map((session) => {
        const asset = session.funding?.asset ?? NATIVE;
        const reserve = session.funding?.gasReserveWei ?? 0n;
        const credited = session.credited > 0n || session.tokenCredited > 0n;
        const status = credited ? 'credited' : !session.open ? 'expired'
          : session.nativeReceived === 0n && session.tokenReceived === 0n ? 'awaiting_funds'
          : session.nativeReceived < reserve || (asset === NATIVE && session.nativeReceived <= reserve)
            ? 'awaiting_gas' : 'awaiting_token';
        return {
          sessionId: session.id, depositAddress: session.eoa, expiresAt: session.expiry,
          asset, gasReserveWei: reserve.toString(), singleUse: !!session.funding, status,
          nativeReceived: session.nativeReceived.toString(), tokenReceived: session.tokenReceived.toString(),
          nativeCredited: session.credited.toString(), tokenCredited: session.tokenCredited.toString(),
        };
      });
  }

  /**
   * Rebuilds session state from one journal event on boot. Rebuilding the ledger's balances
   * from the same events is the ledger's job, so this never calls ledger.credit.
   * Events that are not about deposits are ignored.
   */
  replay(event: JournalEvent): void {
    switch (event.t) {
      case 'DEPOSIT_SESSION_OPENED': {
        if (!event.id) {
          throw new Error('MALFORMED_EVENT: missing id on DEPOSIT_SESSION_OPENED');
        }
        if (!event.owner) {
          throw new Error(`MALFORMED_EVENT: missing owner on DEPOSIT_SESSION_OPENED: ${event.id}`);
        }
        if (!event.eoa) {
          throw new Error(`MALFORMED_EVENT: missing eoa on DEPOSIT_SESSION_OPENED: ${event.id}`);
        }
        if (typeof event.expiry !== 'number') {
          throw new Error(
            `MALFORMED_EVENT: missing or invalid expiry on DEPOSIT_SESSION_OPENED: ${event.id}`,
          );
        }
        if (
          event.baseline === undefined ||
          event.baseline === null ||
          typeof event.baseline !== 'bigint'
        ) {
          throw new Error(
            `MISSING_BASELINE: missing or invalid baseline on DEPOSIT_SESSION_OPENED: ${event.id}`,
          );
        }
        if (
          event.baselineBlock === undefined ||
          event.baselineBlock === null ||
          typeof event.baselineBlock !== 'bigint'
        ) {
          throw new Error(
            `MISSING_BASELINE: missing or invalid baselineBlock on DEPOSIT_SESSION_OPENED: ${event.id}`,
          );
        }
        if (event.funding) DepositSessionOpenedEventSchema.parse(event);
        this.sessions.set(event.id, {
          id: event.id,
          owner: event.owner,
          eoa: event.eoa,
          expiry: event.expiry,
          baseline: event.baseline,
          baselineBlock: event.baselineBlock,
          funding: event.funding && { ...event.funding, asset: getAddress(event.funding.asset) },
          credited: 0n,
          lastCheckedBlock: event.baselineBlock,
          open: true,
          nativeReceived: 0n,
          tokenReceived: 0n,
          tokenCredited: 0n,
        });
        break;
      }
      case 'DEPOSIT_CREDITED': {
        const session = this.requireSession(event.id);
        if (session.funding) throw new Error('MALFORMED_EVENT: legacy credit for single-use deposit');
        if (!event.owner) {
          throw new Error(`MALFORMED_EVENT: missing owner on DEPOSIT_CREDITED: ${event.id}`);
        }
        if (event.owner.toLowerCase() !== session.owner.toLowerCase()) {
          throw new Error(
            `MALFORMED_EVENT: owner mismatch on DEPOSIT_CREDITED: event ${event.owner} != session ${session.owner}`,
          );
        }
        if (typeof event.amount !== 'bigint' || event.amount <= 0n) {
          throw new Error(`MALFORMED_EVENT: invalid amount on DEPOSIT_CREDITED: ${event.amount}`);
        }
        if (typeof event.block !== 'bigint') {
          throw new Error(
            `MALFORMED_EVENT: missing or invalid block on DEPOSIT_CREDITED: ${event.id}`,
          );
        }
        session.credited += event.amount;
        session.nativeReceived = session.credited;
        session.lastCheckedBlock = event.block;
        break;
      }
      case 'DEPOSIT_COMPLETED': {
        DepositCompletedEventSchema.parse(event);
        const session = this.requireSession(event.id);
        if (!session.funding || getAddress(event.owner) !== getAddress(session.owner)
            || getAddress(event.eoa) !== getAddress(session.eoa)
            || getAddress(event.asset) !== session.funding.asset
            || event.gasReserveWei !== session.funding.gasReserveWei) {
          throw new Error('MALFORMED_EVENT: deposit completion mismatch');
        }
        session.credited = event.nativeAmount;
        session.tokenCredited = event.tokenAmount;
        session.nativeReceived = event.nativeAmount + event.gasReserveWei;
        session.tokenReceived = event.tokenAmount;
        session.lastCheckedBlock = event.block;
        session.open = false;
        break;
      }
      case 'DEPOSIT_SESSION_CLOSED': {
        const session = this.requireSession(event.id);
        if (!event.eoa) {
          throw new Error(`MALFORMED_EVENT: missing eoa on DEPOSIT_SESSION_CLOSED: ${event.id}`);
        }
        session.open = false;
        break;
      }
      default:
        break;
    }
  }

  private requireSession(id: string): DepositSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`UNKNOWN_SESSION: ${id}`);
    return session;
  }

  /** Checks every open session once. Overlapping calls share the same run. */
  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.checkOpenSessions().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * Subscribes to new block numbers on the given client, ticking this watcher on each block.
   * Returns an unsubscribe function.
   */
  start(
    client: Pick<PublicClient, 'watchBlockNumber'>,
    onError: (error: unknown) => void,
  ): () => void {
    return client.watchBlockNumber({
      pollingInterval: 1_000,
      emitOnBegin: true,
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
    if (session.funding) {
      await this.checkFunding(session, confirmed);
      return;
    }
    const lastInWindow = await this.lastBlockBeforeExpiry(session, confirmed);
    const expired = lastInWindow < confirmed;

    if (lastInWindow > session.lastCheckedBlock) {
      await this.creditIncrease(session, lastInWindow);
      session.lastCheckedBlock = lastInWindow;
    }

    if (expired) await this.closeSession(session);
  }

  private async tokenBalance(asset: Address, eoa: Address, blockNumber: bigint): Promise<bigint> {
    if (getAddress(asset) === NATIVE) return 0n;
    if (!this.deps.chain.readContract) throw new Error('TOKEN_READER_UNAVAILABLE');
    return this.deps.chain.readContract({
      address: asset, abi: BALANCE_ABI, functionName: 'balanceOf', args: [eoa], blockNumber,
    });
  }

  private async received(session: DepositSession, block: bigint) {
    const [native, token] = await Promise.all([
      this.deps.chain.getBalance({ address: session.eoa, blockNumber: block }),
      this.tokenBalance(session.funding!.asset, session.eoa, block),
    ]);
    return {
      native: native > session.baseline ? native - session.baseline : 0n,
      token: token > session.funding!.tokenBaseline ? token - session.funding!.tokenBaseline : 0n,
    };
  }

  private async checkFunding(session: DepositSession, confirmed: bigint): Promise<void> {
    // Unfinished pairs stay isolated. A transfer before expiry permits completing the pair later.
    const cutoff = await this.lastBlockBeforeExpiry({ ...session, lastCheckedBlock: session.baselineBlock }, confirmed);
    if (cutoff < confirmed) {
      const beforeExpiry = await this.received(session, cutoff);
      if (beforeExpiry.native === 0n && beforeExpiry.token === 0n) {
        await this.closeSession(session);
        return;
      }
    }
    const received = await this.received(session, confirmed);
    session.nativeReceived = received.native;
    session.tokenReceived = received.token;
    const { asset, gasReserveWei } = session.funding!;
    const ready = asset === NATIVE ? received.native > gasReserveWei
      : received.token > 0n && received.native >= gasReserveWei;
    if (!ready) {
      session.lastCheckedBlock = confirmed;
      return;
    }
    const event = {
      t: 'DEPOSIT_COMPLETED' as const, id: session.id, owner: session.owner, eoa: session.eoa,
      asset, nativeAmount: received.native - gasReserveWei, tokenAmount: received.token,
      gasReserveWei, block: confirmed,
    };
    await this.deps.queue.run(async () => {
      await this.deps.journal.append(event);
      if (event.nativeAmount > 0n) {
        this.deps.ledger.credit(event.owner, NATIVE, event.nativeAmount, `deposit:${event.id}:native`);
      }
      if (event.tokenAmount > 0n) {
        this.deps.ledger.credit(event.owner, asset, event.tokenAmount, `deposit:${event.id}:token`);
      }
      this.replay(event);
      this.deps.onSessionClosed?.(session.eoa);
    });
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
      session.nativeReceived = session.credited;
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
