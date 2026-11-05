# Roadmap

Assumes a 36-hour event and four people. Shift the hour marks if the clock differs.

Each phase ends at a gate. **Do not start the next phase's features until the gate passes.** If a gate slips, cut scope from the next phase, never the rejection tests.

| Phase | Hours | Work | Gate |
| --- | --- | --- | --- |
| 0. Setup | 0 to 3 | Pick TEE and network, scaffold repo, deploy a hello-world enclave with attestation | Quote reachable |
| 1. Core loop | 3 to 12 | Deposit watcher, ledger, signed requests, withdrawal to a normal wallet | 2 users round-trip |
| 2. Execution | 12 to 22 | Intents, price trigger, Uniswap swap from a non-depositor EOA, inventory selection | Swap from other EOA |
| 3. Hardening | 22 to 29 | Replay and double-spend tests, reconcile, Anon-RPC, feature freeze | All attacks rejected |
| 4. Ship | 29 to 36 | Fixtures, README, FEEDBACK.md, demo video, then submit with a buffer | Submitted |

## Tasks per person

The per-person split below is derived from the plan's workstreams.

| Phase | Felix | Shreyas | Apurva | Pradnyesh |
| --- | --- | --- | --- | --- |
| 0 | Choose TEE, deploy hello-world, return a quote from `GET /attestation` | Fastify server skeleton, `packages/shared` types | Decide network, confirm liquidity, collect addresses | Next.js skeleton, wallet connect, check Anon-RPC access |
| 1 | HD derivation, sealed seed, signing guard, HPKE envelope | Queue, journal, ledger, EIP-712 auth, core endpoints | Deposit watcher, inventory, withdrawal execution | Deposit, balance and withdraw pages against the real API |
| 2 | Support executor signing, journal encryption key | Intent store, condition checks, status and cancel | Uniswap swap, price poller, settlement | Swap page |
| 3 | Security checklist on keys and logs, quote verification CLI | Rejection tests, reconcile, concurrency and tamper tests | Recovery on boot, fork tests | Anon-RPC default, TEE-simulated banner |
| 4 | Reproducible image, digest in README, final deploy | Fixture support, API section of README | Seed inventory, demo fixture, integration line links for Uniswap | README, FEEDBACK.md, demo video, submission |

Everyone writes tests for their own part and joins the demo rehearsal.

## Done when

| Person | Done when |
| --- | --- |
| Felix | The quote verifies and a derived EOA signs a test transaction |
| Shreyas | Concurrency and replay tests pass |
| Apurva | A swap and a payout settle from a non-depositor EOA |
| Pradnyesh | The full flow runs from the UI |

## Stretch, only if the phase 3 gate passes

A natural-language box that turns "swap 0.1 ETH to USDC if ETH hits X" into a structured Intent for the user to review and sign. The model never touches keys or the enclave.
