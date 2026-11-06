# Meaning of pending balance

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas | Phase 1 |

## Problem

The API wire schema for `Balance` defines three fields: `available`, `reserved`, and `pending`. Furthermore, `docs/data-model.md` invariant 1 initially counted "pending withdrawals" alongside balances, but the internal `Ledger` interface only models `available` and `reserved`.

## Existing behavior

The in-memory `Ledger` implementation only tracks `available` and `reserved` mappings per owner and token. The deposit watcher tracks unconfirmed block balances independently.

## Decision

1. **`pending` balance is display-only:** `pending` represents deposits detected by `DepositWatcher` that have not yet reached `CONFIRMATIONS` depth. It is an advisory value queried from the watcher and returned in `POST /balance` for UI feedback. It is NEVER credited to the ledger's `available` balance and cannot be spent or withdrawn.
2. **Withdrawals are tracked in `reserved`:** When a withdrawal is requested, funds transition immediately from `available` to `reserved` under the withdrawal ID. There is no separate "pending withdrawal" bucket in the ledger.
3. **Ledger state:** Only `available` and `reserved` exist in the core ledger. Both must always be non-negative ($\ge 0$).
4. **Invariant 1 definition:**
   $$\text{PhysicalBalance}(T) - \text{GasReserve}(T) \ge \sum_u (\text{available}(u, T) + \text{reserved}(u, T)) + \text{ProtocolFeeBalance}(T)$$
   `pending` deposits do not count toward claims because their on-chain funds are also not yet finalized.

## Alternatives considered

- **First-class `pending` in the ledger:** Tracking pending balances inside `Ledger`. Rejected because unconfirmed blocks can reorg. Keeping unconfirmed funds outside the ledger avoids speculative rollbacks.

## Consequences

- Clean separation between finalized ledger claims and ephemeral watcher observations.
- Reconcile math is exact and immune to unconfirmed chain state.
