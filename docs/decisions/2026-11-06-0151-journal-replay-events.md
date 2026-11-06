# Journal replay event completeness

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas | Phase 1 |

## Problem

The initial event set in `docs/enclave.md` lacked events for intent cancellation, intent expiration, deposit session closure, and fee bookings. Without these, replaying the journal from sequence 1 could not accurately reconstruct the in-memory state of the ledger, intent store, or inventory.

## Existing behavior

The discriminated union `JournalEvent` in `packages/shared/src/types/journal.ts` defines 15 canonical event types covering all state transitions.

## Decision

Accept the 15 canonical journal event variants:
1. `NONCE_USED`: Tracks consumption of user wallet nonces.
2. `DEPOSIT_SESSION_OPENED`: Records deposit session initialization, baseline balance, and baseline block.
3. `DEPOSIT_CREDITED`: Records confirmed deposit credit to an owner.
4. `DEPOSIT_SESSION_CLOSED`: Records session expiration and relabels EOA as inventory.
5. `INTENT_CREATED`: Records reservation of `amountIn` and intent submission.
6. `INTENT_CANCELLED`: Records user cancellation and release of reserved funds.
7. `INTENT_EXPIRED`: Records expiration and release of reserved funds.
8. `EXEC_BROADCAST`: Records swap transaction details prior to raw transmission.
9. `EXEC_SETTLED`: Records confirmed swap execution, output credit, and protocol fee booking.
10. `EXEC_FAILED`: Records swap revert and release of input reservation.
11. `WITHDRAWAL_LOCKED`: Records withdrawal reservation under withdrawal ID.
12. `WITHDRAWAL_BROADCAST`: Records withdrawal payout transaction prior to transmission.
13. `WITHDRAWAL_CONFIRMED`: Records confirmed withdrawal payout and consumption of reserved funds.
14. `WITHDRAWAL_FAILED`: Records withdrawal failure and release of reserved funds.
15. `FEE_BOOKED`: Records operational gas spent on-chain by custody EOAs.

Session grants (`SessionGrant`) remain ephemeral in-memory records (valid for at most 30 minutes). They are not journaled; if the enclave restarts, clients simply sign a new `SessionGrant`.

## Alternatives considered

- **Journaling session grants:** Adding `SESSION_GRANTED`. Rejected because session keys expire in 30 minutes, and ephemeral in-memory storage avoids disk bloat. A re-grant from the browser takes only one signature.

## Consequences

- In-memory state can be completely and deterministically reconstructed from the journal.
- Replay tests can assert state equivalence before and after crash restart.
