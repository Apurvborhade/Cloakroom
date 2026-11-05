# Tests and security checklist

The rejection tests are the proof that the ledger holds. Run the reconcile check after every test, and show the attack tests live.

Chain tests run against an Anvil fork. Set `CHAIN_ID` to whatever the fork reports, because it must match the EIP-712 domain. Run `reconcile()` at the end of every suite.

## Suites

| Suite | Owner | Covers | Must assert |
| --- | --- | --- | --- |
| `ledger.property.test.ts` | Shreyas | Random sequences of credit, reserve, release, consume (fast-check) | Never negative; totals conserved |
| `auth.test.ts` | Shreyas | Signatures, expiry, nonces, wrong chain or salt, session grants | Each bad input returns its error code |
| `concurrency.test.ts` | Shreyas | Two withdrawals of 80% at once; intent versus withdrawal race | Exactly one wins |
| `journal.test.ts` | Shreyas | Replay rebuilds state; one altered entry | Same balances; hash chain breaks on tamper |
| `recovery.test.ts` | Apurva | Kill after `EXEC_BROADCAST`, before settlement | Reboot settles once, never executes twice |
| `watcher.test.ts` | Apurva | Deposit confirmations, repeat checks, closed sessions | Credited once, only after N blocks |
| `executor.fork.test.ts` | Apurva | Swap, `minOut`, malicious calldata, revert | Swap runs from a non-depositor EOA; `to` other than the router is refused; revert releases funds |
| `oracle.test.ts` | Apurva | Bad HMAC, stale and repeated `ts`, price outside tolerance | Report rejected or intent held |
| `e2e.fork.test.ts` | Apurva, with everyone | The full demo fixture with two users | Reconcile is `ok` at the end |

The spec lists no suite for keys or transport. Felix should add these, because the security checklist depends on them:

| Suite | Owner | Covers | Must assert |
| --- | --- | --- | --- |
| `keys.test.ts` | Felix | Signing guard | Unregistered operations are refused; each `opId` signs once |
| `envelope.test.ts` | Felix | HPKE seal and open, tampered ciphertext | Round-trips with the frontend library; tampering is rejected |

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
| Price report outside the enclave's own quote tolerance | Intent does not execute |

The plan also listed "deposit from the wrong sender: not credited". The spec's balance-based crediting replaces that behaviour: see [the spec wins over the plan](decisions/2026-11-06-0151-spec-over-plan.md).

## Security checklist

- [ ] No endpoint returns a key or seed. The only address list is the one-time admin seeding call, which is then disabled (Felix)
- [ ] Signing guard rejects unregistered operations, and each `opId` signs once (Felix)
- [ ] Router address pinned, and all API-provided calldata simulated before signing (Apurva)
- [ ] zod validation on every decrypted body, plus a body size limit (Shreyas)
- [ ] HMAC compared in constant time (Apurva)
- [ ] Logs contain no addresses, amounts or intent fields (Shreyas, everyone)
- [ ] CORS locked to the frontend, no third-party scripts in the client (Shreyas, Pradnyesh)
- [ ] Demo caps on amounts and a pause switch (Shreyas)
- [ ] Journal tamper test passes (Shreyas)
- [ ] TEE-simulated banner shown whenever the attestation is not real (Pradnyesh)
- [ ] README lists the known leaks: amounts and timing, the visible payout edge, gas-funding links between EOAs, the enclave's own RPC reads, a small anonymity set, and trust in the operator and hardware (Pradnyesh)
