# Withdrawal status endpoint

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Shreyas, Pradnyesh | Phase 1 |

## Problem

`POST /withdrawals` returns only `{ withdrawalId, status: 'locked' }`, and the API has no way to ask for a withdrawal's status later. The `/withdraw` page must show status and the payout transaction link, and a failure after the lock would otherwise be invisible.

## Proposal

Add `POST /withdrawals/status`, a session-signed query like `/intents/status`, returning `{ withdrawals: [{ id, status, txHash? }] }`. Status can be `locked`, `sent`, `confirmed` or `failed`.

## Consequences

`Executor.runWithdrawal` returns an outcome in `finished`, and `WITHDRAWAL_BROADCAST`, `WITHDRAWAL_CONFIRMED` and `WITHDRAWAL_FAILED` are journaled, so the API can build this from what already exists.

A result the executor reports as `unresolved` stays `sent` until recovery settles it.
