# Shreyas: API and accounting

**Done when:** concurrency and replay tests pass.

You own the logic that makes the system correct. Everything anyone can spend goes through your queue, and the rejection tests that prove it are the heart of the demo.

## You own

- `packages/shared/`: types, EIP-712 definitions, constants
- `services/enclave/src/server.ts`: Fastify routes, body limits, validation, rate limit, CORS, logging
- `queue.ts`: the single serialized queue
- `journal.ts`: append-only, hash-chained event log
- `ledger.ts`: balances, reserve, release, consume
- `auth.ts`: EIP-712 verification, nonces, expiry
- `intents.ts`: intent store and condition checks
- `reconcile.ts` and `GET /health/reconcile`

Read: [api.md](../api.md), [enclave.md](../enclave.md), [data-model.md](../data-model.md), [testing.md](../testing.md).

## Tasks

### Phase 0 (hours 0 to 3)

- [ ] Fastify skeleton that Felix can deploy
- [ ] `packages/shared` with the types from [api.md](../api.md). This unblocks Pradnyesh and Apurva
- [ ] Publish `Ledger`, `Journal` and `SerialQueue` interfaces so Apurva can code against them

### Phase 1 (hours 3 to 12)

Close these first, because they change the types and journal:

- [ ] [Fee model](../decisions/2026-11-06-0151-fee-model.md), with Apurva
- [ ] [Missing EIP-712 types](../decisions/2026-11-06-0151-missing-eip712-types.md), with Pradnyesh
- [ ] [Journal replay events](../decisions/2026-11-06-0151-journal-replay-events.md) and [deposit journal events](../decisions/2026-11-06-0258-deposit-journal-events.md)
- [ ] [Meaning of `pending`](../decisions/2026-11-06-0151-pending-balance.md)
- [ ] [Non-ETH deposits](../decisions/2026-11-06-0151-non-eth-deposits.md), with Apurva

Then build:

- [ ] Queue, then journal, then ledger. Journal before state change, always
- [ ] Auth rules: signer, expiry (at most 5 minutes ahead, 60 seconds of skew), nonce inside the queue, chain and salt
- [ ] `POST /session`, `/deposit-session`, `/balance`, `/withdrawals`
- [ ] Replay the journal on boot
- [ ] `reconcile()`, using on-chain totals from Apurva's inventory

### Phase 2 (hours 12 to 22)

- [ ] `POST /intents`, `/intents/status`, `/intents/cancel`
- [ ] `IntentStore`: reserve on add, `due`, `mark`, expiry frees funds
- [ ] Wire `POST /oracle/price` to Apurva's `Oracle.accept`
- [ ] [Oracle body format](../decisions/2026-11-06-0151-oracle-body-format.md), with Pradnyesh

### Phase 3 (hours 22 to 29)

- [ ] `ledger.property.test.ts`, `auth.test.ts`, `concurrency.test.ts`, `journal.test.ts`
- [ ] Server hardening: body limit, zod on decrypted JSON, per-IP rate limit, CORS, clean logs
- [ ] Demo caps on amounts (`MAX_AMOUNT_NATIVE_WEI`) and a pause switch
- [ ] Make the attack tests runnable live for the demo

### Phase 4 (hours 29 to 36)

- [ ] Support the demo fixture
- [ ] Review the API part of the README

## You depend on

| From | What |
| --- | --- |
| Felix | `envelope.ts` |
| Apurva | On-chain totals for `reconcile()`, `Oracle.accept` |

## Others depend on you

| Who | What |
| --- | --- |
| Pradnyesh | Shared types, endpoints, error codes |
| Apurva | `Ledger`, `Journal`, `SerialQueue`, `IntentStore` |
| Felix | Journal format for the signing guard |
