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
    price-poller.ts # price checks from Uniswap quotes        Apurva
  Dockerfile                                                  Felix
```

## Queue (Shreyas)

The queue provides strictly serialized, FIFO execution of all state-mutating operations.

```ts
// packages/shared/src/types/interfaces.ts
export interface SerialQueue {
  run<T>(op: () => Promise<T>): Promise<T>; // one op at a time, in arrival order
}
```

```ts
// services/enclave/src/queue.ts
export class FifoSerialQueue implements SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(op: () => Promise<T>): Promise<T> { ... }
}
```

### Guarantees

1. **FIFO order:** Operations execute strictly in the order they are submitted.
2. **Strict serialization:** Maximum concurrency is exactly one; only one operation executes at any time.
3. **Settlement pacing:** The next operation starts only after the previous operation settles (resolves or rejects).
4. **Caller isolation:** Each caller receives its own operation's return value or rejection.
5. **Error containment:** Rejections and synchronous exceptions are isolated to the caller's Promise; the queue tail recovers to a resolved Promise so subsequent operations continue unaffected.
6. **Deadlock prevention:** Operations must not recursively enqueue and await another operation on the same queue.

## Journal (Shreyas)

Append-only. Each entry carries the hash of the previous one. This event list has known gaps: see [journal replay events](decisions/2026-11-06-0151-journal-replay-events.md) and [deposit journal events](decisions/2026-11-06-0258-deposit-journal-events.md).

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
  allocate(role: 'deposit' | 'inventory'): Promise<CustodyEOA>; // persisted before returning
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
  markInventory(eoa: Address): void; // connect to the watcher's onSessionClosed
  linkOwner(owner: Address, eoa: Address): void; // after a deposit session opens or a swap runs
  eoasLinkedTo(owner: Address): ReadonlySet<Address>; // pass to pick as exclude
  replay(event: JournalEvent): void; // on boot: rebuild roles and owner links
  getPhysicalBalances(): Promise<Map<Address, bigint>>; // InventoryReader, for reconcile
}
```

An EOA runs one operation at a time. `pick` also requires the gas reserve when sending an ERC-20, because the EOA still pays gas. After an operation confirms, call `refresh` and then `free`, in that order: freeing first would make spent funds look available until the next refresh.

## Executor (Apurva)

```ts
// executor.ts
export interface Executor {
  runIntent(i: StoredIntent): Promise<void>;        // quote, sign, broadcast, settle
  runWithdrawal(w: LockedWithdrawal): Promise<{ finished: Promise<WithdrawalOutcome> }>; // transfer, confirm, finalize
  recover(): Promise<void>;                          // on boot: settle or fail unfinished ops
}
```

`runWithdrawal` expects the funds to be reserved under the withdrawal ID and journaled as `WITHDRAWAL_LOCKED` already. It resolves once an EOA is assigned, so the API can answer without waiting for confirmations, and rejects with `NO_INVENTORY` after releasing the lock if no EOA can pay.

The signer is a `TransactionSigner`: `KeyManager.sign` plus `await registerOp(opId, { eoa, to, value, dataHash })`, which durably registers what the signing guard must see.

## Price poller (Apurva)

Gets a Uniswap Trading API quote every `PRICE_POLL_INTERVAL_SEC`, and passes it to `IntentStore.due` as a `PriceReport`. A failed poll triggers nothing.

```ts
// price-poller.ts
export interface PricePoller {
  start(): () => void; // returns a function that stops polling
  latest(): PriceReport | null;
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


## Custody implementation handoff

`KeyManager` in `keys.ts` implements `TransactionSigner`. Allocation is asynchronous because persistence completes before an address is returned. Registration now permits a promise; the executor awaits it while synchronous test adapters remain compatible.

The current guard supports journaled native and ERC-20 withdrawals. It checks the locked payout, chain, signer, destination, value, calldata and gas/fee caps, and refuses source-linked EOAs. Swap authorization remains blocked until the swap executor supplies a corresponding authorization contract.

The journal additionally records `SIGNING_REGISTERED` and `SIGNING_COMPLETED`. Signed bytes are cached in sealed state before returning; an uncertain state write faults the manager. Repeated signing is refused after restart. `recoverSigned` retrieves the existing bytes only while the source operation remains pending; broadcast recovery uses the journal's existing raw transaction.

`journalCipher()` exposes encryption/decryption operations, never the derived key. Custody, HPKE and journal material are domain-separated. Normal startup refuses missing state; initial creation requires `allowCreate: true`. Simulation wrapping keys require explicit simulation mode. A live Nitro KMS provider and external rollback anchoring remain deployment work; rolling back both the vault and journal is outside the local rollback check.
