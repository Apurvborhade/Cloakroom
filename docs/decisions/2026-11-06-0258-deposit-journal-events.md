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
     baseline?: bigint;
     baselineBlock?: bigint;
   }
   ```
   Contains `baseline` and `baselineBlock`. During replay, `DepositWatcher` restores sessions without performing historical chain RPC queries.
2. `DEPOSIT_CREDITED`:
   ```ts
   {
     t: 'DEPOSIT_CREDITED';
     id: string;
     amount: bigint;
     block: bigint;
     owner?: Address;
     txHash?: Hex;
   }
   ```
   Requires `block: bigint` instead of mandatory `txHash`. Includes `owner: Address` so ledger replay can credit the owner directly without maintaining a secondary session map.
3. `DEPOSIT_SESSION_CLOSED`:
   ```ts
   {
     t: 'DEPOSIT_SESSION_CLOSED';
     id: string;
     eoa: Address;
   }
   ```
   Includes `eoa: Address`. When emitted or replayed, `Inventory` immediately relabels the custody EOA as available inventory via `markInventory(event.eoa)`.

## Integration handoff for Apurva

In `services/enclave/src/watcher.ts`:
- Replace internal `DepositEvent` with `JournalEvent` from `@cloakroom/shared`.

## Consequences

- Resolves the blocking conflict between `watcher.ts` and `packages/shared`.
- Deposit replay is deterministic and requires zero RPC queries.
