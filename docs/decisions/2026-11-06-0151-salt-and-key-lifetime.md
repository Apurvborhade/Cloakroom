# Salt hash and key lifetime

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | TEE, frontend | Phase 1 |

## Decision

`deriveEnclaveSalt` computes `keccak256` over the raw 32-byte X25519 public key. The HPKE identity is derived from the sealed custody seed with HKDF-SHA256 and the label `cloakroom/transport/v1`. Attestation receives that identity from `KeyManager`; it never creates a second custody transport key.

Restoring the same sealed state preserves the public key and EIP-712 salt. Creating a new vault rotates both. Clients fetch and verify attestation before signing; after rotation they discard the previous domain and sign again. The attestation-only bootstrap remains ephemeral and must not accept custody requests.

## Verification

Restart, attestation/decryption identity and domain mismatch regressions are covered by `keys.test.ts` and `custody-routes.test.ts`.
