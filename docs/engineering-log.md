# Cloakroom Engineering Log

This document is the canonical, chronological record of all backend and accounting engineering work performed on Cloakroom.

---

## Task 1: Workspace Package Configuration and Manifests

- **Date:** 2026-11-05
- **Task Number & Title:** Task 1 — Initialize Workspace Package Configuration and Manifests
- **Status:** Committed (commit `9b084300482a7b2f3f23b44024fca9acfcc1784d`)
- **Objective:** Configure the pnpm monorepo so that `@cloakroom/shared` and `@cloakroom/enclave` function as valid ESM workspace packages under TypeScript strict mode.

### Files Created
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `services/enclave/package.json`
- `services/enclave/tsconfig.json`

### Files Modified
- `package.json`
- `pnpm-lock.yaml`

### Dependencies Added or Changed
- Root `devDependencies`:
  - `@types/node` (v20.19.43)
  - `fast-check` (v3.23.2)
  - `typescript` (v5.9.3)
  - `vitest` (v3.2.7)
- `@cloakroom/shared` `dependencies`:
  - `viem` (v2.57.16)
  - `zod` (v3.25.76)
- `@cloakroom/enclave` `dependencies`:
  - `@cloakroom/shared` (`workspace:*`)
  - `@fastify/cors` (v10.1.0)
  - `@fastify/rate-limit` (v10.3.0)
  - `fastify` (v5.12.8)
  - `viem` (v2.57.16)
  - `zod` (v3.25.76)

### Implementation Details
- Configured ESM module behavior (`"type": "module"`) across all packages.
- Wired TypeScript project references extending `tsconfig.base.json` (`ES2022`, `NodeNext`, `strict: true`).
- Configured monorepo scripts for typechecking and building.

### Architectural Decisions
- Fastify and server plugins are strictly scoped to `@cloakroom/enclave` to ensure `@cloakroom/shared` remains pure and consumable by browser runtimes (Next.js) without bundling node-specific server packages.
- NodeNext module resolution selected to match native Node.js 20+ ESM execution.

### Tests Added
- None in this task (skeleton initialization).

### Exact Verification Commands & Results
- `pnpm install`: Exited with code 0. Resolved 124 packages.
- `pnpm ls -r`: Successfully discovered `cloakroom@0.0.0`, `@cloakroom/shared@0.0.0`, and `@cloakroom/enclave@0.0.0` with workspace link.
- `pnpm typecheck`: Returned `TS18003: No inputs were found in config file` as expected because no application source files existed at this stage.
- `pnpm test`: Exited with code 1 (`No test files found`) as expected.

### Known Limitations & Unresolved Questions
- Source files and tests were pending Task 2 implementation.

### Integration Handoffs
- Monorepo package manifests established for Felix, Apurva, and Pradnyesh.

### Commit Reference
- **Commit:** `9b084300482a7b2f3f23b44024fca9acfcc1784d`
- **Commit Message:** `chore(workspace): initialize pnpm monorepo packages`

---

## Task 2: Shared Contracts & Engineering Documentation

- **Date:** 2026-11-06
- **Task Number & Title:** Task 2 — Implement Shared Contracts, Zod Schemas, and Engineering Documentation
- **Status:** Committed & Pushed (commit `ea8b807b539c381c81ef80a52df2f0269f8c679e`)
- **Objective:** Build the `@cloakroom/shared` package, establish types, models, journal events, interfaces, Zod schemas, test suites, engineering documentation, development conventions, and team handoffs.

### Files Created
- `packages/shared/src/constants.ts`
- `packages/shared/src/eip712.ts`
- `packages/shared/src/types/models.ts`
- `packages/shared/src/types/journal.ts`
- `packages/shared/src/types/interfaces.ts`
- `packages/shared/src/types/oracle.ts`
- `packages/shared/src/schemas/common.ts`
- `packages/shared/src/schemas/envelope.ts`
- `packages/shared/src/schemas/api.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/schemas.test.ts`
- `packages/shared/test/eip712.test.ts`
- `services/enclave/src/index.ts` (minimal placeholder export)
- `docs/development-conventions.md`
- `docs/engineering-log.md`
- `.github/pull_request_template.md`

### Files Modified
- `packages/shared/package.json` (added `"test": "vitest run"` script)
- `docs/roles/shreyas-api.md` (updated progress and Phase 0/1 checklists)
- `docs/README.md` (linked engineering log and documented team handoffs)

### Dependencies Added or Changed
- None (utilized existing dependencies installed in Task 1).

### Implementation Details
- **Constants:** Defined `NATIVE` address (`0x000...000`), `BPS_DENOMINATOR` (10,000), `PRICE_PRECISION` (1e18), `MAX_BODY_SIZE_BYTES` (16 KB), `MAX_EXPIRY_FUTURE_SEC` (300s), `MAX_CLOCK_SKEW_SEC` (60s), `SESSION_GRANT_TTL_SEC` (1800s), and `ERROR_CODES`.
- **EIP-712:** Implemented typed data structures for `SessionGrant`, `SessionQuery`, `DepositRequest`, `Intent`, `CancelIntent`, and `Withdrawal`. Implemented `deriveEnclaveSalt(enclavePubKey)` using `keccak256`. SessionQuery explicitly omits an owner nonce to prevent collision with wallet transactions.
- **Models:** Defined internal state entities (`BalanceRecord`, `OwnerBalances`, `StoredIntent`, `CustodyEOA`, `LockedWithdrawal`, `PriceReport`, `ReconcileResult`) utilizing native `bigint` for amounts.
- **Journal:** Defined discriminated `JournalEvent` union encompassing 15 events including `INTENT_CANCELLED`, `INTENT_EXPIRED`, `DEPOSIT_SESSION_CLOSED`, and `FEE_BOOKED`. Defined `JournalEntry` structure with sequence, timestamp, previous hash, event payload, and entry hash.
- **Interfaces:** Defined contracts for `SerialQueue`, `Journal`, `Ledger`, `IntentStore`, `InventoryReader`, and `OracleVerifier`.
- **Zod Schemas:** Defined validation schemas for envelopes, wire-formatted requests, and responses. Enforced decimal integer string validation for all amounts and nonces. Enforced rejection of non-native deposit assets in v1. Added wire-to-bigint conversion helpers.
- **Enclave Placeholder:** Added a minimal `export {};` in `services/enclave/src/index.ts` to satisfy TypeScript inputs without implementing any server, queue, journal, or ledger logic.

