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


## Task T1: Align Attestation Wire Encoding

- **Date:** 2026-11-06
- **Objective:** Match the shared attestation schema and domain-salt input.
- **Changes:** Attestation responses now encode the transport public key and build hash as `0x`-prefixed hex. Updated the verifier, contract test, and API handoff.
- **Verification:** Attestation contract tests: 4 passed. Python verifier tests: 10 passed.
- **Push:** Not requested; subsequent work remains local.


## Task T2: HPKE Transport

- **Date:** 2026-11-06
- **Changes:** Added browser-safe sealing and protocol parameters in `packages/shared/src/transport.ts`, decryption in `services/enclave/src/envelope.ts`, and rejection tests. Added the patched `@hpke/core` 1.10.0 dependency and updated the API handoff.
- **Verification:** `pnpm typecheck` passed; 9 targeted attestation/transport tests passed. Covers concurrent contexts, wrong recipient/route/chain, malformed encoding, ciphertext modification and size limits.
- **Remaining:** Browser execution and main-server integration are tested separately.
- **Push:** No push; local work only.


## Task T3: Sealed Custody State and Signing Guard

- **Date:** 2026-11-06
- **Changes:** Added AES-GCM sealed state with revision checks and atomic durable file writes; explicit simulation-key gating; HD custody allocation; persistent HPKE identity; journal cipher; durable withdrawal signing registration; once-only signing across restarts; exact-byte recovery. The executor now awaits registration. Added shared signing journal events.
- **Verification:** Typecheck passed; 22 custody/vault tests passed. Coverage includes race conditions, mutable request snapshots, wrong destinations/chains/fees, failed or uncertain writes, and rollback relative to the journal.
- **Handoff:** Allocation and real signer registration are asynchronous. Updated the enclave interface and shared handoff documentation.
- **Remaining:** Live KMS setup, swap authorization and external rollback anchoring. Local environment keys are restricted to explicit simulation mode.
- **Push:** No push; local work only.


## Task T4: Browser HPKE Execution

- **Date:** 2026-11-06
- **Changes:** Added `scripts/check-hpke-browser.mjs`, the browser-check command and pinned development-only Playwright/esbuild dependencies.
- **Verification:** Chromium encrypted 16 concurrent messages without Node globals. The enclave implementation opened every message and rejected a changed route. Browser bundling succeeded.
- **Push:** No push; local work only.


## Task T5: Executor and Encrypted-Journal Integration

- **Date:** 2026-11-06
- **Changes:** Split key initialization from signing-journal replay to allow encrypted journal startup. Added a late-open journal regression test and Anvil integration tests using the real key manager, inventory and executor.
- **Verification:** 18 key-manager tests and 2 custody/executor integration tests passed. Native and ERC-20 payouts settle from an unlinked HD account. Restart preserves addresses and denies re-registration of settled operations. Typecheck passed.
- **Push:** No push; local work only.

## T6 — Persistent transport identity and one-time seeding

- Objective: bind attestation to the same sealed HPKE identity and make inventory disclosure authenticated, encrypted and durable.
- Added `custody-routes.ts`, admin EIP-712 schema, request-bound exporter response encryption, sealed disclosure consumption and identity injection. Updated shared/API contracts, decisions, role checklist and handoffs.
- Verified 34 focused tests covering custody, attestation, transport, wallet/domain/expiry rejection, concurrent disclosure, restart and response substitution. Typecheck and Chromium response checks run with the complete packaging change below.
- Local commit `b0ec4c4` contains T5 executor integration. No pushes.

## T7 — Complete Nitro runtime and release tooling

- Objective: package real application dependencies and exercise custody inside the same image as attestation.
- Changed package file lists, Docker deploy packaging, shared-source build hashing, bootstrap self-test, release manifest script, systemd templates and HTTPS proxy configuration.
- Verified self-contained deployment, Docker custody self-test, non-debug Nitro launch with 2 GiB, and independent fresh-quote verification. Image building on the small parent required swap and disk scratch space. Final live release verification follows after the KMS additions.
- Full API mounting, public DNS/HTTPS and byte-for-byte build reproduction remain open. No pushes.

## T8 — Recipient KMS sealing and external state recovery

- Objective: keep custody wrapping keys inside Nitro while storing recoverable ciphertext on the parent.
- Added KMS recipient adapter, in-enclave TLS agent, CMS anonymous-memory helper, role credential relay, ciphertext CAS backend, production custody composition and PCR-restricted CloudFormation template. Updated contracts, role progress and operations runbook.
- Verified real RSA-OAEP CMS generation/decryption offline, key restoration with a fresh RSA recipient, NSM/KMS/storage failure refusal, certificate/hostname rejection, concurrent CAS and restart of both custody manager and storage process. Live IAM/KMS permissions and end-to-end recovery remain unprovisioned.

## T9 — Dependency and logging audit

- Objective: remove known production dependency issues and check TEE failure paths for sensitive output.
- Updated both Zod dependencies to 4.6.7 after the audit reported GHSA-mrhx-c7xc-m3w5. Existing wire schema and configuration tests remain compatible. The TEE source contains only two generic bootstrap error logs; custody keys, seeds, allocations and request bodies are not logged. Internal role credentials are distinct from custody secrets and remain on vsock.
- Verification: typecheck, 204 TypeScript tests, 10 Python verifier tests, Chromium request/response transport and `pnpm audit --prod` passed. No known production dependency vulnerabilities were reported.
- Added a GitHub workflow with pinned action commits for the same checks; it has not run remotely because no push was made.

- Infrastructure validation: `cfn-lint` passed for the KMS template. `actionlint` passed for the GitHub workflow. Shell syntax and Python helper compilation passed. A negative signature regression also checks that invalid curve points return unauthorized rather than a service error.

## T10 — Persistent parent services and release handoff

- Objective: leave a verified, restartable Nitro bootstrap and concrete operations instructions.
- Added a digest-verifying parent installer, published the bootstrap release manifest, installed and enabled enclave/ingress/storage/KMS systemd units, and verified the final source hash against the local build. The deployed image passes the custody self-test and independent fresh-quote checks with nonzero PCRs and no debug flag.
- Validation: systemd unit validation passed on the parent; Caddy validated the HTTPS template. No domain or certificate was provisioned. Full host reboot verification follows below.
- Local commit `8f50264` contains the sealed runtime, recipient KMS and seeding implementation. No pushes.

- Host reboot verification passed: allocator, non-debug enclave, ingress, storage and KMS relays returned automatically. A fresh quote after reboot passed AWS chain, signature, nonce, PCR and build-binding checks. Temporary build swap was removed before reboot.

## T11 — Temporary AWS credential refresh

- Objective: keep KMS available after the first EC2 role credentials expire.
- The parent credential provider now returns the AWS SDK's `expiration: Date` field. Without it, SDK memoization can treat temporary credentials as static. Updated the KMS/custody provider contracts.
- Added a regression using the actual AWS KMS client, mocked HTTP responses and controlled time. It proves one cached role fetch followed by a new credential and authorization header near expiry. Typecheck and focused tests passed; the full suite now contains 205 tests. The runtime image is being refreshed with this fix. No pushes.
