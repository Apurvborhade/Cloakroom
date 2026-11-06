# Development Conventions

This document establishes the engineering standards and conventions for the Cloakroom repository. All contributors and automated agents must adhere to these rules.

## 1. Strict No-Emoji Policy

No emojis may be introduced anywhere in this repository.
This applies without exception to:
- TypeScript and JavaScript source code
- Code comments and docstrings
- Documentation and markdown files
- Git commit messages and branch names
- Test descriptions and output assertions
- User interface copy and error displays
- Enclave logs and console outputs

Use plain, technical, and precise English.

## 2. TypeScript and Module System

- Monorepo package resolution uses strict ESM (`"type": "module"`).
- Target is `ES2022`, module and module resolution are `NodeNext`.
- All relative imports in TypeScript files must include the explicit `.js` extension (for example, `import { NATIVE } from './constants.js'`).
- Strict type-checking is enforced (`strict: true`, `noUncheckedIndexedAccess: true`).
- No implicit `any` types. Type casts must be explicit and justified.

## 3. Numeric Precision and Accounting Representation

- **Internal representation:** All on-chain token amounts, gas reserves, nonces, timestamps, and fixed-point prices inside the enclave and shared package core must use native `bigint`.
- **Wire and JSON representation:** Native JavaScript `JSON.stringify` and `JSON.parse` cannot safely handle 256-bit or 64-bit integers. All amounts, nonces, and prices exposed in JSON request/response bodies or serialized across network boundaries must be decimal strings representing base units (for example, `"1000000000000000000"` for 1 ETH in wei).
- **Fixed-point prices:** Prices are fixed-point integers scaled to 1e18 precision (`PRICE_PRECISION = 10n ** 18n`). Human decimals must not be computed using floating-point numbers.

## 4. Naming Conventions

- Files and directories: `kebab-case.ts` (for example, `interfaces.ts`, `schemas.test.ts`).
- Types, interfaces, and schemas: `PascalCase` (for example, `IntentMsg`, `SerialQueue`, `DepositRequestWireSchema`).
- Constants: `SCREAMING_SNAKE_CASE` (for example, `NATIVE`, `PRICE_PRECISION`, `ERROR_CODES`).
- Functions and methods: `camelCase` (for example, `deriveEnclaveSalt`, `wireToIntentMsg`).

## 5. Error Handling and Error Codes

- All API errors returned to callers must match the standard error shape `{ error: ErrorCode, message?: string }`.
- Error codes are enumerated in `constants.ts` under `ERROR_CODES`.
- Enclave internal errors must not leak addresses, private balances, or intent parameters to unauthenticated callers.

## 6. Testing Requirements

- Unit test files belong in `test/` alongside the relevant package, named `*.test.ts`.
- Every shared schema must have positive and negative validation test cases.
- Invariant testing for accounting modules requires property-based tests via `fast-check`.
- Concurrency and replay tests must assert ledger consistency under simulated crashes and simultaneous submissions.
- Every suite must exit cleanly with code 0 before code is considered complete.

## 7. Mandatory Documentation and Engineering Log Maintenance

Maintaining documentation is a continuous engineering obligation:
Whenever code, schemas, interfaces, or configurations are created or modified:
1. Update `docs/engineering-log.md` with the task number, title, objective, files changed, verification commands, and results.
2. Update the author's role ownership document (`docs/roles/<name>.md`).
3. Update shared API or interface contracts if changes affect team boundaries.
4. Update team handoffs in `docs/README.md` or role documents when another teammate depends on the changes.
5. Record commit hashes and commit messages in the log only after the commit is created.
6. Never mark a task as completed or pushed unless the command actually succeeded.

## 8. Git Commit Conventions

- Use Conventional Commits formatting:
  - `feat(<scope>): description`
  - `fix(<scope>): description`
  - `chore(<scope>): description`
  - `test(<scope>): description`
  - `docs(<scope>): description`
- Example: `feat(shared): implement shared contracts, eip712 types, and schemas`
- Keep commits focused and atomic.
- No emojis in commit messages.
