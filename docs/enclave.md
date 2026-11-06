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
    swap-calldata.ts # checks router calldata before signing  Apurva
    uniswap.ts    # Trading API client                        Apurva
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
  | { t: 'DEPOSIT_SESSION_OPENED'; id: string; owner: Address; eoa: Address; expiry: number; baseline: bigint; baselineBlock: bigint }
  | { t: 'DEPOSIT_CREDITED'; id: string; amount: bigint; block: bigint; owner: Address; txHash?: Hex }
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

The file-backed journal resides in `services/enclave/src/journal.ts` (`EncryptedJournal`). Nitro uses `SnapshotJournal` over parent storage, described below.

#### Binary Frame Format

Each journal entry on disk is framed as:

```text
+-----------------------+-------------------+----------------------+--------------------+
| payloadLength (4 B)   | iv (12 B)         | ciphertext (N B)     | authTag (16 B)     |
| uint32 big-endian     | random AES-GCM IV | encrypted JSON       | GCM auth tag       |
+-----------------------+-------------------+----------------------+--------------------+
```

- **Encryption:** Pass `cipher: keys.journalCipher()` to `EncryptedJournal.open({ filePath, cipher })`. The existing `key` option remains supported; supply exactly one. Each record uses a fresh 12-byte IV.
- **Payload:** Serialized JSON containing `{ sequence, timestamp, prevHash, entryHash, event }`.
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
  - Short writes are completed before `handle.sync()` (`fsync`). Oversized records are rejected before writing.
  - Sequence number and hash chain advance in memory only after durable write succeeds.
  - Failed appends roll back to the known pre-write offset. If truncation or its `fsync` fails, the journal refuses further operations.
- **Replay & Crash Recovery:**
  - Iterates frames sequentially, validating frame size, IV, auth tag, decryption, JSON schema, sequence continuity (`seq === lastSeq + 1`), previous hash pointer (`prevHash === lastHash`), and cryptographic entry hash.
  - Incomplete records, including EOF tails, stop startup or replay without changing the file. A partial append cannot be distinguished safely from a damaged committed record; automatic tail truncation is disabled.
  - Mid-file corruptions, sequence gaps, broken hash links, or oversized frames throw fatal errors and halt replay.
- **Lifecycle:**
  - `close()` flushes and closes file handles idempotently. Operations after close reject immediately.

## Ledger (Shreyas)

```ts
// packages/shared/src/types/interfaces.ts
export interface Ledger {
  credit(owner: Address, token: Address, amt: bigint, ref: string): void;
  reserve(owner: Address, token: Address, amt: bigint, ref: string): void;
  release(ref: string): void;
  consume(ref: string): void;
  balances(owner: Address): OwnerBalances[];
  totals(): Map<Address, BalanceRecord>;
  getLastNonce(owner: Address): bigint;
  setNonce(owner: Address, nonce: bigint): void;
}
```

### InMemoryLedger Implementation

The in-memory ledger resides in `services/enclave/src/ledger.ts` (`InMemoryLedger`) and provides synchronous accounting and deterministic replay from `JournalEvent` streams via `replayLedger`.

#### Accounting Semantics
- **Balance tracking:** Tracks `{ available: bigint, reserved: bigint }` per owner and token. Advisory `pending` balances are returned as `0n` by the core ledger.
- **Reservation lifecycle:** Funds locked for active intents or pending withdrawals are tracked under unique references (`status: 'active' | 'released' | 'consumed'`). Consumed funds leave user claims without restoring available balances; released funds return to available balances.
- **Nonce management:** Per-owner monotonic nonces starting at `0n`. Lower or duplicate nonces are rejected with `NONCE_USED`.
- **Revenue and gas segregation:** Protocol fee revenue (`EXEC_SETTLED.fee`) and operational gas expenditures (`FEE_BOOKED.feeAmount`) are segregated into dedicated ledgers and excluded from user claims.
- **Replay projection:** `apply(event: JournalEvent)` projects all 15 canonical events in chronological sequence, reconstructing identical ledger snapshots on enclave restart.
- **Invariant verification:** `assertInvariants()` verifies non-negativity, exact reservation conservation, and aggregate totals consistency.

