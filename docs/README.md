# Documentation

Converted from the Implementation Plan and the Technical Spec (both dated 2026-11-06), with the plan's persons A to D replaced by real names.

**If the two sources disagree, the spec wins.** Each conflict is listed in [decisions.md](decisions.md).

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
| [decisions.md](decisions.md) | Decisions to make, source conflicts, spec gaps, things to verify |
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
