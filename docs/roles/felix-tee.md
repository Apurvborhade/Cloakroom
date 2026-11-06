# Felix: TEE, custody and margin accounting

**Done when:** the quote verifies and a derived EOA signs a test transaction.

You are the first gate. Nothing about the confidentiality claim holds until attestation works, and TEE setup is the biggest schedule risk in the project, so it is time-boxed to hours 0 to 3.

## You own

- TEE platform choice and deployment
- Attestation: `GET /attestation` and the quote verification CLI
- `services/enclave/src/keys.ts`: HD seed, EOA derivation, signing guard
- `services/enclave/src/envelope.ts`: HPKE decryption
- Journal encryption key, derived inside the TEE
- `services/enclave/Dockerfile`, reproducible build, release steps
- Margin ledger, lending balances, position accounting, risk calculations, and reconciliation

Read: [enclave.md](../enclave.md) (Key manager), [deployment.md](../deployment.md), [api.md](../api.md) (Transport).

## Tasks

### Phase 0 (hours 0 to 3)

- [x] Compare TEE platforms and select AWS Nitro Enclaves
- [x] Set up the parent instance, Docker, Nitro CLI and enclave allocator
- [x] Build and run the AWS hello-world enclave without debug mode
- [x] Install persistent parent services and verify automatic non-debug startup after a full host reboot
- [x] Deploy an enclave returning a real quote from `GET /attestation`; verified through an SSH tunnel
- [x] Document the `/attestation` response shape in [api.md](../api.md)
- [x] Package all production dependencies with `pnpm deploy`; Docker self-test and non-debug Nitro quote verified ([deployment](../deployment.md#docker-image))
- [x] Configure public HTTPS ingress; attestation and encrypted browser requests verified against the configured endpoint
- [ ] **If this is failing at hour 3:** switch to the fallback, the same container labelled TEE-simulated, with no confidentiality claim

### Phase 1 (hours 3 to 12)

- [x] `KeyManager`: sealed state, HD derivation, durable `allocate`, `list`, `sign`
- [x] Withdrawal signing guard: refuse anything that does not match a registered, journaled `opId`, and sign each opId once. Implement `TransactionSigner` from `services/enclave/src/executor.ts`
- [x] `envelope.ts` and shared browser sealing; Chromium-to-enclave transport tested with concurrent contexts
- [x] Report data commits to `sha256(enclavePubKey || buildHash)`
- [x] Bind attestation and decryption to the same sealed identity; see [key lifetime](../api.md#attestation-response-nitro-phase-0)
- [x] Implement [the admin EOAs endpoint](../api.md#admin-seeding-contract); authenticated encrypted response, durable one-time disclosure, disabled in the application configuration

### Phase 2 (hours 12 to 22)

- [x] Executor signing against the real guard: native and ERC-20 payouts tested on Anvil from unlinked HD accounts
- [x] Journal cipher derived from the custody seed; simulation wrapping keys require explicit `SIM_MODE`

### Phase 3 (hours 22 to 29)

- [x] Quote verification CLI script: AWS trust chain, COSE signature, nonce, timestamp, PCRs and key/build binding
- [x] `keys.test.ts` and `envelope.test.ts` ([testing.md](../testing.md))
- [x] Audit TEE modules and bootstrap: no key/seed endpoint, redacted failures, no custody address logging; dependency audit and API body bounds checked. Repeat when the application server is mounted

### Phase 4 (hours 29 to 36)

- [x] Publish verified application release metadata through the deployment handoff
- [x] Build application images with the private API and persistent custody; image self-tests passed
- [x] Authorize the application measurements in KMS, deploy and verify recovery before funding; identity and API nonces survive enclave, storage and config-service restarts
- [ ] Connect the hosted frontend to the public API and configure its browser origin

## You depend on

| From | What |
| --- | --- |
| Shreyas | `server.ts` to wire decryption into, journal format for the journaled-op check |
| Apurva | How `opId` registration is called from the executor |
| Apurva | Margin API commands, fresh risk prices, physical inventory, and confirmed execution outcomes |

## Others depend on you

| Who | What |
| --- | --- |
| Everyone | Attestation shape and a reachable enclave |
| Apurva | `KeyManager` |
| Apurva | Margin state types and accounting methods to prepare, settle, fail, and recover operations |
| Shreyas | `envelope.ts` |
| Pradnyesh | HPKE parameters and verified deployment configuration |

## Verify

- [x] TEE provider access and non-debug enclave startup
- [x] Provider pricing checked
- [x] Attestation format, retrieval through NSM, and independent verification
- [x] KMS recipient adapter, in-enclave TLS and external ciphertext CAS store; demo IAM/KMS provisioned and host calls without recipient attestation refused
- [x] Live Nitro/KMS recovery: identity, allocations, cached signatures, journal and balances survive enclave and storage-service restarts; seeding stays disabled. External rollback checkpoint remains open

## Swap integration

The signer enforces journaled limit swaps and the minimum credited after fees; see [the custody handoff](../enclave.md#custody-implementation-handoff). Executor integration is covered on Anvil with the real `KeyManager`. [In-enclave HTTPS](../../infra/nitro/README.md#uniswap-egress) is verified with an authenticated Uniswap quote and Sepolia RPC reads; the Sepolia smoke test with the real signer remains open.

## Margin accounting

**Done when:** lending claims, collateral, debt, fees, and the trader's remaining equity reconcile after opening, manual closure, liquidation, and restart. [Apurva](apurva-onchain.md#margin-backend-and-execution) owns the margin API and all on-chain execution; Felix owns private accounting and the rules that authorize changes to it.

The MVP uses one chain, ETH/WETH and USDC, USDC collateral, isolated positions, and a configurable leverage cap up to 4x. Keep state inside the TEE and reuse the existing queue, journal, and custody. Uniswap transactions remain public; confidential accounting does not guarantee anonymity.

- [ ] Define position records and separate free balances, opted-in lending claims, outstanding loans, locked collateral, and position assets. Physical pool inventory is not automatically available for lending.
- [ ] Implement supply and redemption accounting. Require explicit lending authorization; reject redemption when insufficient unborrowed liquidity is available.
- [ ] Implement reservations and settlement for long/short opening, adding collateral, full manual closure, and full liquidation. Borrow USDC for longs and ETH for shorts; keep purchased ETH or short-sale proceeds locked.
- [ ] Calculate equity, profit/loss, accrued interest, initial and maintenance margin, and estimated liquidation price using fresh price reports from Apurva. Reject new risk with stale prices, inadequate collateral, or insufficient lending liquidity.
- [ ] Serialize accounting transitions to prevent replay, double lending, spending locked funds, and competing manual-close/liquidation operations.
- [ ] Repay the correct lending asset, book costs, and credit the trader's remainder on confirmed settlement. Preserve debt on failed execution and record any shortfall explicitly under the agreed loss-allocation rules.
- [ ] Extend journal events, deterministic replay, and reconciliation for margin accounting. Keep unresolved operations reserved until transaction recovery determines their result.
- [ ] Test accounting invariants, failed execution, concurrent requests, liquidation settlement, and restart recovery. Review Apurva's margin-specific signing policy against authorized accounting operations.

Primary ownership: margin changes to `ledger.ts`, `journal.ts`, `queue.ts`, `reconcile.ts`, and new position/accounting modules under `services/enclave/src/`. Define shared accounting types with Apurva in `packages/shared/`; retain internal `bigint` arithmetic and decimal strings on the wire.

### Margin handoff

Agree position states, operation types, interest and fees, initial/maintenance margin, price freshness, and shortfall allocation with Apurva first. Freeze the interface and provide a mock so both workstreams can proceed in parallel.

1. Apurva verifies the signed API request, or submits a liquidation candidate with a fresh price report.
2. Felix's accounting service validates the operation, reserves funds, and journals an approved operation with a unique `opId`.
3. Apurva executes it and returns the confirmed result, definite failure, or unresolved status.
4. Felix's accounting service applies the result once. Only this service mutates margin balances and debt.

No stop-loss, take-profit, partial closes, position increases, collateral removal, cross-margin, automated strategies, internal matching, or withdrawal queues in this MVP. Existing session keys remain read-only. Existing conditional spot swaps are outside this change.
