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

- [x] Monorepo workspace package setup (`@cloakroom/shared`, `@cloakroom/enclave`)
- [x] `packages/shared` with types, constants, schemas, and EIP-712 definitions. Unblocks Pradnyesh and Apurva (Task 2)
- [x] Publish `Ledger`, `Journal`, `SerialQueue`, and `IntentStore` interfaces so Apurva can code against them (Task 2)
- [ ] Fastify server implementation with route handlers and envelope decryption

### Phase 1 (hours 3 to 12)

Closed in shared contracts (Task 2):

- [x] [Fee model](../decisions/2026-11-06-0151-fee-model.md), with Apurva
- [x] [Missing EIP-712 types](../decisions/2026-11-06-0151-missing-eip712-types.md), with Pradnyesh
- [x] [Journal replay events](../decisions/2026-11-06-0151-journal-replay-events.md) and [deposit journal events](../decisions/2026-11-06-0258-deposit-journal-events.md)
- [x] [Meaning of `pending`](../decisions/2026-11-06-0151-pending-balance.md)
- [x] [Non-ETH deposits](../decisions/2026-11-06-0151-non-eth-deposits.md), with Apurva
- [x] [Withdrawal status endpoint](../decisions/2026-11-06-0331-withdrawal-status-endpoint.md), with Pradnyesh
- [x] [Journal durability and replay](../decisions/2026-11-06-0745-journal-durability-and-replay.md)
- [x] [Concurrency and queue boundaries](../decisions/2026-11-06-0745-concurrency-and-queue-boundaries.md)

Then build:

- [x] FifoSerialQueue with strict FIFO ordering and error isolation (Task 3)
- [x] Journal, then ledger. Journal before state change, always (Task 4)
- [ ] Auth rules: signer, expiry (at most 5 minutes ahead, 60 seconds of skew), nonce inside the queue, chain and salt
- [ ] `POST /session`, `/deposit-session`, `/balance`, `/withdrawals`
- [ ] In `POST /withdrawals`, reserve under the withdrawal ID and journal `WITHDRAWAL_LOCKED`, then call `Executor.runWithdrawal`
- [ ] [Withdrawal status endpoint](../decisions/2026-11-06-0331-withdrawal-status-endpoint.md), with Pradnyesh
- [ ] Replay the journal on boot
- [ ] Read limits from `loadConfig` in `services/enclave/src/config.ts`, not the duplicates in `packages/shared/src/constants.ts`
- [ ] `reconcile()`, using on-chain totals from Apurva's inventory

### Phase 2 (hours 12 to 22)

- [ ] `POST /intents`, `/intents/status`, `/intents/cancel`
- [ ] `IntentStore`: reserve on add, `due`, `mark`, expiry frees funds
- [ ] Provide `IntentStore.due` for Apurva's price poller

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
| Apurva | On-chain totals for `reconcile()` |

## Others depend on you

| Who | What |
| --- | --- |
| Pradnyesh | Shared types, endpoints, error codes |
| Apurva | `Ledger`, `Journal`, `SerialQueue`, `IntentStore` |
| Felix | Journal format for the signing guard |
