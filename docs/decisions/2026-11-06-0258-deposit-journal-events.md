# Deposit journal events

| Status | Owner | Needed by |
| --- | --- | --- |
| Proposed, already used by watcher.ts | Shreyas, Apurva | Phase 1 |

## Problem

The spec's deposit events do not match balance-based crediting. `DEPOSIT_CREDITED` needs a `txHash`, but reading a balance does not reveal one. `DEPOSIT_SESSION_OPENED` has no baseline, so a restart would lose it.

## Proposal

`watcher.ts` uses these shapes. Shreyas to adopt them in `journal.ts`, and the ledger's replay must look up the owner through the session `id`.

```ts
| { t: 'DEPOSIT_SESSION_OPENED'; id: string; owner: Address; eoa: Address; expiry: number; baseline: bigint; baselineBlock: bigint }
| { t: 'DEPOSIT_CREDITED'; id: string; amount: bigint; block: bigint }
| { t: 'DEPOSIT_SESSION_CLOSED'; id: string }
```

## Conflict with `packages/shared`

`JournalEvent` in `packages/shared/src/types/journal.ts` was added without these changes, so `watcher.ts` cannot use the real `Journal` yet.

| Event | `packages/shared` | `watcher.ts` |
| --- | --- | --- |
| `DEPOSIT_SESSION_OPENED` | No baseline | `baseline`, `baselineBlock` |
| `DEPOSIT_CREDITED` | `owner`, `txHash` | `block` |
| `DEPOSIT_SESSION_CLOSED` | `eoa` | No `eoa` |

## Suggested resolution

Each side changes:

- **`packages/shared`:** add `baseline` and `baselineBlock` to `DEPOSIT_SESSION_OPENED`. In `DEPOSIT_CREDITED`, replace `txHash` with `block`.
- **`watcher.ts`:** add `owner` to `DEPOSIT_CREDITED` and `eoa` to `DEPOSIT_SESSION_CLOSED`, since both make replay simpler. It then imports `JournalEvent` instead of its own `DepositEvent`.
