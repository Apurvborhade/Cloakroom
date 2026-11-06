# Journal durability, encryption, and replay specification

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas | Phase 1 (Task 4) |

## Problem

The journal is the single source of truth for reconstructing the in-memory ledger and state after an enclave process crash or restart. Without a strict binary serialization, encryption at rest, atomic append with fsync, and corruption recovery strategy, restart risks state corruption, data loss, or non-deterministic replay.

## Decision

1. **Hash-chain construction:**
   - Monotonic 1-based sequence numbering: `entry.sequence` ($1, 2, 3, \dots$).
   - Genesis entry hash: `prevHash = '0x0000000000000000000000000000000000000000000000000000000000000000'`.
   - Entry hash:
     ```ts
     entryHash = keccak256(
       toHex(
         concat([
           encodePacked(['uint64', 'uint64'], [BigInt(sequence), BigInt(timestamp)]),
           toBytes(prevHash),
           toBytes(canonicalJson(event)),
         ])
       )
     )
     ```
2. **Canonical serialization:**
   - Object keys sorted lexicographically.
   - BigInt values serialized deterministically as decimal strings or tagged strings.
   - Whitespace stripped.
3. **Encryption at rest:**
   - Cipher: AES-256-GCM.
   - Key: Derived from the enclave sealing key or provided via `KeyManager`.
   - On-disk record structure:
     `[payloadLength: 4 bytes BE][iv: 12 bytes][ciphertext: N bytes][authTag: 16 bytes]`
4. **Append durability and fsync:**
   - Every `journal.append(event)` writes to disk and immediately invokes `fdatasync()` / `fsync()` before resolving the Promise.
   - Guarantees that no in-memory mutation occurs until the event is durably flushed to non-volatile storage.
5. **Partial-write & corruption handling on replay:**
   - During startup replay, entries are read sequentially.
   - Each entry verifies:
     a. Framing length matches file read.
     b. AES-GCM authentication tag verifies.
     c. Sequence equals `prevSequence + 1`.
     d. `entry.prevHash` matches previous `entryHash`.
     e. `entry.entryHash` recomputes correctly.
   - If a partial/incomplete write is detected at EOF (e.g. power loss during append), the journal rolls back to the last valid hash-verified entry.
   - Any mid-file corruption throws a fatal error that halts boot to prevent running on forged or broken state.
6. **Replay order on boot:**
   Events are dispatched to subsystem replay handlers in strict chronological order:
   - `NONCE_USED`: updates `Auth` and `Ledger` nonce tables.
   - `DEPOSIT_*`: updates `DepositWatcher`, `Inventory`, and `Ledger`.
   - `INTENT_*`: updates `IntentStore` and `Ledger`.
   - `EXEC_*`: updates `IntentStore`, `Inventory`, and `Ledger`.
   - `WITHDRAWAL_*`: updates `Ledger` and `Inventory`.
   - `FEE_BOOKED`: updates operational fee ledger.

## Consequences

- Full crash-resilience with zero data loss for acknowledged operations.
- Clean foundation for Task 4 implementation.