### Architectural Decisions
- Wire format strictly enforces decimal strings for all 256-bit and 64-bit integers to prevent JavaScript IEEE 754 precision truncation during serialization.
- Fixed-point trigger prices are scaled to 1e18 precision so token decimal differences never contaminate price comparisons.
- `/oracle/price` is explicitly defined as a plain JSON payload authenticated via HMAC header, rather than an HPKE envelope, to accommodate Chainlink CRE execution constraints.
- Session queries use an expiry timestamp window rather than monotonic nonces to prevent race conditions with wallet-signed operations.

### Tests Added
- `packages/shared/test/schemas.test.ts`: 21 unit tests validating envelope parsing, deposit asset restriction, intent comparators, slippage bounds, cancellation format, withdrawal destination, price report parsing, response validation, and wire-to-bigint converters.
- `packages/shared/test/eip712.test.ts`: 7 unit tests validating salt derivation, domain construction, and typed data hashing via viem's `hashTypedData` across all defined messages.

### Exact Verification Commands & Results
- `pnpm install --frozen-lockfile`: Exited with code 0 (lockfile up to date).
- `pnpm --filter @cloakroom/shared typecheck`: Exited with code 0 (0 errors).
- `pnpm --filter @cloakroom/shared build`: Exited with code 0 (compiled declaration and js files to `dist/`).
- `pnpm --filter @cloakroom/shared test`: Exited with code 0 (28 passed in 2 test files).
- `pnpm typecheck`: Exited with code 0 (both `@cloakroom/shared` and `@cloakroom/enclave` passed).
- `pnpm test`: Exited with code 0 (28 passed across monorepo).

### Known Limitations & Unresolved Questions
- Fee Model (Gap 3.1): Deducting `FEE_BPS` from output upon swap settlement requires final confirmation from Apurva.
- EOA Relabeling Timing: Relabeling assigned deposit EOAs to inventory on session close requires final coordination with Apurva's watcher logic.
- Session Key Persistence across restarts: Currently held ephemerally in memory; requires confirmation if persistent storage across reboots is expected.

### Integration Handoffs
- **Felix:** Provided `Envelope` type, `deriveEnclaveSalt`, `JournalEvent` definitions, and `createDomain`.
- **Apurva:** Provided `Ledger`, `Journal`, `SerialQueue`, `IntentStore`, `InventoryReader`, and `OracleVerifier` interfaces.
- **Pradnyesh:** Provided `@cloakroom/shared` import path, `EIP712_TYPES`, wire request/response schemas, decimal string wire types, and error codes.

### Commit Reference
- **Commit:** `ea8b807b539c381c81ef80a52df2f0269f8c679e`
- **Commit Message:** `feat(shared): implement protocol types, schemas, and team contracts`
- **Pushed to Remote:** `origin/main` (clean fast-forward push)

---

## Task A1: Custody Inventory

