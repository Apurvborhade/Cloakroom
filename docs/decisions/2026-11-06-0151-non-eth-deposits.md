# Non-ETH deposits

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Shreyas, Apurva | Phase 1 |

## Problem

`DepositRequest` has an `asset` field, but the watcher only tracks native balance.

## Proposal

Reject any `asset` other than `NATIVE` in v1.
