# Withdrawal status endpoint

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas, Pradnyesh | Phase 1 |

## Problem

`POST /withdrawals` returns an immediate response `{ withdrawalId, status: 'locked' }`. Once the API returns, the client has no way to poll or query the eventual execution outcome (whether the payout was broadcast, confirmed with an on-chain transaction hash, or failed). The frontend `/withdraw` page requires the transaction link for user confirmation.

## Existing behavior

No status endpoint existed for withdrawals. Only `POST /intents/status` was specified.

## Decision

Add `POST /withdrawals/status`:
1. **Request:** Envelope containing `SignedRequest<SessionQueryWire>` signed by the session key.
2. **Response:**
   ```ts
   {
     withdrawals: Array<{
       id: string;
       status: 'locked' | 'sent' | 'confirmed' | 'failed';
       txHash?: Hex;
       reason?: string;
     }>
   }
   ```
3. **Data Source:** Built from the in-memory withdrawal tracking map populated by `WITHDRAWAL_LOCKED`, `WITHDRAWAL_BROADCAST`, `WITHDRAWAL_CONFIRMED`, and `WITHDRAWAL_FAILED` events.
4. **Wire Schemas:** Added `WithdrawalStatusItemSchema` and `WithdrawalStatusResponseSchema` to `packages/shared/src/schemas/api.ts`.
5. **Unresolved State:** If the executor returns `unresolved`, the status is reported to the client as `'sent'` until recovery settles the transaction receipt.

## Consequences

- Frontend can poll `/withdrawals/status` using the active session key without requiring wallet popups.
- Full visibility of the withdrawal lifecycle for the user.
