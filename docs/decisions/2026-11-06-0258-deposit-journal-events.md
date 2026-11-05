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
