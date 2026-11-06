# Salt hash and key lifetime

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Felix, Pradnyesh | Phase 1 |

## Problem

EIP-712 requires a `salt` in the domain separator to prevent cross-enclave signature replays. The derivation of this salt and its lifetime across restarts were ambiguous.

## Existing behavior

`packages/shared/src/eip712.ts` exports `deriveEnclaveSalt(enclavePubKey: Hex): Hex` returning `keccak256(enclavePubKey)`.

## Decision

1. **Salt definition:** `salt = keccak256(enclavePubKey)` using standard Ethereum keccak256.
2. **Key lifetime:**
   - The HPKE encryption key pair and enclave public key are generated or sealed via `KeyManager`.
   - If the enclave restarts with a fresh ephemeral key, the salt changes.
   - The frontend queries `GET /attestation` at session initialization to obtain the current `enclavePubKey`, computes `salt = deriveEnclaveSalt(enclavePubKey)`, and configures its EIP-712 domain accordingly.
3. **Re-authentication after restart:** If an enclave restarts, previously signed in-flight wallet messages with the old salt will be rejected as `BAD_SIGNATURE`. The frontend detects this and prompts the user to re-sign.

## Consequences

- Cryptographic isolation: signatures cannot be replayed against a different enclave or a re-keyed instance.
- Frontend workflow is grounded in attestation parameters.
