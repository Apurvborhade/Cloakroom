# Concurrency and serialized queue boundaries

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas | Phase 1 |

## Problem

`FifoSerialQueue` guarantees strict concurrency of 1 for all operations passed to `queue.run()`. If long-running network I/O (such as Ethereum RPC calls, Uniswap quote queries, or block waiting) is executed inside the queue, the entire enclave backend becomes unresponsive, blocking unrelated user requests and reads. Conversely, if state mutations or journal appends happen outside the queue, race conditions, double-spends, and nonce reuse become possible.

## Decision

Establish an invariant boundary between inside-queue and outside-queue operations.

### Inside FifoSerialQueue (strictly serialized, synchronous in-memory + local fsync)
1. User nonce check (`nonce > lastNonce`) and reservation.
2. Balance sufficiency verification (`available >= amount`).
3. Journal event appending (`journal.append` with local fsync).
4. Ledger mutations (`credit`, `reserve`, `release`, `consume`).
5. IntentStore status transitions (`add`, `cancel`, `expire`, `mark`).
6. DepositWatcher credit calculations and session closure.
7. Executor pre-broadcast journal entry (`*_BROADCAST`) and post-receipt settlement (`*_SETTLED`, `*_CONFIRMED`, `*_FAILED`, `FEE_BOOKED`).

### Outside FifoSerialQueue (concurrent, non-blocking)
1. Request envelope decryption (HPKE crypto).
2. Signature verification and EIP-712 signer recovery (`ecrecover`).
3. Zod schema parsing and wire validation.
4. Uniswap Trading API quote fetching.
5. On-chain transaction preparation and simulation (`eth_call`, `eth_estimateGas`).
6. Broadcasting raw transactions (`sendRawTransaction`).
7. Waiting for transaction receipts (`waitForTransactionReceipt`).
8. Read endpoints (`GET /attestation`, `POST /balance`, `POST /intents/status`, `POST /withdrawals/status`) once read snapshots are taken.

### Sequence pattern for state-changing operations
For every mutating request (e.g. withdrawal):
1. **Outside queue:** Decrypt payload, validate schema, verify signature and expiry.
2. **Inside queue:** Verify nonce, verify balance, append `WITHDRAWAL_LOCKED` to journal, reserve balance in ledger, advance nonce. Return acknowledgment to caller.
3. **Outside queue:** Call `Executor.runWithdrawal()`.
4. **Executor inside queue:** Append `WITHDRAWAL_BROADCAST`.
5. **Executor outside queue:** Broadcast transaction and await confirmations.
6. **Executor inside queue:** Append `WITHDRAWAL_CONFIRMED` / `WITHDRAWAL_FAILED` and `FEE_BOOKED`, mutate ledger accordingly.

## Consequences

- Maximum server throughput: slow RPC latency never blocks independent API requests.
- Perfect safety: no ledger balance or journal entry is mutated concurrently.
