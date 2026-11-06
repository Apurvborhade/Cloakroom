# Dockerfile and pnpm

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | TEE | Phase 0 |

## Decision

Build shared and enclave packages, then run `pnpm --filter @cloakroom/enclave deploy --prod --legacy /runtime`. Copy that self-contained directory into the final image. Explicit package `files` lists include compiled output and Nitro helpers. No dependency symlink points into the build workspace.

## Verification

The complete container ran the custody self-test. A non-debug Nitro launch returned a quote whose AWS chain, signature, nonce, PCRs and build binding passed independent verification. The larger runtime needs 2 GiB enclave memory on the current small parent. Image building on that parent also needed temporary swap and disk-backed build scratch space.

The Docker base is digest-pinned; final byte-for-byte reproduction still needs package snapshots and deterministic timestamps.
