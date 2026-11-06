# TEE and custody

**Done when:** the quote verifies and a derived EOA signs a test transaction.

You are the first gate. Nothing about the confidentiality claim holds until attestation works, and TEE setup is the biggest schedule risk in the project, so it is time-boxed to hours 0 to 3.

## You own

- TEE platform choice and deployment
- Attestation: `GET /attestation` and the quote verification CLI
- `services/enclave/src/keys.ts`: HD seed, EOA derivation, signing guard
- `services/enclave/src/envelope.ts`: HPKE decryption
- Journal encryption key, derived inside the TEE
- `services/enclave/Dockerfile`, reproducible build, release steps

Read: [enclave.md](../enclave.md) (Key manager), [deployment.md](../deployment.md), [api.md](../api.md) (Transport).

## Tasks

### Phase 0 (hours 0 to 3)

- [x] Compare TEE platforms and select AWS Nitro Enclaves
- [x] Set up the parent instance, Docker, Nitro CLI and enclave allocator
- [x] Build and run the AWS hello-world enclave without debug mode
- [x] Install persistent parent services and verify automatic non-debug startup after a full host reboot
- [x] Deploy an enclave returning a real quote from `GET /attestation`; verified through an SSH tunnel
- [x] Document the `/attestation` response shape in [api.md](../api.md)
- [x] Package all production dependencies with `pnpm deploy`; Docker self-test and non-debug Nitro quote verified ([deployment](../deployment.md#docker-image))
- [ ] Configure public HTTPS ingress for the team
- [ ] **If this is failing at hour 3:** switch to the fallback, the same container labelled TEE-simulated, with no confidentiality claim

### Phase 1 (hours 3 to 12)

- [x] `KeyManager`: sealed state, HD derivation, durable `allocate`, `list`, `sign`
- [x] Withdrawal signing guard: refuse anything that does not match a registered, journaled `opId`, and sign each opId once. Implement `TransactionSigner` from `services/enclave/src/executor.ts`
- [x] `envelope.ts` and shared browser sealing; Chromium-to-enclave transport tested with concurrent contexts
- [x] Report data commits to `sha256(enclavePubKey || buildHash)`
- [x] Bind attestation and decryption to the same sealed identity; see [key lifetime](../api.md#attestation-response-nitro-phase-0)
- [x] Implement [the admin EOAs endpoint](../api.md#admin-seeding-contract); authenticated encrypted response, durable one-time disclosure, server mounting remains an API handoff

### Phase 2 (hours 12 to 22)

- [x] Executor signing against the real guard: native and ERC-20 payouts tested on Anvil from unlinked HD accounts
- [x] Journal cipher derived from the custody seed; simulation wrapping keys require explicit `SIM_MODE`

### Phase 3 (hours 22 to 29)

- [x] Quote verification CLI script: AWS trust chain, COSE signature, nonce, timestamp, PCRs and key/build binding
- [x] `keys.test.ts` and `envelope.test.ts` ([testing.md](../testing.md))
- [x] Audit TEE modules and bootstrap: no key/seed endpoint, redacted failures, no custody address logging; dependency audit and API body bounds checked. Repeat when the application server is mounted

### Phase 4 (hours 29 to 36)

- [x] Publish the verified bootstrap image digest, EIF digest and PCRs; application release remains pending
- [ ] Build the final application image after API integration
- [ ] Deploy, verify the quote, hand the EOA list to Apurva for seeding, then disable seeding
- [ ] Give Pradnyesh the final enclave URL

## You depend on

| From | What |
| --- | --- |
| Shreyas | `server.ts` to wire decryption into, journal format for the journaled-op check |
| Apurva | How `opId` registration is called from the executor |

## Others depend on you

| Who | What |
| --- | --- |
| Everyone | Attestation shape and a reachable enclave |
| Apurva | `KeyManager` |
| Shreyas | `envelope.ts` |
| Pradnyesh | HPKE parameters, final URL, digest |

## Verify

- [x] TEE provider access and non-debug enclave startup
- [x] Provider pricing checked
- [x] Attestation format, retrieval through NSM, and independent verification
- [x] KMS recipient adapter, in-enclave TLS and external ciphertext CAS store; demo IAM/KMS provisioned and host calls without recipient attestation refused
- [x] Live Nitro/KMS recovery: identity, allocations, cached signatures, journal and balances survive enclave and storage-service restarts; seeding stays disabled. External rollback checkpoint remains open

## Swap integration

The signer enforces journaled limit swaps and the minimum credited after fees; see [the custody handoff](../enclave.md#custody-implementation-handoff). Executor integration is covered on Anvil with the real `KeyManager`. Uniswap uses the [in-enclave HTTPS transport](../../infra/nitro/README.md#uniswap-egress); the Sepolia smoke test with the real signer remains open.
