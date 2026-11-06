# Data model and accounting invariants

Every asset the pool holds must be explainable as a claim, per token. The ledger lives only inside the enclave; nothing here is public.

## Entities

| Entity | Key fields | States | Description |
| --- | --- | --- | --- |
| Owner | wallet address, last nonce | active | User who signs EIP-712 messages. |
| Balance | owner, token, available, reserved | one record per owner and token | Spendable (`available`) and locked (`reserved`) internal credits. |
| DepositSession | session ID, assigned deposit EOA, owner, expiry, baseline, baselineBlock | open, credited, expired | Single-user assigned EOA watching incoming native ETH deposits. |
| CustodyEOA | index, address, role, lastUsedAt, inFlight | deposit, inventory | Enclave-managed EOA for deposits or pooled inventory. |
| Intent | owner, tokenIn, tokenOut, amountIn, comparator, triggerPrice, maxSlippageBps, nonce, expiry | pending, executing, done, failed, cancelled, expired | Conditional swap instruction with reserved input. |
| Withdrawal | id, owner, token, amount, to, nonce, expiry | locked, sent, confirmed, failed | User withdrawal claim reserved under withdrawal ID. |
| Journal entry | sequence, timestamp, prevHash, event, entryHash | append-only | Durably encrypted, hash-chained log entry on disk. |

## Balance semantics

- **Available balance (`available`):** Spendable funds held by the owner. Can be used to create intents or request withdrawals.
- **Reserved balance (`reserved`):** Funds locked for active intents or pending withdrawals. Reserved funds cannot be spent or withdrawn simultaneously.
- **Pending balance (`pending`):** Advisory display-only metric from `DepositWatcher` indicating deposits observed on-chain before reaching finality (`CONFIRMATIONS` depth). Never credited to `available` and cannot be spent.
- **Physical on-chain balance:** Actual balance held across all custody EOAs (deposit + inventory).
- **Gas reserve (`GAS_RESERVE_WEI`):** Native ETH kept by inventory EOAs strictly for transaction gas; excluded from user claims.

## Invariants

Enforce these in code and assert them in tests:

1. **Solvency invariant:** For every supported token $T$:
   $$\text{PhysicalBalance}(T) - \text{GasReserve}(T) \ge \sum_{\text{all owners } u} (\text{available}(u, T) + \text{reserved}(u, T)) + \text{ProtocolFeeBalance}(T)$$
   Where:
   - $\text{GasReserve}(NATIVE) = \sum_{e \in \text{inventory EOAs}} \text{GAS\_RESERVE\_WEI}$.
   - $\text{GasReserve}(ERC20) = 0$.
   - Physical balances include all deposit EOAs and inventory EOAs.
2. **Token isolation:** A surplus in one token never covers a shortfall in another.
3. **Non-negativity:** Available and reserved balances are never negative ($\ge 0$). Funds must be reserved prior to intent execution or withdrawal broadcast.
4. **Replay & double-credit prevention:** Each owner nonce is strictly monotonic and consumed once. Each on-chain deposit increase is credited once against the session's recorded baseline.
5. **Single execution:** Every broadcast transaction maps to exactly one intent or withdrawal, and its hash and raw payload are journaled before broadcast so a restart cannot execute it twice.

## State transition table

| Operation | Trigger | Journal event | Available | Reserved | Physical balance |
| --- | --- | --- | --- | --- | --- |
| Deposit credit | Watcher confirmed block | `DEPOSIT_CREDITED` | $+A$ | $0$ | Already $+A$ on deposit EOA |
| Intent create | User signs `Intent` | `INTENT_CREATED` | $-A$ | $+A$ | Unchanged |
| Intent cancel | User signs `CancelIntent` | `INTENT_CANCELLED` | $+A$ | $-A$ | Unchanged |
| Intent expire | Expired during tick | `INTENT_EXPIRED` | $+A$ | $-A$ | Unchanged |
| Swap success | Swap confirmed on chain | `EXEC_SETTLED`, `FEE_BOOKED` | $+(\text{out} - \text{fee})$ | $-A$ | $-\text{in}$ on EOA, $+\text{out}$ on EOA |
| Swap revert | Swap reverted on chain | `EXEC_FAILED`, `FEE_BOOKED` | $+A$ | $-A$ | Unchanged (gas booked separately) |
| Withdrawal lock | User signs `Withdrawal` | `WITHDRAWAL_LOCKED` | $-A$ | $+A$ | Unchanged |
| Withdrawal confirm | Transfer confirmed | `WITHDRAWAL_CONFIRMED`, `FEE_BOOKED` | $0$ | $-A$ | $-A$ on inventory EOA |
| Withdrawal fail | Transfer reverted | `WITHDRAWAL_FAILED`, `FEE_BOOKED` | $+A$ | $-A$ | Unchanged |

## Fees

- **Protocol fee:** Deducted in basis points (`FEE_BPS`) from the output token (`tokenOut`) upon confirmed swap execution. Credited to the protocol revenue balance.
- **Gas expenditure:** Native ETH spent on-chain (`gasUsed * effectiveGasPrice`) is booked via `FEE_BOOKED` to a dedicated operational fee ledger. It is not charged to users.

## Reservation Lifecycle and Reference Semantics

Reservations represent locked claims (`reserved`) moved out of an owner's spendable balance (`available`):
- **Lifecycle states:**
  - `active`: Funds are locked under a unique reference (e.g., intent ID or withdrawal ID).
  - `released`: The reservation was aborted or cancelled; funds are restored to the owner's `available` balance.
  - `consumed`: The reservation was fulfilled (e.g., confirmed swap or confirmed payout); funds permanently leave the user's claim without restoring `available`.
- **Reference rules:**
  - Reservation references must be unique and cannot be overwritten.
  - Consumed reservations cannot be released.
  - Released reservations cannot be consumed.
  - Repeated release or consume operations on completed reservations are idempotent and do not alter balances.
  - Credit references (e.g., `deposit:<sessionId>:<blockNumber>`) are tracked to prevent double-crediting.

## Concurrency

All state-mutating operations and journal appends are serialized through `FifoSerialQueue`. External network RPCs and encryption operations occur outside the queue.
