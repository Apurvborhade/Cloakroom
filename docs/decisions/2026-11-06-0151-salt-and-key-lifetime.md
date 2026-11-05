# Salt hash and key lifetime

| Status | Owner | Needed by |
| --- | --- | --- |
| Open | Felix, Pradnyesh | Phase 1 |

## Problem

The "key hash" function is unnamed, and the HPKE key is generated at every boot, so a restart changes the EIP-712 salt.

## Proposal

Define `salt = keccak256(enclavePubKey)` in `packages/shared`. Either seal the HPKE key with the seed, or have the frontend re-fetch attestation and re-sign after a restart.
