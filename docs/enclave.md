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

Append-only, hash-chained, and encrypted at rest with AES-256-GCM. Every append operation calls `fsync()` before returning. Replaying the journal from sequence 1 deterministically reconstructs the in-memory ledger and state after a restart. See [journal durability and replay](decisions/2026-11-06-0745-journal-durability-and-replay.md).

```ts
// packages/shared/src/types/journal.ts
export type JournalEvent =
  | { t: 'NONCE_USED'; owner: Address; nonce: bigint }
  | { t: 'DEPOSIT_SESSION_OPENED'; id: string; owner: Address; eoa: Address; expiry: number; baseline?: bigint; baselineBlock?: bigint }
  | { t: 'DEPOSIT_CREDITED'; id: string; amount: bigint; block: bigint; owner?: Address; txHash?: Hex }
  | { t: 'DEPOSIT_SESSION_CLOSED'; id: string; eoa: Address }
  | { t: 'INTENT_CREATED'; id: string; owner: Address; intent: IntentMsg }
  | { t: 'INTENT_CANCELLED'; id: string; owner: Address }
  | { t: 'INTENT_EXPIRED'; id: string; owner: Address }
  | { t: 'EXEC_BROADCAST'; opId: string; eoa: Address; nonce: number; txHash: Hex; raw: Hex; intentId?: string }
  | { t: 'EXEC_SETTLED'; opId: string; intentId: string; owner: Address; tokenOut: Address; amountOut: bigint; fee: bigint }
  | { t: 'EXEC_FAILED'; opId: string; intentId: string; owner: Address; reason: string }
  | { t: 'WITHDRAWAL_LOCKED'; id: string; owner: Address; token: Address; amount: bigint; to: Address }
  | { t: 'WITHDRAWAL_BROADCAST'; id: string; eoa: Address; nonce: number; txHash: Hex; raw: Hex }
  | { t: 'WITHDRAWAL_CONFIRMED'; id: string; owner: Address }
  | { t: 'WITHDRAWAL_FAILED'; id: string; owner: Address; reason: string }
  | { t: 'FEE_BOOKED'; opId: string; token: Address; feeAmount: bigint };

export interface Journal {
  append(e: JournalEvent): Promise<JournalEntry>; // encrypted at rest, fsync before returning
  replay(): AsyncIterable<JournalEntry>;
  lastEntryHash(): Hex;
  close(): Promise<void>;
}
```

### EncryptedJournal Implementation

The production journal implementation resides in `services/enclave/src/journal.ts` (`EncryptedJournal`).

#### Binary Frame Format

Each journal entry on disk is framed as:

```text
+-----------------------+-------------------+----------------------+--------------------+
| payloadLength (4 B)   | iv (12 B)         | ciphertext (N B)     | authTag (16 B)     |
| uint32 big-endian     | random AES-GCM IV | encrypted JSON       | GCM auth tag       |
+-----------------------+-------------------+----------------------+--------------------+
```

- **Encryption:** AES-256-GCM using a 32-byte key (passed directly or derived). A fresh cryptographic 12-byte IV is generated per record.
- **Payload:** Serialized JSON payload containing `{ seq, ts, prevHash, hash, event }`.
- **Deterministic Serialization:** Canonical JSON sorting keys alphabetically and formatting `bigint` values as `"123n"`.
- **Entry Hash Calculation:**
  ```ts
  entryHash = keccak256(
    concat([
      encodePacked(['uint64', 'uint64'], [seq, ts]),
      prevHash,
      stringToHex(canonicalJson(event))
    ])
  )
  ```
- **Hash-Chain:** Genesis hash is `0x0000000000000000000000000000000000000000000000000000000000000000`. Every entry stores the `prevHash` of the preceding entry.
- **Append Durability:**
  - Concurrent appends serialize via internal Promise chaining.
  - Payload encrypted and framed, written to file handle, followed immediately by `handle.sync()` (`fsync`).
  - Sequence number and hash chain advance in memory only after durable write succeeds.
  - If a write or sync fails, the file is truncated back to its pre-write position to avoid corrupted tails.
- **Replay & Crash Recovery:**
  - Iterates frames sequentially, validating frame size, IV, auth tag, decryption, JSON schema, sequence continuity (`seq === lastSeq + 1`), previous hash pointer (`prevHash === lastHash`), and cryptographic entry hash.
  - Crash recovery at EOF: If an incomplete frame is encountered at EOF (process terminated during write before sync completed), the corrupted or partial trailing bytes are truncated, the journal restores to the last valid frame, and subsequent appends succeed cleanly.
  - Mid-file corruptions, sequence gaps, broken hash links, or oversized frames throw fatal errors and halt replay.
- **Lifecycle:**
  - `close()` flushes and closes file handles idempotently. Operations after close reject immediately.

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

The signer is a `TransactionSigner`: `KeyManager.sign` plus `registerOp(opId, { eoa, to, value, dataHash })`, which registers what the signing guard must see.

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
