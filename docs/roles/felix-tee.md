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
- [x] Deploy an enclave returning a real quote from `GET /attestation`; verified through an SSH tunnel
- [x] Document the `/attestation` response shape in [api.md](../api.md)
- [x] Test the phase-0 Docker image in Nitro ([Dockerfile and pnpm](../decisions/2026-11-06-0151-dockerfile-pnpm.md)); full application packaging remains open
- [ ] Configure public HTTPS ingress for the team
- [ ] **If this is failing at hour 3:** switch to the fallback, the same container labelled TEE-simulated, with no confidentiality claim

### Phase 1 (hours 3 to 12)

- [x] `KeyManager`: sealed state, HD derivation, durable `allocate`, `list`, `sign`; live KMS configuration remains open
- [x] Withdrawal signing guard: refuse anything that does not match a registered, journaled `opId`, and sign each opId once. Implement `TransactionSigner` from `services/enclave/src/executor.ts`
- [x] `envelope.ts` and shared browser sealing; Chromium-to-enclave transport tested with concurrent contexts
- [x] Report data commits to `sha256(enclavePubKey || buildHash)`
- [ ] Close [salt hash and key lifetime](../decisions/2026-11-06-0151-salt-and-key-lifetime.md) with Pradnyesh
- [ ] Close [the admin EOAs endpoint](../decisions/2026-11-06-0151-admin-eoas-endpoint.md) with Shreyas

### Phase 2 (hours 12 to 22)

- [ ] Support Apurva's executor signing against the real guard
- [x] Journal cipher derived from the custody seed; simulation wrapping keys require explicit `SIM_MODE`

### Phase 3 (hours 22 to 29)

- [x] Quote verification CLI script: AWS trust chain, COSE signature, nonce, timestamp, PCRs and key/build binding
- [x] `keys.test.ts` and `envelope.test.ts` ([testing.md](../testing.md))
- [ ] Audit: no endpoint returns a key or seed, and no key or custody address is ever logged

### Phase 4 (hours 29 to 36)

- [ ] Build the final image, record its digest in the README
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
- [ ] How secrets reach the enclave; KMS permissions and attestation policy if using AWS KMS
- [ ] Seed and journal persistence across restarts. Nitro Enclaves have no persistent storage; design encrypted external storage and key recovery before custody is enabled
