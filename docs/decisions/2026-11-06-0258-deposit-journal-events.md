# Deposit journal event resolution

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas, Apurva | Phase 1 |

## Problem

The initial deposit event types in `docs/enclave.md` did not align with balance-based deposit tracking in `DepositWatcher`:
1. `DEPOSIT_CREDITED` expected a transaction hash (`txHash`), but reading an EOA balance delta does not reveal transaction hashes without heavy block/trace RPC scans.
2. `DEPOSIT_SESSION_OPENED` lacked baseline balance and baseline block information, causing replay on boot to lose the baseline.
3. `DEPOSIT_SESSION_CLOSED` in `watcher.ts` lacked the `eoa` address, which `Inventory.replay` requires to relabel the EOA to `inventory`.

## Existing behavior

Both sides are now aligned:
- `watcher.ts` emits `owner` in `DEPOSIT_CREDITED` and `eoa` in `DEPOSIT_SESSION_CLOSED`.
- `packages/shared/src/types/journal.ts` defines `baseline` and `baselineBlock` in `DEPOSIT_SESSION_OPENED`, accepts `block` and `owner` in `DEPOSIT_CREDITED`, and requires `eoa` in `DEPOSIT_SESSION_CLOSED`.

## Decision

The canonical shapes in `@cloakroom/shared` are resolved as follows:
1. `DEPOSIT_SESSION_OPENED`:
   ```ts
   {
     t: 'DEPOSIT_SESSION_OPENED';
     id: string;
     owner: Address;
     eoa: Address;
     expiry: number;
     baseline: bigint;
     baselineBlock: bigint;
   }
   ```
   Requires `baseline: bigint` and `baselineBlock: bigint`. During session opening, the confirmed block and confirmed balance are queried on-chain and persisted to the journal before the session is returned. During replay, `DepositWatcher` restores sessions without performing historical chain RPC queries. Incomplete historical events missing either field are rejected explicitly.
2. `DEPOSIT_CREDITED`:
   ```ts
   {
     t: 'DEPOSIT_CREDITED';
     id: string;
     amount: bigint;
     block: bigint;
     owner: Address;
     txHash?: Hex;
   }
   ```
   Requires `block: bigint` instead of mandatory `txHash`. Requires `owner: Address` so ledger replay can credit the owner directly without maintaining a secondary session map or risking state loss. Incomplete historical events missing `owner` are rejected explicitly.
3. `DEPOSIT_SESSION_CLOSED`:
   ```ts
   {
     t: 'DEPOSIT_SESSION_CLOSED';
     id: string;
     eoa: Address;
   }
   ```
   Includes `eoa: Address`. When emitted or replayed, `Inventory` immediately relabels the custody EOA as available inventory via `markInventory(event.eoa)`.

## Compatibility and Migration Strategy

Prior developmental versions allowed optional `baseline` and `baselineBlock` on `DEPOSIT_SESSION_OPENED`, and optional `owner` on `DEPOSIT_CREDITED`.

For production deployment:
- All new journal writes strictly validate that `baseline` and `baselineBlock` are present on `DEPOSIT_SESSION_OPENED` and that `owner` is present on `DEPOSIT_CREDITED`.
- Replay validation in both `InMemoryLedger.apply()` and `DepositWatcher.replay()` explicitly halts on malformed historical events lacking these mandatory fields rather than guessing or applying default values.
- Pre-production test journals or development databases containing legacy partial events must be drained or migrated prior to production replay.

## Integration handoff for Apurva

In `services/enclave/src/watcher.ts`:
- Replace internal `DepositEvent` with `JournalEvent` from `@cloakroom/shared`.

## Consequences

- Resolves the blocking conflict between `watcher.ts` and `packages/shared`.
- Deposit replay is deterministic and requires zero RPC queries.

## Implementation note

`baseline` and `baselineBlock` are optional in `JournalEvent`, but `watcher.ts` always writes them. `DepositWatcher.replay` throws `MISSING_BASELINE` if an opened session lacks either one, rather than assuming zero, which could credit funds the address already held.
