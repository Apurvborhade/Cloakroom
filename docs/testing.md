# Tests and security checklist

The rejection tests are the proof that the ledger holds. Run the reconcile check after every test, and show the attack tests live.

Chain tests run against an Anvil fork. Set `CHAIN_ID` to whatever the fork reports, because it must match the EIP-712 domain. Run `reconcile()` at the end of every suite.

## Suites

| Suite | Owner | Covers | Must assert |
| --- | --- | --- | --- |
| `ledger.test.ts` | Shreyas | 36 unit and queue/journal integration tests | Non-negativity, isolation, double-credit prevention, replay |
| `ledger.property.test.ts` | Shreyas | Random sequences of credit, reserve, release, consume (fast-check) | Never negative; totals conserved |
| `auth.test.ts` | Shreyas | 31 unit tests: signatures, expiry horizons, clock skew, session grants, and serialized nonce durability | Each bad input returns its error code; concurrent duplicate nonces reject |
| `concurrency.test.ts` | Shreyas | Two withdrawals of 80% at once; intent versus withdrawal race | Exactly one wins |
| `journal.test.ts` | Shreyas | Replay rebuilds state; one altered entry | Same balances; hash chain breaks on tamper |
| `executor-recover.test.ts` | Apurva | Restarts with the journal reopened from disk: after a send, before a send, during a revert, with a moved nonce, and with no chain access | Reboot settles once, never executes twice |
| `watcher.test.ts` | Apurva | Deposit confirmations, repeat checks, closed sessions | Credited once, only after N blocks |
| `executor.fork.test.ts` | Apurva | Swap, `minOut`, malicious calldata, revert | Swap runs from a non-depositor EOA; `to` other than the router is refused; revert releases funds |
| `price-poller.test.ts` | Apurva | Failed polls, condition met or not, condition no longer met on the swap's own quote | A failed poll triggers nothing; intent stays pending when the condition no longer holds |
| `e2e.fork.test.ts` | Apurva, with everyone | The full demo fixture with two users | Reconcile is `ok` at the end |

TEE verification suites are implemented alongside the enclave package:

| Suite | Owner | Covers | Must assert |
| --- | --- | --- | --- |
| `keys.test.ts` | TEE | Signing guard | Unregistered operations are refused; each `opId` signs once |
| `envelope.test.ts` | TEE | HPKE seal and open, tampered ciphertext | Round-trips with the frontend library; tampering is rejected |
| `margin-roundtrip.test.ts` | TEE | Long/short opening, closure, liquidation, withdrawals and restart recovery | Actual custody balances match claims, test liquidity and booked gas; recovery settles once |

Run the margin suite with `pnpm exec vitest run services/enclave/test/margin-roundtrip.test.ts`. It uses Anvil, funded test inventory and a fixed-price router with ERC20/Permit2 approvals. Requests, signing, encrypted journal recovery and asset transfers run through the application; live Uniswap and Nitro are separate checks.

## Rejection tests

| Test | Expected result |
| --- | --- |
| Resend a signed withdrawal | Rejected: nonce already used |
| Change the destination after signing | Rejected: signature does not verify |
| Submit an expired request | Rejected |
| Two withdrawals of 80% of a balance sent at once | Exactly one succeeds |
| Intent and withdrawal race on the same balance | Only one gets the reservation |
| Withdraw a token the user does not hold while the pool has surplus ETH | Rejected: no cross-token cover |
| Withdraw more than any single EOA holds | Clean rejection, lock released |
| Kill the enclave after broadcast, before settlement | On restart the state reconciles and nothing executes twice |
| Deposit with fewer than N confirmations | Not credited yet |
| Deposit after session expiry | Not credited |
| Condition no longer met on the swap's own quote | Intent stays pending and does not execute |

The plan also listed "deposit from the wrong sender: not credited". The spec's balance-based crediting replaces that behaviour: see [the spec wins over the plan](decisions/2026-11-06-0151-spec-over-plan.md).

## Security checklist

- [x] TEE bootstrap and custody plugin expose no custody key or seed; inventory disclosure is encrypted and durably consumed. Repeat after application routes are mounted (TEE)
- [x] Withdrawal signing guard rejects unregistered operations, and each `opId` signs once across restart (TEE)
- [ ] Router address pinned, and all API-provided calldata simulated before signing (Apurva)
- [ ] zod validation on every decrypted body, plus a body size limit (Shreyas)
- [ ] Logs contain no addresses, amounts or intent fields (Shreyas, everyone)
- [ ] CORS locked to the frontend, no third-party scripts in the client (Shreyas, Pradnyesh)
- [ ] Demo caps on amounts and a pause switch (Shreyas)
- [ ] Journal tamper test passes (Shreyas)
- [ ] TEE-simulated banner shown whenever the attestation is not real (Pradnyesh)
- [ ] README lists the known leaks: amounts and timing, the visible payout edge, gas-funding links between EOAs, the enclave's own RPC reads, a small anonymity set, and trust in the operator and hardware (Pradnyesh)

## TEE checks

Run `pnpm typecheck`, `pnpm test`, `pnpm test:hpke:browser`, and `python -m unittest discover -s test -p '*_test.py' -v`. The Python verifier requirements are in `scripts/attestation-requirements.txt`. Install Anvil before the chain suites and Chromium before the browser check.

Additional suites cover encrypted vault revisions, KMS recipient CMS, AWS TLS identity, parent credentials, external storage process restart, one-time admin disclosure and real signing through the withdrawal executor. KMS API responses are emulated offline; RSA, CMS, TLS and storage processes are real. Live Nitro/KMS recovery is still a separate deployment check.

KMS recipient tests using `memfd` and file-vault tests using `flock` run only on Linux. Other platforms skip those cases; portable encryption tests still run. Linux CI runs the full suite.

The GitHub TEE workflow runs these checks on pull requests, with pinned action commits. It needs no AWS credentials. Current bootstrap logging and endpoint checks cover custody material; repeat the audit when application routes are mounted.
