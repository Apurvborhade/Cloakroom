# Journal cannot replay every state

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Shreyas | Phase 1 |

## Problem

`JournalEvent` has nothing for intent cancelled or expired, deposit session closed or EOA relabelled, session grants, or fee bookings, yet state must be rebuildable by replay.

## Proposal

Add `INTENT_CANCELLED`, `INTENT_EXPIRED`, `DEPOSIT_SESSION_CLOSED` and `FEE_BOOKED`. Decide whether session grants survive a restart.

The shape of `DEPOSIT_SESSION_CLOSED` is in [deposit journal events](2026-11-06-0258-deposit-journal-events.md).
