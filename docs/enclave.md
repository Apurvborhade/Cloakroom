# Enclave modules and interfaces

Every state change goes through one serialized queue and is written to the journal before it takes effect. State in memory is always rebuildable by replaying the journal.

## File ownership

```text
services/enclave/
  src/
    server.ts     # Fastify routes, body limits, validation   Shreyas
    queue.ts      # serialized queue                          Shreyas
    envelope.ts   # decrypt incoming requests                 Felix
    keys.ts       # HD seed, derive EOAs, signing guard       Felix
    ledger.ts     # balances, reserve, release, consume       Shreyas
    journal.ts    # append-only hash-chained event log        Shreyas
    auth.ts       # EIP-712 verify, nonces, expiry            Shreyas
    intents.ts    # intent store and condition check          Shreyas
    reconcile.ts  # invariant check                           Shreyas
    watcher.ts    # deposit and receipt tracking              Apurva
    inventory.ts  # per-EOA balances, EOA selection           Apurva
    executor.ts   # swap, payout, tx lifecycle                Apurva
    oracle.ts     # price reports and cross-check             Apurva
  Dockerfile                                                  Felix
```

## Queue (Shreyas)

```ts
// services/enclave/src/queue.ts
export interface SerialQueue {
  run<T>(op: () => Promise<T>): Promise<T>; // one op at a time, in arrival order
}
```

## Journal (Shreyas)

Append-only. Each entry carries the hash of the previous one. This event list has known gaps: see [decisions.md](decisions.md) gap 3.3.

```ts
// journal.ts
export type JournalEvent =
  | { t: 'NONCE_USED'; owner: Address; nonce: bigint }
  | { t: 'DEPOSIT_SESSION_OPENED'; id: string; owner: Address; eoa: Address; expiry: number }
  | { t: 'DEPOSIT_CREDITED'; id: string; amount: bigint; txHash: Hex }
  | { t: 'INTENT_CREATED'; id: string; owner: Address; intent: IntentMsg }
  | { t: 'EXEC_BROADCAST'; opId: string; eoa: Address; nonce: number; txHash: Hex; raw: Hex }
  | { t: 'EXEC_SETTLED'; opId: string; amountOut: bigint }
  | { t: 'EXEC_FAILED'; opId: string; reason: string }
  | { t: 'WITHDRAWAL_LOCKED'; id: string; owner: Address; token: Address; amount: bigint; to: Address }
  | { t: 'WITHDRAWAL_BROADCAST'; id: string; eoa: Address; nonce: number; txHash: Hex; raw: Hex }
  | { t: 'WITHDRAWAL_CONFIRMED'; id: string }
  | { t: 'WITHDRAWAL_FAILED'; id: string; reason: string };

export interface Journal {
  append(e: JournalEvent): Promise<void>; // encrypted at rest, fsync before returning
  replay(): AsyncIterable<JournalEvent>;
}
```

## Ledger (Shreyas)

```ts
// ledger.ts: per owner and token, all amounts bigint
export interface Ledger {
  credit(owner: Address, token: Address, amt: bigint, ref: string): void;
  reserve(owner: Address, token: Address, amt: bigint, ref: string): void; // throws InsufficientBalance
  release(ref: string): void; // reserved back to available
  consume(ref: string): void; // reserved leaves the system
  balances(owner: Address): Balance[];
  totals(): Map<Address, { available: bigint; reserved: bigint }>; // for reconcile
}
```

## Key manager (Felix)

```ts
// keys.ts: the only code that touches private keys
export interface KeyManager {
  init(): Promise<void>; // load sealed seed, or generate inside the enclave
  allocate(role: 'deposit' | 'inventory'): CustodyEOA;
  list(): CustodyEOA[];
  sign(eoa: Address, tx: TxRequest, opId: string): Promise<Hex>;
}
```

**Signing guard:** before an operation starts, the executor registers `opId` with the expected destination, value and calldata hash. `KeyManager.sign` refuses any transaction that does not match a registered, journaled operation, and each opId signs once. There is no endpoint that returns a key or a seed.

## Intents (Shreyas)

```ts
// intents.ts
export interface IntentStore {
  add(owner: Address, msg: IntentMsg): string; // reserves amountIn via Ledger
  due(price: PriceReport): StoredIntent[];     // conditions met and not expired
  mark(id: string, s: IntentStatus): void;
}
```

## Inventory (Apurva)

```ts
// inventory.ts: physical balances per custody EOA
export interface Inventory {
  refresh(): Promise<void>; // read balances from chain
  pick(token: Address, amt: bigint, exclude: Set<Address>): CustodyEOA | null;
  hold(eoa: Address, token: Address, amt: bigint, opId: string): void;
  free(opId: string): void;
}
```

## Executor (Apurva)

```ts
// executor.ts
export interface Executor {
  runIntent(i: StoredIntent): Promise<void>;        // quote, sign, broadcast, settle
  runWithdrawal(w: LockedWithdrawal): Promise<void>; // transfer, confirm, finalize
  recover(): Promise<void>;                          // on boot: settle or fail unfinished ops
}
```

## Oracle (Apurva)

```ts
// oracle.ts
export type PriceReport = { pair: string; price: bigint; ts: number; source: string }; // 1e18 fixed point

export interface Oracle {
  accept(r: PriceReport, authHeader: string): Promise<PriceReport>; // auth, staleness, cross-check
}
```

## Reconcile (Shreyas)

```ts
// reconcile.ts
export function reconcile(): { ok: boolean; perToken: Array<{ token: Address; onChain: bigint; claims: bigint }> };
```

## Boot order

1. Init keys
2. Replay the journal into the ledger and intent store
3. Refresh inventory
4. Run `Executor.recover()`
5. Open the server and start the watcher
