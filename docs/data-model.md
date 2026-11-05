# Data model and accounting invariants

Every asset the pool holds must be explainable as a claim, per token. The ledger lives only inside the enclave; nothing here is public.

## Entities

| Entity | Key fields | States |
| --- | --- | --- |
| Owner | wallet address, last nonce | active |
| Balance | owner, token, available, reserved | one row per owner and token |
| DepositSession | session ID, assigned deposit EOA, owner, expiry | open, credited, expired |
| CustodyEOA | index, address, role, last used | deposit, inventory |
| Intent | owner, tokenIn, tokenOut, amountIn, price condition, max slippage, expiry | pending, executing, done, failed, cancelled, expired |
| Withdrawal | owner, token, amount, destination, tx hash | locked, sent, confirmed, failed |
| Journal entry | sequence number, event, previous hash | append-only |

## Invariants

Enforce these in code and assert them in tests.

1. Per token, on-chain balances across all custody EOAs (minus a gas reserve) are at least the sum of every owner's available, reserved and pending-withdrawal amounts.
2. A surplus in one token never covers a shortfall in another.
3. Available and reserved are never negative. Funds are reserved before an intent or withdrawal can proceed.
4. Each owner nonce is used once. Each on-chain deposit is credited once.
5. Every broadcast transaction maps to exactly one intent or withdrawal, and its hash is journaled before broadcast so a restart cannot execute it twice.

## Fees

Gas spent by custody EOAs is booked against a separate fee ledger so invariant 1 still holds. The fee charge itself is unresolved: see [decisions.md](decisions.md) gap 3.1.

## Concurrency

One serialized queue handles every ledger mutation. It is the simplest defence against double spends, and fast enough for a demo.