## Authentication and Session Authorization (Shreyas)

The authentication service resides in `services/enclave/src/auth.ts` (`AuthService`).

### Responsibilities
1. **EIP-712 Verification:** Verifies owner signatures using viem's typed-data recovery bound to the enclave's expected domain (`chainId` and `salt = keccak256(enclavePubKey)`).
2. **Session Grants:** Maintains an ephemeral in-memory registry of owner-granted session keys. Validates owner-signed `SessionGrant` up to `SESSION_GRANT_TTL_SEC` (30 minutes). Session keys only authorize read-only operations (`SessionQuery`); they cannot authorize state-mutating requests. Session grants are invalidated on enclave restart.
3. **Expiry & Skew Validation:** Enforces integer-second timestamp boundaries:
   - Requests and queries: `[now - MAX_CLOCK_SKEW_SEC, now + MAX_EXPIRY_FUTURE_SEC]`.
   - Session grants: `(now, now + SESSION_GRANT_TTL_SEC]`.
4. **Replay-Safe Nonce Protection:** Mutating requests (`DepositRequest`, `Intent`, `CancelIntent`, `Withdrawal`) verify signature and expiry outside the queue, then atomically validate and consume nonces inside `FifoSerialQueue`.
   - Reads `ledger.getLastNonce(owner)`.
   - Requires `nonce > lastNonce`. First accepted nonce is `1n` (`> 0n`).
   - Appends `NONCE_USED` to the journal.
   - Updates `ledger.setNonce(owner, nonce)` only after the journal append durably succeeds.

## Key manager (TEE)

```ts
// keys.ts: the only code that touches private keys
export interface KeyManager {
  init(): Promise<void>; // load sealed seed, or generate inside the enclave
  allocate(role: 'deposit' | 'inventory'): Promise<CustodyEOA>; // persisted before returning
  list(): CustodyEOA[];
  sign(eoa: Address, tx: TxRequest, opId: string): Promise<Hex>;
}
```

