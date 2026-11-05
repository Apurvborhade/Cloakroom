# Roles

| Person | Workstream | Plan role | Brief |
| --- | --- | --- | --- |
| Felix | TEE and custody | A | [felix-tee.md](felix-tee.md) |
| Shreyas | API and accounting | B | [shreyas-api.md](shreyas-api.md) |
| Apurva | On-chain and execution | C | [apurva-onchain.md](apurva-onchain.md) |
| Pradnyesh | Frontend and web3 integrations | D | [pradnyesh-frontend.md](pradnyesh-frontend.md) |

## Ownership

| Area | Path | Owner | Reviews changes |
| --- | --- | --- | --- |
| Attestation, HPKE transport | `services/enclave/src/envelope.ts` | Felix | Pradnyesh |
| Keys, signing guard | `services/enclave/src/keys.ts` | Felix | Apurva |
| Image, deploy, release | `services/enclave/Dockerfile` | Felix | |
| Routes, hardening | `services/enclave/src/server.ts` | Shreyas | Felix |
| Queue, ledger, journal | `queue.ts`, `ledger.ts`, `journal.ts` | Shreyas | Apurva |
| EIP-712 verification, nonces | `services/enclave/src/auth.ts` | Shreyas | Pradnyesh |
| Intent store | `services/enclave/src/intents.ts` | Shreyas | Apurva |
| Invariant check | `services/enclave/src/reconcile.ts` | Shreyas | Apurva |
| Shared types, EIP-712 definitions | `packages/shared/` | Shreyas | Pradnyesh, Apurva |
| Deposit watcher | `services/enclave/src/watcher.ts` | Apurva | Shreyas |
| Inventory, EOA selection | `services/enclave/src/inventory.ts` | Apurva | Felix |
| Swap, payout, recovery | `services/enclave/src/executor.ts` | Apurva | Felix, Shreyas |
| Price poller | `services/enclave/src/price-poller.ts` | Apurva | Shreyas |
| Contracts | `contracts/` | Apurva | |
| Seeding, demo fixture | `scripts/` | Apurva | Felix |
| Next.js app, Anon-RPC | `apps/web/` | Pradnyesh | Shreyas |
| README, FEEDBACK.md, demo video | root | Pradnyesh | Everyone |

`server.ts`, `queue.ts` and `reconcile.ts` had no owner in the spec and were assigned here. The review column is a suggestion. Change anything that does not fit.

## Handoffs

These are where one person's work blocks another's. Agree the interface first, then work in parallel against a stub.

| From | To | What | Needed by |
| --- | --- | --- | --- |
| Felix | Everyone | `GET /attestation` shape and the enclave key | Phase 0 |
| Shreyas | Pradnyesh, Apurva | `packages/shared` types | Phase 0 |
| Felix | Apurva | `KeyManager`: `allocate`, `sign`, opId registration | Phase 1 |
| Felix | Shreyas | `envelope.ts` decrypt, wired into `server.ts` | Phase 1 |
| Felix | Pradnyesh | HPKE library and parameters that work in the browser | Phase 1 |
| Shreyas | Apurva | `Ledger`, `Journal` and `SerialQueue` interfaces | Phase 1 |
| Apurva | Shreyas | On-chain totals from `Inventory` for `reconcile()` | Phase 1 |
| Shreyas | Pradnyesh | Live or stubbed endpoints, error codes | Phase 1 |
| Shreyas | Apurva | `IntentStore.due`, `mark` | Phase 2 |
| Apurva | Pradnyesh | Uniswap integration line links and notes for `FEEDBACK.md` and the README | Phase 4 |
| Felix | Apurva | One-time admin EOA list for seeding | Phase 4 |
| Felix | Pradnyesh | Final enclave URL and image digest | Phase 4 |

## Working agreements

- Keep commits small and steady. The prizes want a visible history through the event.
- Any change to `packages/shared` is announced to the team, because the browser and the enclave must sign and verify the same bytes.
- Never log addresses, amounts or intent fields, and never commit secrets.
- If a gate slips, cut scope from the next phase, never the rejection tests.