- **Date:** 2026-11-06
- **Task Number & Title:** Task A1 (Apurva's workstream) — Custody Inventory and EOA Selection
- **Status:** Committed on branch `feat/inventory`. Not pushed by this entry.
- **Objective:** Track what each custody EOA holds on-chain, and choose which EOA runs an operation, so an owner's swap or payout never comes from an address linked to them.

### Files Created
- `services/enclave/src/inventory.ts`
- `services/enclave/test/inventory.test.ts`

### Files Modified
- `package.json` (`test`, `test:watch` and `typecheck` now build `@cloakroom/shared` first)
- `docs/enclave.md`
- `docs/decisions/2026-11-06-0258-deposit-journal-events.md`
- `docs/roles/apurva-onchain.md`

### Dependencies Added or Changed
- None.

### Implementation Details
- `refresh` reads every balance at one block, and ignores a result older than the one already applied.
- `pick` chooses the least recently used inventory EOA that can cover the amount, skipping excluded and busy EOAs.
- `hold` and `free` allow one operation per EOA at a time.
- `getPhysicalBalances` implements `InventoryReader`. It counts deposit EOAs in full and leaves out inventory gas reserves.
- `replay` rebuilds EOA roles and owner links from `JournalEvent`.

### Architectural Decisions
- `pick` also requires the gas reserve for ERC-20 sends, which the spec's sketch does not, because the EOA still pays gas.
- Owner links live in `Inventory`, through `linkOwner` and `eoasLinkedTo`, because the spec's `exclude` set needs a source.
- After an operation confirms, callers must run `refresh` and then `free`, so spent funds never look available.

### Tests Added
- `services/enclave/test/inventory.test.ts`: 32 tests against a local Anvil chain, including one with the real `DepositWatcher`.
- Eight deliberate bugs were introduced to check the tests, and each one made a test fail.

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (75 passed in 4 test files).
- `pnpm typecheck`: Exited with code 0.

### Known Limitations & Unresolved Questions
- Not run on Sepolia, and not yet connected to a real `KeyManager`.
- `watcher.ts` cannot use the real `Journal` until the deposit event conflict is resolved: see `docs/decisions/2026-11-06-0258-deposit-journal-events.md`.
- Holds are not rebuilt on boot. `Executor.recover` will need to do this for unfinished operations.
- A relabelled deposit EOA has its gas reserve taken out of reconcile totals, so operator-seeded funds must cover that gap.
- `anvil_setBalance` also rewrites the latest block's stored state, so tests of historical reads must use real transactions.
- The earlier deposit watcher work was merged before this log's conventions were adopted, and has no entry here.

### Integration Handoffs
- **Shreyas:** `Inventory` implements `InventoryReader` for `reconcile()`. The deposit journal event conflict needs resolving with Apurva.
- **Felix:** `Inventory` needs `list()` from `KeyManager`, returning `CustodyEOA[]`.

### Commit Reference
- **Commits:** `2a96f3deffd9f5e7c1e3975866aeacc2e284d6dd` (`feat(enclave): add custody inventory and EOA selection`), `355717875a44e39e4e6859d45063805acff743a0` (`test(enclave): cover inventory against a local Anvil chain`)
- **Pushed to Remote:** No

---

## Task A2: Withdrawal Execution

- **Date:** 2026-11-06
- **Task Number & Title:** Task A2 (Apurva's workstream) — Withdrawal Execution
- **Status:** Committed on branch `feat/withdrawal`, which is stacked on `feat/inventory`. Not pushed by this entry.
- **Objective:** Pay out a locked withdrawal from an EOA not linked to the owner, and settle or release the funds according to what happens on-chain.

### Files Created
- `services/enclave/src/executor.ts`
- `services/enclave/test/executor-withdrawal.test.ts`
- `services/enclave/test/fixtures/test-token.sol`
- `services/enclave/test/fixtures/test-token.ts`
- `docs/decisions/2026-11-06-0331-withdrawal-status-endpoint.md`

### Files Modified
- `docs/enclave.md`
- `docs/chain-logic.md`
- `docs/decisions/README.md`
- `docs/roles/apurva-onchain.md`
- `docs/roles/shreyas-api.md`
- `docs/roles/felix-tee.md`
- `docs/roles/pradnyesh-frontend.md`

### Dependencies Added or Changed
- None.

### Implementation Details
- `runWithdrawal` refreshes inventory, picks and holds an EOA, and resolves with a `finished` promise. It rejects with `NO_INVENTORY` after releasing the lock if no EOA can pay.
- Execution registers the operation with the signing guard, signs, journals `WITHDRAWAL_BROADCAST`, sends, waits for `CONFIRMATIONS` blocks, then settles.
- A success journals `WITHDRAWAL_CONFIRMED`, consumes the funds and books the gas. A revert journals `WITHDRAWAL_FAILED`, releases the funds and books the gas.

### Architectural Decisions
- After a broadcast, only a confirmed revert releases funds. An unknown result returns `unresolved`, keeping the funds reserved and the EOA busy, because the transaction may still land.
- A send error does not fail the operation, because a send can fail after the node accepted it. Only the receipt decides.
- `runWithdrawal` resolves before confirmation, so `POST /withdrawals` can answer quickly and still report `NO_INVENTORY`.
- The lock is taken by the API before calling the executor, matching the spec's `LockedWithdrawal` parameter.

### Tests Added
- `services/enclave/test/executor-withdrawal.test.ts`: 23 tests sending real signed transactions on a local Anvil chain, with a stand-in signer that enforces the signing guard rules.
- Eighteen deliberate bugs were introduced to check the tests, and each one made a test fail.

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (98 passed in 5 test files).
- `pnpm typecheck`: Exited with code 0.

### Known Limitations & Unresolved Questions
- Not run on Sepolia, and not yet connected to a real `KeyManager`, `Ledger` or `Journal`.
- `Executor.recover` is not built, so an `unresolved` withdrawal stays reserved until it exists. A restart also does not restore the local nonce counter or holds.
- No fee is charged on withdrawals. This depends on the open fee model decision.
- `FEE_BOOKED` records gas spent. Replay must not treat it as a charge to the owner.
- The API has no withdrawal status endpoint: see `docs/decisions/2026-11-06-0331-withdrawal-status-endpoint.md`.

### Integration Handoffs
- **Shreyas:** `POST /withdrawals` must reserve under the withdrawal ID, journal `WITHDRAWAL_LOCKED`, then call `Executor.runWithdrawal`. It must handle rejection from `finished`.
- **Felix:** `KeyManager` must implement `TransactionSigner`, including `registerOp`.
- **Pradnyesh:** withdrawal status depends on the endpoint decision above.

### Commit Reference
- **Commits:** `921b23c2a82ab9eb725bd8818b55ae5228cfc91d` (`feat(enclave): add withdrawal execution`), `d66b296c04933e495bedf90a953bfc300cd2abae` (`test(enclave): cover withdrawals against a local Anvil chain`)
- **Pushed to Remote:** No

---

## Task 3: Implement FIFO SerialQueue

- **Date:** 2026-11-06
- **Task Number & Title:** Task 3 — Implement FIFO SerialQueue
- **Status:** Complete & Committed
- **Objective:** Implement the FIFO serialized execution queue in `services/enclave/src/queue.ts` satisfying the `@cloakroom/shared` `SerialQueue` interface, ensuring strict concurrency of 1, FIFO execution ordering, and robust error isolation.

### Files Created
- `services/enclave/src/queue.ts`
- `test/queue.test.ts`

### Files Modified
- `services/enclave/src/index.ts`
- `docs/enclave.md`
- `docs/roles/shreyas-api.md`
- `docs/engineering-log.md`

### Dependencies Added or Changed
- None (zero dependencies added).

### Implementation Details
- Implemented `FifoSerialQueue` conforming to `SerialQueue` from `@cloakroom/shared`.
- Used an internal promise chain (`private tail: Promise<void> = Promise.resolve()`).
- `run<T>(op: () => Promise<T>): Promise<T>` chains execution onto `this.tail`.
- Error containment: The callback attached to `this.tail` catches both asynchronous rejections and synchronous exceptions thrown by `op()`. It forwards the error to the caller's returned Promise reject handler while completing its own async step without re-throwing. This guarantees `this.tail` always settles to a resolved Promise, preventing subsequent queued tasks from being blocked or poisoned.
- Deadlock warning documented: recursive self-enqueuing from within an active operation on the same queue instance will deadlock.

### Architectural Decisions
- Kept the queue purely mechanical and decoupled from business logic (ledger mutations, journal entries, or watcher events).
- Avoided third-party queue libraries (such as p-queue) in favor of a minimal, auditable native Promise chain.

### Tests Added
- `test/queue.test.ts`: 8 unit tests covering:
  1. FIFO ordering: 3 operations execute in exact submission order.
  2. Strict serialization: controlled execution with gates proving maximum active concurrency is exactly 1 throughout lifecycle.
  3. Async blocking: delayed first task prevents second task from starting until gate release.
  4. Return value delivery: distinct callers receive their individual string, number, or object return values.
  5. Rejection isolation: a rejected operation rejects its caller while subsequent tasks execute successfully.
  6. Synchronous throw isolation: a synchronous throw in an operation rejects its caller without halting subsequent operations.
  7. High-concurrency volume ordering: 100 concurrent tasks execute and complete in deterministic numerical sequence.
  8. Empty queue behavior: immediate invocation on a newly constructed queue succeeds normally.

### Exact Verification Commands & Results
- `pnpm --filter @cloakroom/enclave typecheck`: Exited with code 0 (0 errors).
- `pnpm --filter @cloakroom/enclave build`: Exited with code 0.
- `pnpm typecheck`: Exited with code 0 (all workspace packages pass).
- `pnpm test`: Exited with code 0 (106 passed in 6 test files across monorepo).
- `pnpm build`: Exited with code 0.
- `git diff --check`: Clean (0 whitespace errors or conflicts).

### Known Limitations & Unresolved Questions
- Operations that recursively call `queue.run` on the same queue will deadlock.
- Journaling before state mutation remains to be wired into ledger queue operations (Task 4 and Task 5).

### Integration Handoffs
- `FifoSerialQueue` exported from `@cloakroom/enclave` for use in upcoming ledger and watcher integrations.

### Commit Reference
- **Commit:** `977821f984a7fbfa234d4bd019e1c36460889df1`
- **Commit Message:** `feat(enclave): implement FIFO serial queue with error isolation`
- **Pushed to Remote:** `origin/main`

---

## Task A3: Drop Chainlink CRE

- **Date:** 2026-11-06
- **Task Number & Title:** Task A3 (Apurva's workstream) — Drop Chainlink CRE
- **Status:** Committed on branch `docs/drop-chainlink`. Not pushed by this entry.
- **Objective:** Record the team's decision not to build the CRE workflow, and make the enclave's own price polling the trigger in the docs and task lists. No application code changed.

### Files Created
- `docs/decisions/2026-11-06-0358-drop-chainlink-cre.md`

### Files Removed
- `docs/cre-workflow.md`
- `workflows/price-report/README.md`

### Files Modified
- `.env.example` (removed `ORACLE_HMAC_SECRET` and `PRICE_TOLERANCE_BPS`, added `PRICE_POLL_INTERVAL_SEC` and `PRICE_REFERENCE_AMOUNT_WEI`)
- `pnpm-workspace.yaml` (removed `workflows/*`)
- Project docs, decision index and role documents

### Dependencies Added or Changed
- None.

### Exact Verification Commands & Results
- `pnpm install --frozen-lockfile`: Exited with code 0.
- `pnpm test`: Exited with code 0 (106 passed in 6 test files).
- `pnpm typecheck`: Exited with code 0.

### Known Limitations & Unresolved Questions
- `price-poller.ts` is documented but not built.
- There is no independent price source: see the decision file.
- Trading API rate limits for polling are not yet checked.

### Integration Handoffs
- **Shreyas:** remove `OracleVerifier`, `PriceReportWireSchema`, `wireToPriceReport`, `ORACLE_MAX_STALENESS_SEC`, `STALE_PRICE` and `PRICE_MISMATCH` from `packages/shared` if unused. Do not build `POST /oracle/price`. Keep `PriceReport`.
- **Pradnyesh:** CRE tasks are removed. Anon-RPC is the prize focus.

### Commit Reference
- **Commit:** `79abbb3ed7297baec54871db6070ca51465b8fda` (`docs(decisions): drop Chainlink CRE`)
- **Pushed to Remote:** No

---

## Task A4: Environment Configuration

- **Date:** 2026-11-06
- **Task Number & Title:** Task A4 (Apurva's workstream) — Environment Configuration
- **Status:** Committed on branch `refactor/env-config`. Not pushed by this entry.
- **Objective:** Read the enclave's settings from environment variables, validated in one place, instead of constants in code.

### Files Created
- `services/enclave/src/config.ts`
- `services/enclave/test/config.test.ts`

### Files Modified
- `.env.example` (added `GAS_MARGIN_PERCENT`, `RECEIPT_TIMEOUT_MS`, `INVENTORY_SETTLE_ATTEMPTS`, `SESSION_GRANT_TTL_SEC`, `MAX_EXPIRY_FUTURE_SEC`, `MAX_CLOCK_SKEW_SEC`, `MAX_BODY_SIZE_BYTES`, and an example `MAX_AMOUNT_NATIVE_WEI`)
- `services/enclave/src/executor.ts`
- `services/enclave/src/watcher.ts`
- `services/enclave/test/executor-withdrawal.test.ts`
- `docs/deployment.md`, `docs/roles/apurva-onchain.md`, `docs/roles/shreyas-api.md`

### Dependencies Added or Changed
- None.

### Architectural Decisions
- Every variable is required, so no value is duplicated as a default in code.
- Errors name the variables at fault and never their values, because some are secrets.
- Fixed definitions stay in `packages/shared`, including `NATIVE`, `BPS_DENOMINATOR`, `PRICE_PRECISION` and error codes. That package also runs in the browser, which has no `process.env`.
- A test keeps `.env.example` and the schema in step.

### Tests Added
- `services/enclave/test/config.test.ts`: covers every required variable, invalid values, exact wei parsing, and that values never appear in errors.

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (154 passed in 7 test files).
- `pnpm typecheck`: Exited with code 0.

### Known Limitations & Unresolved Questions
- Nothing calls `loadConfig` yet, because the enclave has no boot code.
- Existing local `.env` files need the new variables.
- `packages/shared/src/constants.ts` still holds duplicates of some limits, unused by any code.

### Integration Handoffs
- **Shreyas:** read limits from `loadConfig`. `MAX_BODY_SIZE_BYTES`, `MAX_EXPIRY_FUTURE_SEC`, `MAX_CLOCK_SKEW_SEC`, `SESSION_GRANT_TTL_SEC`, `DEPOSIT_SESSION_DEFAULT_TTL_SEC` and `CONFIRMATIONS_DEFAULT` in `packages/shared` can then be removed.
- **Felix:** new settings must be injected into the TEE.

### Commit Reference
- **Commit:** `fae06c88c3250cdee348655e787aeabbd58c5d58` (`feat(enclave): add validated environment config`)
- **Pushed to Remote:** No

---

## Task F0: Nitro Attestation Bootstrap

- **Date:** 2026-11-05
- **Owner:** Felix
- **Objective:** Run the attestation service in a real Nitro Enclave and verify a fresh document against trusted build measurements.
- **Status:** Implemented and verified through an SSH tunnel. Public HTTPS ingress remains open.

### Changes

- Added `services/enclave/src/attestation.ts`, `attestation-server.ts`, `nitro/`, and `Dockerfile`: enclave-generated X25519 key, NSM document retrieval, key/build binding, and a bounded vsock relay. Startup fails outside Nitro.
- Added `scripts/verify-attestation.py`, its requirements, and the public AWS root certificate. Verification pins the AWS root and checks the certificate chain, ES384 signature, nonce, timestamp, PCR0–2, and key/build binding.
- Added `services/enclave/test/attestation.test.ts` and `test/attestation_test.py`.
- Updated the enclave package build script, public setup instructions, API contract, Felix checklist, TEE decision, and handoff documentation.
- Added Docker/Git exclusions for credentials and local artifacts. Only the public AWS root certificate is excepted from the PEM exclusion.
- Integrated the bootstrap with the current workspace packages; the application entrypoint and existing team modules are retained.

### Verification

- `pnpm typecheck`: passed.
- `pnpm test` with Anvil on PATH: 158 tests passed across 8 suites.
- `python -m unittest discover -s test -p '*_test.py' -v` in the verifier environment: 10 tests passed.
- ARM64 Docker and EIF builds: passed. Non-debug enclave boot and live verification: passed; local and deployed build hashes match.
- Live malformed-request checks: rejected. Live verification with a wrong nonce or wrong expected PCR: rejected.
- Ordinary Docker startup without NSM: refused.
- `git diff --check`: passed.

### Handoffs and Limitations

- API/frontend: use the attestation response and challenge encoding in `docs/api.md`; the phase-0 transport key rotates on restart.
- The standalone attestation server does not implement custody or the application routes. Public HTTPS, persistent keys, full application packaging, restart automation, and final reproducible builds remain open.
- The private SSH key and deployment identifiers are not part of this change.

### Commit Reference

- **Commit:** `31d36f9` (`feat(enclave): add verifiable Nitro attestation bootstrap`).
- **Pushed to Remote:** Yes, on `tee/nitro-attestation`.
- **PR:** Not created; the user requested a creation link.

---

## Task A5: Watcher Journal Events

- **Date:** 2026-11-06
- **Task Number & Title:** Task A5 (Apurva's workstream) — Watcher Journal Events
- **Status:** Committed on branch `fix/watcher-journal-events`. Not pushed by this entry.
- **Objective:** Move the watcher's deposit events closer to `JournalEvent` in `packages/shared`, as the deposit journal events decision suggests.

### Files Modified
- `services/enclave/src/watcher.ts` (`owner` added to `DEPOSIT_CREDITED`, `eoa` added to `DEPOSIT_SESSION_CLOSED`)
- `test/watcher.test.ts`
- `docs/decisions/2026-11-06-0258-deposit-journal-events.md`
- `docs/decisions/README.md`

### Dependencies Added or Changed
- None.

### Tests Added
- `test/watcher.test.ts`: one test covering the contents of each deposit event. Two deliberate bugs were introduced to check it, and each one made it fail.

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (159 passed in 8 test files).
- `pnpm typecheck`: Exited with code 0.

### Known Limitations & Unresolved Questions
- `watcher.ts` still cannot use the real `Journal`. `DEPOSIT_SESSION_OPENED` in `packages/shared` has no baseline, and its `DEPOSIT_CREDITED` requires a `txHash` the watcher cannot get.

### Integration Handoffs
- **Shreyas:** add `baseline` and `baselineBlock` to `DEPOSIT_SESSION_OPENED`, and replace `txHash` with `block` in `DEPOSIT_CREDITED`. Ledger replay can read the owner from `DEPOSIT_CREDITED`.

### Commit Reference
- **Commit:** `0bd017473130b179f19f1b76001555b8c0177a5b` (`fix(enclave): add owner and eoa to watcher journal events`)
- **Pushed to Remote:** No

---

## Domain Alignment and Decision Resolution Audit

- **Date:** 2026-11-06
- **Task Number & Title:** Domain Alignment and Backend Readiness Audit (Shreyas)
- **Status:** Completed
- **Objective:** Perform a deep architectural audit of the Cloakroom domain model, solve all open domain decisions owned by Shreyas, harmonize `JournalEvent` definitions between shared contracts and enclave subsystems, specify the accounting invariant and state transitions, define concurrency and queue boundaries, formalize the withdrawal status endpoint, and prepare the implementation plan for Task 4 (Append-only encrypted Journal).

### Files Created
- `docs/decisions/2026-11-06-0745-journal-durability-and-replay.md`
- `docs/decisions/2026-11-06-0745-concurrency-and-queue-boundaries.md`

### Files Modified
- `packages/shared/src/types/journal.ts` (canonical 15-event union harmonized with watcher, inventory, and executor)
- `packages/shared/src/schemas/api.ts` (added `WithdrawalStatusItemSchema` and `WithdrawalStatusResponseSchema`)
- `docs/decisions/2026-11-06-0151-fee-model.md` (accepted output-token basis point fee model)
- `docs/decisions/2026-11-06-0151-pending-balance.md` (accepted display-only watcher pending balance semantics)
- `docs/decisions/2026-11-06-0151-missing-eip712-types.md` (accepted `SessionQuery` and `CancelIntent`)
- `docs/decisions/2026-11-06-0151-journal-replay-events.md` (accepted canonical 15-event union)
- `docs/decisions/2026-11-06-0151-non-eth-deposits.md` (accepted native ETH only in v1)
- `docs/decisions/2026-11-06-0258-deposit-journal-events.md` (accepted canonical deposit event shapes)
- `docs/decisions/2026-11-06-0331-withdrawal-status-endpoint.md` (accepted `POST /withdrawals/status`)
- `docs/decisions/2026-11-06-0151-salt-and-key-lifetime.md` (accepted `salt = keccak256(enclavePubKey)`)
- `docs/decisions/2026-11-06-0151-admin-eoas-endpoint.md` (accepted `POST /admin/eoas` with admin auth)
- `docs/decisions/README.md` (updated decision index)
- `docs/data-model.md` (formalized solvency invariant, balance semantics, fee structure, state transition table)
- `docs/api.md` (added `/withdrawals/status`, updated typed data rules, error codes)
- `docs/enclave.md` (updated canonical `JournalEvent` and references)
- `docs/roles/shreyas-api.md` (checked off resolved decisions)

### Dependencies Added or Changed
- None.

### Architectural Decisions
- Solvency invariant mathematically formalized: physical custody balances minus inventory gas reserves must equal or exceed total user claims (`available + reserved`) plus protocol fees per token.
- `pending` balance is display-only from `DepositWatcher`; core `Ledger` only tracks `available` and `reserved`.
- Protocol fee calculated as `(amountOut * FEE_BPS) / 10000n` from `tokenOut` upon swap settlement. Zero protocol fee on failed swaps or withdrawals.
- Gas spent on-chain (`gasUsed * effectiveGasPrice`) recorded via `FEE_BOOKED` to an operational fee ledger, not charged to users.
- In-memory `FifoSerialQueue` bounds strictly defined: only nonce checks, journal appends, and state mutations execute inside the queue; network I/O, encryption, and RPC calls run outside the queue.
- Journal durability specified: AES-256-GCM encryption at rest, atomic framing, `fsync()` on every append, partial write rollback at EOF.

### Exact Verification Commands & Results
- `pnpm typecheck`: Exited with code 0 (all workspace packages pass).
- `pnpm test`: Exited with code 0 (159 passed in 8 test files across monorepo).
- `pnpm build`: Exited with code 0.
- `git diff --check`: Clean (0 whitespace errors or conflicts).

### Integration Handoffs
- **Apurva:** In `services/enclave/src/watcher.ts`, replace local `DepositEvent` with `JournalEvent` from `@cloakroom/shared`, add `session.owner` to `DEPOSIT_CREDITED`, and pass `session.eoa` to `DEPOSIT_SESSION_CLOSED`.
- **Pradnyesh:** Use `WithdrawalStatusResponse` for `/withdraw` page status tracking via `POST /withdrawals/status`.
- **Felix:** Implement journal sealing key derivation for AES-256-GCM in `KeyManager`.

---

## Task 4: Encrypted Append-Only Journal Implementation

- **Date:** 2026-11-06
- **Task Number & Title:** Task 4 — Encrypted Append-Only Journal Implementation (Shreyas)
- **Status:** Completed
- **Objective:** Implement the production-grade encrypted, hash-chained, append-only journal in `services/enclave/src/journal.ts` conforming to the `Journal` interface from `@cloakroom/shared`, ensuring strict persistence durability via fsync, atomic framing, deterministic replay, hash-chain integrity verification, and recovery from partial writes at EOF.

### Files Created
- `services/enclave/src/journal.ts` (EncryptedJournal class, canonicalJson, parseCanonicalJson, computeEntryHash, framing, AES-256-GCM encryption/decryption)
- `services/enclave/test/journal.test.ts` (Comprehensive 22-test unit test suite)

### Files Modified
- `services/enclave/src/index.ts` (Exported EncryptedJournal, computeEntryHash, canonicalJson, parseCanonicalJson, GENESIS_HASH, DEFAULT_MAX_RECORD_BYTES, JournalOptions)
- `docs/roles/shreyas-api.md` (Updated Task 4 status)
- `docs/enclave.md` (Documented EncryptedJournal framing format, cryptographic hashing, durability, and replay/recovery semantics)
- `docs/engineering-log.md` (Appended Task 4 engineering log)

### Dependencies Added or Changed
- None (uses Node.js built-in `node:crypto`, `node:fs/promises`, and existing workspace dependencies `viem` and `@cloakroom/shared`).

### Implementation Details
- **Binary Frame Layout:** `[payloadLength: 4 bytes BE uint32][iv: 12 bytes][ciphertext: N bytes][authTag: 16 bytes]`.
- **Encryption Scheme:** AES-256-GCM with fresh 12-byte cryptographic random IV per entry. Supports 32-byte `Buffer` or `0x`-prefixed 64-char hex key.
- **Deterministic Serialization:** Implemented `canonicalJson` and `parseCanonicalJson` sorting object keys lexicographically and serializing BigInt values as `"123n"` string tokens.
- **Cryptographic Hash Chain:** `keccak256(concat([encodePacked(['uint64', 'uint64'], [seq, ts]), prevHash, stringToHex(canonicalJson(event))]))`. Genesis hash is `0x0000000000000000000000000000000000000000000000000000000000000000`.
- **Durability & Concurrency:** Concurrent appends are serialized using Promise chaining. Writes call `handle.write()` followed by `handle.sync()` (`fsync`) before resolving. In-memory sequence and hash advance only upon successful durable sync. On write failure, file pointer is rolled back.
- **Replay & Integrity:** `replay()` validates frame boundaries, decrypts ciphertext, validates AES-GCM authentication tags, verifies sequential monotonic sequence numbering (`seq === lastSeq + 1`), verifies backward hash chaining (`prevHash === lastHash`), and recomputes the entry hash.
- **Crash Recovery at EOF:** If a trailing incomplete frame or truncated payload is found at EOF (due to power cut or crash mid-write), `replay()` truncates the partial bytes back to the last valid frame, resets state, and allows subsequent append operations.
- **Fatal Rejection:** Throws fatal errors for mid-file corruption, sequence gaps, wrong previous hashes, oversized frames, or invalid authentication tags.
- **Lifecycle Management:** Idempotent `close()` method that shuts down file handles and rejects subsequent append or replay calls.

### Tests Added
- `services/enclave/test/journal.test.ts` (22 tests covering all required cases):
  1. appends sequential entries with incrementing seq and timestamps
  2. enforces monotonic sequence numbering starting from 1
  3. links hashes correctly across entries (genesis to entry 1 to entry 2)
  4. matches expected hash computation format using viem keccak256
  5. produces ciphertext that does not contain plaintext event content
  6. uses unique IVs for every entry (no IV reuse)
  7. replays appended events in exact order
  8. replaying an empty journal yields zero events
  9. handles multiple appends sequentially and recovers full state
  10. fails replay on truncated frame (fewer bytes than header says)
  11. fails replay on corrupted ciphertext (AES-GCM authentication tag mismatch)
  12. fails replay on modified previousHash (hash chain broken)
  13. fails replay on sequence gap (e.g., seq 1 followed by seq 3)
  14. fails replay on wrong genesis hash for first entry
  15. ignores / truncates partial writes at EOF and allows new appends (crash simulation)
  16. throws fatal error on corruption in the middle of the file (not at EOF)
  17. handles events with bigints without precision loss
  18. handles all 15 JournalEvent variants without error
  19. concurrent appends do not interleave or produce duplicate sequence numbers
  20. fsync is called on every append when enabled
  21. rejects records exceeding maxRecordBytes
  22. closing the journal prevents further appends and closes file descriptors

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (181 passed across 9 test files).
- `pnpm typecheck`: Exited with code 0.
- `pnpm build`: Exited with code 0.
- `git diff --check`: Clean (0 whitespace errors or conflicts).

### Integration Handoffs
- **Shreyas (Ledger & Auth):** `Ledger` will consume `Journal.append()` inside `FifoSerialQueue` before applying balance mutations, and invoke `Journal.replay()` during boot.
- **Felix (Key Management):** Integrate journal sealing key derivation (`KeyManager`) to provide the 32-byte AES key to `EncryptedJournal`.

---

## Task 5: Accounting Ledger and Deterministic Replay Implementation

- **Date:** 2026-11-06
- **Task Number & Title:** Task 5 — Accounting Ledger and Deterministic Replay Implementation (Shreyas)
- **Status:** Completed
- **Objective:** Implement the in-memory accounting ledger in `services/enclave/src/ledger.ts` (`InMemoryLedger`) implementing `Ledger` from `@cloakroom/shared`, enforcing strict non-negativity and reservation conservation invariants, managing monotonic user nonces, segregating protocol fee revenue from operational gas expenditure, and enabling deterministic state replay from `JournalEvent` streams via `replayLedger`.

### Files Created
- `services/enclave/src/ledger.ts` (`InMemoryLedger`, `replayLedger`, reservation lifecycle, double-credit prevention, fee segregation, invariant verification)
- `services/enclave/test/ledger.test.ts` (36 unit and queue/journal integration tests covering all requirements)
- `services/enclave/test/ledger.property.test.ts` (Fast-check property-based tests verifying invariant conservation across arbitrary operations and 256-bit BigInt precision)

### Files Modified
- `services/enclave/src/index.ts` (Exported `InMemoryLedger`, `replayLedger`, types)
- `docs/enclave.md` (Documented `InMemoryLedger` accounting semantics, reservation lifecycle, and replay)
- `docs/data-model.md` (Documented reservation lifecycle, reference semantics, and fee segregation)
- `docs/testing.md` (Added `ledger.test.ts` and `ledger.property.test.ts` suites)
- `docs/roles/shreyas-api.md` (Marked Task 5 and boot replay complete)
- `docs/engineering-log.md` (Appended Task 5 engineering log)

### Dependencies Added or Changed
- None (utilized existing `viem`, `@cloakroom/shared`, `fast-check`, and `vitest`).

### Implementation Details
- **Balance & Reservation Management:** Per-owner, per-token mapping tracking `available` and `reserved` balances. Advisory `pending` balance is returned as `0n` by the core ledger. Reservations transition through `active -> released` or `active -> consumed`. Consumed reservations reduce `reserved` without restoring `available`; released reservations restore `available`.
- **Double-Credit Prevention:** Credit references (e.g., `deposit:<sessionId>:<blockNumber>`) are tracked; identical credits are idempotent, while conflicting parameters with the same reference throw.
- **Reservation Uniqueness:** Reservations require unique references and cannot be overwritten. Consumed reservations cannot be released; released reservations cannot be consumed.
- **Monotonic Nonce Accounting:** Nonces start at `0n` per owner and must be strictly increasing (`nonce > lastNonce`). Lower or already-used nonces are rejected with `NONCE_USED`.
- **Fee Segregation:** Protocol revenue (`EXEC_SETTLED.fee`) is credited to a dedicated protocol fee ledger and excluded from user claims. Operational gas expenses (`FEE_BOOKED.feeAmount`) are recorded in an operational gas ledger and never charged to users or deducted from reservations.
- **Deterministic Replay:** `apply(event: JournalEvent)` handles all 15 canonical journal event variants with validation (requiring `event.owner` on `DEPOSIT_CREDITED`, verifying owner matching on intent/withdrawal settlement and failure). `replayLedger` processes journal entries sequentially and verifies ledger invariants on completion.
- **Transaction Boundary:** Synchronous ledger methods contain no asynchronous network calls or global queues; callers own the queue transaction boundary (`queue.run(async () => { await journal.append(e); ledger.apply(e); })`).

### Tests Added
- `services/enclave/test/ledger.test.ts`: 36 tests (30 unit tests + 6 integration tests)
- `services/enclave/test/ledger.property.test.ts`: 3 property test suites running 150+ randomized iterations

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (220 passed across 11 test files).
- `pnpm typecheck`: Exited with code 0.
- `pnpm build`: Exited with code 0.
- `git diff --check`: Clean (0 whitespace errors or conflicts).

### Integration Handoffs
- **Shreyas (Auth & Server):** Use `InMemoryLedger` in Fastify route handlers and `auth.ts` inside `FifoSerialQueue` transaction boundaries.
- **Apurva (Executor):** Confirmed existing calls (`ledger.consume(withdrawal.id)` and `ledger.release(withdrawal.id)`) align with reservation reference semantics.

---

## Task 6A: EIP-712 Authentication, Session Authorization, and Replay-Safe Nonce Protection

- **Date:** 2026-11-06
- **Task Number & Title:** Task 6A — EIP-712 Authentication, Session Authorization, and Replay-Safe Nonce Protection (Shreyas)
- **Status:** Completed
- **Objective:** Implement `AuthService` in `services/enclave/src/auth.ts` providing EIP-712 typed-data signature verification, session key authorization for read-only queries, timestamp expiry and clock-skew enforcement, and queue-enclosed atomic nonce consumption with journal durability before ledger mutation.

### Files Created
- `services/enclave/src/auth.ts` (`AuthService`, `AuthError`, EIP-712 verification, ephemeral session grant registry, clock skew and expiry validation, atomic nonce consumption)
- `services/enclave/test/auth.test.ts` (31 comprehensive unit tests covering signatures, expiry horizons, session key authorization, and serialized nonce durability)

### Files Modified
- `services/enclave/src/index.ts` (Exported `AuthService`, `AuthError`, and types)
- `docs/roles/shreyas-api.md` (Marked Task 6A complete)
- `docs/enclave.md` (Documented `AuthService` architecture, session grants, and nonce ordering)
- `docs/api.md` (Clarified expiry policy distinction between requests and session grants, and documented first-nonce ledger semantics)
- `docs/testing.md` (Recorded `auth.test.ts` suite)
- `docs/engineering-log.md` (Appended Task 6A engineering log)

### Dependencies Added or Changed
- None (utilized existing `viem`, `@cloakroom/shared`, and `vitest`).

### Implementation Details
- **Domain Binding & Recovery:** Domain constructed dynamically using configured `chainId` and `salt = keccak256(enclavePubKey)`. Signatures evaluated via viem's `recoverTypedDataAddress` using shared `EIP712_TYPES`. Any signer mismatch, invalid signature format, wrong chain, or mismatched salt throws `BAD_SIGNATURE`.
- **Expiry Horizon Policy Distinction:**
  - Ordinary requests (`DepositRequest`, `Intent`, `CancelIntent`, `Withdrawal`) and queries (`SessionQuery`): Expiry must satisfy `now - MAX_CLOCK_SKEW_SEC <= expiry <= now + MAX_EXPIRY_FUTURE_SEC` (up to 5 minutes ahead, with 60 seconds of clock skew).
  - Session grants (`SessionGrant`): Expiry defines session lifetime and must satisfy `now - MAX_CLOCK_SKEW_SEC <= expiry <= now + SESSION_GRANT_TTL_SEC` (up to 30 minutes ahead).
- **Session Grant Registry:** Ephemeral in-memory registry mapping normalized owner address to `{ owner, sessionKey, expiry }`. Authorizes `SessionQuery` operations without consuming owner nonces. Session keys cannot authorize state mutations. Expired grants are purged on detection. Grants do not persist across enclave restarts.
- **Atomic Nonce Protection:** Mutating operations verify signatures and expiry outside the queue, then execute nonce checks inside `FifoSerialQueue`:
  1. Read `ledger.getLastNonce(owner)`.
  2. Require `nonce > lastNonce` (throws `NONCE_USED` if lower or duplicate).
  3. Durably append `{ t: 'NONCE_USED', owner, nonce }` to `Journal`.
  4. Only after journal sync succeeds, update `ledger.setNonce(owner, nonce)`.
- **First-Nonce Semantics:** In accordance with core ledger contract (`getLastNonce` defaults to `0n` and requires `nonce > lastNonce`), the first accepted nonce for any owner is strictly greater than `0n` (e.g. `1n`). Calling `consumeNonce` with `0n` throws `NONCE_USED`.

### Tests Added
- `services/enclave/test/auth.test.ts` (31 unit tests):
  - Signature verification: valid signature accepted, invalid rejected, altered message rejected, wrong signer rejected, wrong chain rejected, wrong salt rejected.
  - Expiry and clock skew: already expired rejected, allowed skew accepted, beyond skew rejected, far future rejected, valid grant accepted, grant exceeding TTL rejected, expired grant rejected.
  - Session authorization: session key signs `SessionQuery`, unknown session rejected, wrong session key rejected, foreign grant rejected, expired grant cannot authorize, session key cannot authorize mutation, `SessionQuery` does not consume nonce, replacement grant invalidates previous key.
  - Nonce protection: nonce accepted and journaled, duplicate nonce rejected, lower nonce rejected, first nonce `0n` rejected, journal append failure leaves ledger unchanged, journal failure does not poison queue, concurrent duplicate nonce yields exactly one success and one `NONCE_USED`, different owners independently accepted, journal event normalizes owner and nonce.
  - Full pipeline: `verifyAndAuthorizeMutation` performs signature check, expiry check, and queue-enclosed nonce consumption in sequence.

### Exact Verification Commands & Results
- `pnpm test`: Exited with code 0 (251 passed across 12 test files).
- `pnpm typecheck`: Exited with code 0.
- `pnpm build`: Exited with code 0.
- `git diff --check`: Clean (0 whitespace errors or conflicts).

### Integration Handoffs
- **Shreyas (Task 6B — Fastify Server & Routes):** Route handlers in `server.ts` will call `authService.createSessionGrant`, `authService.verifySessionQuery`, and `authService.verifyAndAuthorizeMutation`.
- **Felix (KeyManager / Attestation):** Enclave bootstrap passes `enclavePubKey` into `AuthService` dependencies upon initialization.
- **Frontend / Pradnyesh:** Mutating request nonces must start at `1n` (`0n` is rejected); `SessionGrant` expiry can be up to 30 minutes; restarting the enclave clears in-memory session grants.