**Signing guard:** before an operation starts, the executor registers `opId` with the expected destination, value and calldata hash; swaps also supply the full calldata. `KeyManager.sign` refuses any transaction that does not match a registered, journaled operation, and each opId signs once. There is no endpoint that returns a key or a seed.

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
  runIntent(i: StoredIntent): Promise<SwapOutcome>; // quote, check, sign, broadcast, settle
  runWithdrawal(w: LockedWithdrawal): Promise<{ finished: Promise<WithdrawalOutcome> }>; // transfer, confirm, finalize
  recover(history: AsyncIterable<{ event: JournalEvent }>): Promise<RecoveredOperation[]>; // on boot: finish what a restart interrupted
}
```

`runWithdrawal` expects the funds to be reserved under the withdrawal ID and journaled as `WITHDRAWAL_LOCKED` already. It resolves once an EOA is assigned, so the API can answer without waiting for confirmations, and rejects with `NO_INVENTORY` after releasing the lock if no EOA can pay.

Call `runIntent` from the price poller's `onReport` without waiting for it. Its dependencies go in the optional `swaps` setting. It settles through `InMemoryLedger.apply`, so live balances match a replay exactly.

The signer is a `TransactionSigner`: `KeyManager.sign` plus `await registerOp(opId, { eoa, to, value, dataHash })`, which durably registers what the signing guard must see.

## Price poller (Apurva)

Gets a Uniswap Trading API quote through `UniswapClient` in `uniswap.ts` every `PRICE_POLL_INTERVAL_SEC`, and hands each `PriceReport` to `onReport`, which calls `IntentStore.due`. A failed poll reports nothing, polls never overlap, and `latest` returns null once a price is more than two intervals old.

`onReport` must not wait for a swap to finish. Polls use a throwaway `swapper` address, so custody addresses are not sent to Uniswap every interval. `UniswapClient` treats responses as untrusted: it checks the chain, tokens and amounts, and rejects anything but a classic route, because custody EOAs sign ordinary transactions.

```ts
// price-poller.ts
export interface PricePoller {
  start(): () => void; // returns a function that stops polling
  latest(): PriceReport | null; // null if no recent price
}
```

## Reconcile (Shreyas)

```ts
// reconcile.ts
export function reconcile(): { ok: boolean; perToken: Array<{ token: Address; onChain: bigint; claims: bigint }> };
```

## Boot order

1. Call `openNitroRuntime({ keyArn, region, vaultId, buildHash })` to load signing limits from the enclave environment, restore keys, verify the journal, rebuild the ledger, restore signing state and obtain an NSM quote. An explicit `policy` remains supported for isolated tests.
2. Replay other application state, including the intent store, from the returned `journal`.
3. Refresh inventory
4. Run `Executor.recover()`
5. Open the server and start the watcher


## Custody implementation handoff

`KeyManager` in `keys.ts` implements `TransactionSigner`. Allocation is asynchronous because persistence completes before an address is returned. Registration now permits a promise; the executor awaits it while synchronous test adapters remain compatible.

The guard supports journaled native/ERC-20 withdrawals and native-input limit swaps. Swaps require an open, unexpired `INTENT_CREATED`, comparator 0, the configured router/token, exact input value and an EOA not linked to the owner's deposits or prior swaps. Calldata is checked at registration and signing, independently of the executor. The signer trusts journaled intent provenance.

For swaps, call `registerOp(opId, { eoa, to, value, dataHash, data })` with `opId = exec:<intentId>`. `data` is optional only for withdrawals and is persisted with `SIGNING_REGISTERED`. `SigningPolicy.swaps` contains `{ routerAddress, tokenOut, tokenOutDecimals, feeBps }`; `toSigningPolicy` loads these from the existing environment variables. Omitting `swaps` disables swap signing. Both executor and signer use `limitFloor(amountIn, triggerPrice, tokenOutDecimals, feeBps)` to protect the amount credited after fees, with no slippage deduction from the limit.

Key initialization does not read the journal, so opening an encrypted journal cannot cause a circular dependency. Signing and registration validate replayed signing state before proceeding.

The journal additionally records `SIGNING_REGISTERED` and `SIGNING_COMPLETED`; ledger replay ignores this signing metadata. Signed bytes are cached in sealed state before returning; an uncertain state write faults the manager. Repeated signing is refused after restart. `recoverSigned` retrieves the existing bytes only while the source operation remains pending; broadcast recovery uses the journal's existing raw transaction.

`journalCipher()` exposes encryption/decryption operations, never the derived key. Custody, HPKE and journal material are domain-separated. `openNitroRuntime` returns `{ keys, journal, ledger, attestation, close }` only after recovery and attestation succeed. `openCustodyRuntime` provides the same sequence with injected storage and quote providers for local integration tests; simulation wrapping keys require explicit simulation mode.

`SnapshotJournal` stores the entire encrypted journal in the parent's `journal.blob`, capped at 4 MiB including encryption overhead. Each append atomically replaces it through ciphertext CAS; the parent syncs the file and directory before acknowledging. Apply events to memory only after `append` resolves. `JOURNAL_FULL` rejects before writing. A conflicting or uncertain write disables both signing and journal writes until a fresh runtime reloads storage. The snapshot format is separate from `EncryptedJournal` frames; there is no automatic migration.

Initial creation requires `allowCreate: true` and all three blobs (`wrapping`, `custody`, `journal`) absent. Ordinary restarts require all three; missing or corrupt state is never silently replaced. Local tests cover storage-process restarts and dropped acknowledgements. An unfunded live Nitro/KMS test also verified recovery of identity, balances and cached signatures; see [the Nitro runbook](../infra/nitro/README.md#persistent-custody). Rolling back all persisted state together still requires an external trusted checkpoint.
