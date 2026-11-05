# Documentation

Converted from the Implementation Plan and the Technical Spec (both dated 2026-11-06), with the plan's persons A to D replaced by real names.

**If the two sources disagree, the spec wins.** See [that decision](decisions/2026-11-06-0151-spec-over-plan.md).

## Find your brief

| Person | Workstream | Brief |
| --- | --- | --- |
| Felix | TEE and custody | [roles/felix-tee.md](roles/felix-tee.md) |
| Shreyas | API and accounting | [roles/shreyas-api.md](roles/shreyas-api.md) |
| Apurva | On-chain and execution | [roles/apurva-onchain.md](roles/apurva-onchain.md) |
| Pradnyesh | Frontend and web3 integrations | [roles/pradnyesh-frontend.md](roles/pradnyesh-frontend.md) |

[roles/README.md](roles/README.md) has the ownership matrix and the handoffs between people.

## Reference

| Doc | Covers |
| --- | --- |
| [overview.md](overview.md) | Scope, architecture, stack, definition of done |
| [roadmap.md](roadmap.md) | Phases, gates and per-person tasks |
| [decisions/](decisions/README.md) | One file per decision, with an index of what is open, and things to verify |
| [data-model.md](data-model.md) | Entities, accounting invariants, fees, concurrency |
| [api.md](api.md) | EIP-712 messages, signing rules, endpoints, errors, hardening |
| [enclave.md](enclave.md) | Enclave modules and interfaces |
| [chain-logic.md](chain-logic.md) | Deposit, swap, withdrawal, gas and recovery |
| [contracts.md](contracts.md) | Which contracts are needed, EnclaveRegistry |
| [frontend.md](frontend.md) | Routes, request flow, Anon-RPC, UX rules |
| [cre-workflow.md](cre-workflow.md) | Chainlink CRE price workflow |
| [deployment.md](deployment.md) | Docker image, configuration, attestation, release |
| [testing.md](testing.md) | Test suites, rejection tests, security checklist |
| [demo.md](demo.md) | Three-minute demo script |
| [prizes.md](prizes.md) | Prize requirements and evidence |
| [risks.md](risks.md) | Risks and fallbacks |
| [engineering-log.md](engineering-log.md) | Canonical chronological engineering activity log |
| [development-conventions.md](development-conventions.md) | Codebase standards, no-emoji rule, conventions |

## Shared Package Contracts and Handoffs

The `@cloakroom/shared` package is the single source of truth for protocol constants, EIP-712 definitions, Zod wire schemas, and backend subsystem interfaces.

### 1. Handoff to Felix (TEE & Custody)

- **Envelope Contract:** `Envelope` type and `EnvelopeSchema` for HPKE-encrypted request bodies (`{ enc: string, ct: string }`).
- **Domain Salt:** Derived via `deriveEnclaveSalt(enclavePubKey: Hex): Hex` which computes `keccak256(enclavePubKey)`.
- **EIP-712 Domain:** Created via `createDomain(chainId: number, enclaveKeyHash: Hex)`.
- **Journal Event Format:** `JournalEvent` discriminated union for operation audit and signing guard verification.
- **Unresolved decision for Felix:** HPKE key lifetime across restarts. If the TEE generates a new key pair on reboot without sealing it, the EIP-712 salt changes, invalidating client signatures. Felix must seal the HPKE key pair with the seed or coordinate salt refresh with Pradnyesh.

```ts
import { deriveEnclaveSalt, createDomain, type JournalEvent, type Envelope } from '@cloakroom/shared';

const salt = deriveEnclaveSalt(enclavePublicKey);
const domain = createDomain(chainId, salt);
```

### 2. Handoff to Apurva (On-Chain & Execution)

- **Subsystem Interfaces:** `Ledger`, `Journal`, `SerialQueue`, and `IntentStore` interfaces defined in `@cloakroom/shared`.
- **Inventory Integration:** `InventoryReader` interface (`getPhysicalBalances()`) required by `reconcile()`.
- **Oracle Verification:** `OracleVerifier` interface (`accept()`) for processing incoming price reports.
- **Journal State Changes:**
  - Watcher credits confirmed deposits via `queue.run(() => ledger.credit(owner, NATIVE, amount, txHash))` preceded by `DEPOSIT_CREDITED`.
  - Executor settlements call `ledger.consume(opId)` preceded by `EXEC_SETTLED`.
  - Executor failures call `ledger.release(opId)` preceded by `EXEC_FAILED`.
- **Unresolved decision for Apurva:** Fee model (Gap 3.1). Proposal is `FEE_BPS` deducted strictly from `amountOut` upon settlement. Apurva to confirm whether withdrawal fees apply or if payouts are fee-free with pool-funded gas reserves.

```ts
import type { Ledger, Journal, SerialQueue, IntentStore, PriceReport } from '@cloakroom/shared';
```

### 3. Handoff to Pradnyesh (Frontend & Web3 Integrations)

- **EIP-712 Definitions:** `EIP712_TYPES` and `createDomain` for signing via viem or wagmi's `signTypedData`.
- **Wire Request & Response Schemas:** All request and response Zod schemas (`DepositRequestWireSchema`, `IntentWireSchema`, `CancelIntentWireSchema`, `WithdrawalWireSchema`, `BalanceResponseSchema`, `IntentStatusResponseSchema`).
- **Decimal Strings on Wire:** Every 256-bit and 64-bit integer (`amountIn`, `triggerPrice`, `nonce`, `expiry`, `available`, `reserved`) is represented as a decimal string to prevent JavaScript float precision loss.
- **Error Codes:** Standardized `ERROR_CODES` enum (`BAD_SIGNATURE`, `EXPIRED`, `NONCE_USED`, `INSUFFICIENT_BALANCE`, `NO_INVENTORY`, etc.).
- **Session Queries & Cancellation:**
  - `SessionQuery` defined with `{ owner, expiry }` (does not increment or collide with owner transaction nonces).
  - `CancelIntent` defined with `{ owner, intentId, nonce, expiry }`.
- **Transport Note:** `POST /oracle/price` is exempt from HPKE envelope encryption and uses a plain JSON body with `X-Report-Auth` header.
- **Unresolved decision for Pradnyesh:** Verify that Anon-RPC routing works seamlessly with viem's custom transport configuration in the Next.js frontend.

```ts
import {
  EIP712_TYPES,
  createDomain,
  IntentWireSchema,
  SignedIntentSchema,
  ERROR_CODES,
  type IntentWire,
} from '@cloakroom/shared';
```
