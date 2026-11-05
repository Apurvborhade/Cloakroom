# Meaning of pending

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Shreyas | Phase 1 |

## Problem

`Balance` has `pending` and invariant 1 counts pending withdrawals, but `Ledger` only tracks available and reserved.

## Proposal

`pending` means deposits seen but not yet confirmed, and is display only. Locked withdrawals stay in `reserved`.
