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
- **Status:** Implemented & Tested (Pending user review before commit)
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
- Pending user review.
