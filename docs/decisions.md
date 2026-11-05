# Decisions and open questions

Update this file as items close. Items in section 3 were found while converting the plan and spec into these docs. Each has a proposal, but nothing is decided until its owner confirms.

## 1. Decisions from the plan

Decide before hour 0. The biggest schedule risk is TEE setup, so it is time-boxed to the first 3 hours.

| # | Decision | Recommendation | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | TEE platform | EigenCompute, Phala dstack or Nitro Enclaves: whichever returns an attestation quote first | Felix | Open |
| 2 | Network | **Sepolia.** Uniswap supports it and its WETH/USDC pool has real liquidity. A local fork may not work for the EF prize. None of Whitechain's four tracks fits as written: each needs a USDT payment settled on Whitechain Sepolia in the main flow, and they target payments, not swaps | Apurva | Decided, pending a Trading API quote test |
| 3 | Relationship to hide | Deposit to withdrawal and deposit to swap. Swap to withdrawal can still leak through amounts and timing | Team | Recommended, confirm |
| 4 | Withdrawal credential | The depositor's wallet signing EIP-712, with recovery meaning the same wallet. Custody keys are never involved | Team | Recommended, confirm |
| 5 | Initial inventory | Operator-funded seed EOAs, disclosed in the demo | Apurva | Recommended, confirm |
| 6 | Open-source licence | MIT or Apache-2.0 from the first commit | Team | MIT applied in the first commit, change now if preferred |

## 2. Conflicts already settled: spec wins

| Topic | Plan said | Spec says (use this) |
| --- | --- | --- |
| Deposit matching | Match sender and recipient; wrong sender is not credited | Credit by the recipient's balance increase, which also works for smart-contract wallets. The sender is recorded but not required |
| Wrong-sender test | "Deposit from wrong sender: not credited" | Follows from the row above. Only the after-expiry case stays a rejection. See [testing.md](testing.md) |
| Intent states | 5 states | 6 states, adding `expired` |
| Oracle auth | "CRE workflow signature" | HMAC in `X-Report-Auth`. A DON-signed report is a stretch |
| Balance reads | Signed `BalanceQuery` | Session-signed query. See gap 3.2, because the type is not yet defined |
| Endpoints | No session or cancel | Adds `POST /session` and `POST /intents/cancel` |

## 3. Spec gaps to close

| # | Gap | Proposal | Owner | Needed by |
| --- | --- | --- | --- | --- |
| 3.1 | **Fee model is inconsistent.** The plan charges a fixed fee in the input token. `FEE_BPS` says fee on the input amount. Executor step 7 credits "output minus the fee" | Use `FEE_BPS` taken from the output, matching the executor, since the quote is for exactly `amountIn`. Update the config description. Decide withdrawal fees too | Shreyas, Apurva | Phase 1 |
| 3.2 | **Missing EIP-712 types.** Session-signed reads and `POST /intents/cancel` are used by the API but have no type in `types` | Add `SessionQuery` (owner, expiry) and `CancelIntent` (owner, intentId, nonce, expiry). Reads need no owner nonce, otherwise they collide with wallet-signed nonces | Shreyas, Pradnyesh | Phase 1 |
| 3.3 | **Journal cannot replay every state.** `JournalEvent` has nothing for intent cancelled or expired, deposit session closed or EOA relabelled, session grants, or fee bookings, yet state must be rebuildable by replay | Add `INTENT_CANCELLED`, `INTENT_EXPIRED`, `DEPOSIT_SESSION_CLOSED`, `FEE_BOOKED`. Decide whether session grants survive a restart | Shreyas | Phase 1 |
| 3.4 | **`pending` is undefined.** `Balance` has `pending` and invariant 1 counts pending withdrawals, but `Ledger` only tracks available and reserved | Define it. Suggested: `pending` is deposits seen but not yet confirmed, display only, and locked withdrawals stay in `reserved` | Shreyas | Phase 1 |
| 3.5 | **Oracle body format.** "All POST bodies are an Envelope", but the CRE sketch posts a plain report with an HMAC of the body | Exempt `/oracle/price` from sealing, since prices are not private | Shreyas, Pradnyesh | Phase 2 |
| 3.6 | **Salt hash and key lifetime.** The "key hash" function is unnamed, and the HPKE key is generated at every boot, so a restart changes the EIP-712 salt | Define `salt = keccak256(enclavePubKey)` in `packages/shared`. Either seal the HPKE key with the seed, or have the frontend re-fetch attestation and re-sign after a restart | Felix, Pradnyesh | Phase 1 |
| 3.7 | **`/admin/eoas` is not in the API table** and its auth is only described as "a signed admin call" | Listed in [api.md](api.md). Make it a POST signed by `ADMIN_ADDRESS`, disabled by `SEEDING_ENABLED=false` | Felix, Shreyas | Phase 1 |
| 3.8 | **The Dockerfile will likely not run.** It copies only the root `node_modules` from a pnpm workspace, where package dependencies live under `services/enclave/node_modules` as symlinks | Use `pnpm deploy` to produce a self-contained output directory, and test the image early | Felix | Phase 0 |
| 3.9 | **Non-ETH deposits.** `DepositRequest` has an `asset` field, but the watcher only tracks native balance | Reject any `asset` other than `NATIVE` in v1 | Shreyas, Apurva | Phase 1 |
| 3.10 | **Files with no owner in the spec.** `server.ts` and `reconcile.ts` are unassigned, and `queue.ts` is missing from the repo layout | Assigned to Shreyas in [roles/README.md](roles/README.md). Reconcile needs on-chain balances from Apurva's inventory | Shreyas | Phase 0 |
| 3.11 | **Sepolia pool price does not match the market.** See section 5 | Use the pool as the reference price | Apurva, Pradnyesh | Phase 0 |
| 3.12 | **Deposit events do not match balance-based crediting.** `DEPOSIT_CREDITED` needs a `txHash`, but reading a balance does not reveal one. `DEPOSIT_SESSION_OPENED` has no baseline, so a restart would lose it | `watcher.ts` uses the event shapes below, including `DEPOSIT_SESSION_CLOSED` from gap 3.3. Shreyas to adopt them in `journal.ts`, and the ledger's replay must look up the owner through the session `id` | Shreyas, Apurva | Phase 1 |

```ts
| { t: 'DEPOSIT_SESSION_OPENED'; id: string; owner: Address; eoa: Address; expiry: number; baseline: bigint; baselineBlock: bigint }
| { t: 'DEPOSIT_CREDITED'; id: string; amount: bigint; block: bigint }
| { t: 'DEPOSIT_SESSION_CLOSED'; id: string }
```

## 4. Verify against provider docs

The plan and spec state these were not checked.

| Item | Owner |
| --- | --- |
| TEE provider access, pricing, attestation format, how a quote is fetched and how secrets reach the enclave | Felix |
| HPKE library choice (for example `@hpke/core`) works in both the browser and Node, in our build | Felix |
| Exact swap flow: wrap step from ETH, Permit2 approval from an ERC-20 | Apurva |
| The Trading API returns a Sepolia quote for WETH to USDC, and the router in its calldata matches `UNIVERSAL_ROUTER_ADDRESS` | Apurva |
| A Sepolia RPC URL works through an Anon-RPC worker, and the provider accepts that traffic. Some providers refuse Tor | Pradnyesh |
| How the Anon-RPC harness plugs into viem | Pradnyesh |
| CRE CLI setup and access. Simulation works without approval; live DON deployment is Early Access and is not needed for the prize | Pradnyesh |
| Whether an HTTP POST inside a workflow runs once or on several DON nodes | Pradnyesh |
| Whether the enclave can verify a DON-signed report instead of the HMAC (stretch) | Pradnyesh, Apurva |

## 5. Sepolia network and reference price

### What was checked

Read on-chain and from the Uniswap and Anon-RPC docs on 2026-11-06. The Trading API itself has not been called yet: quotes below come from Uniswap's on-chain QuoterV2.

| Check | Result |
| --- | --- |
| Trading API support | Sepolia is listed as accessible through the API |
| Liquidity | The WETH/USDC 0.05% pool holds about 128 WETH and 3.2M USDC |
| Quote | About 2,630 USDC for 0.1 WETH |
| Anon-RPC | Browser-only, so enclave reads are a known leak. It takes a target URL, so a Sepolia RPC should work through any worker (not yet tested). Nox is published on Sepolia. Tor and Nym bootstrap with one non-anonymized mainnet read |

### The problem

| Source | ETH price |
| --- | --- |
| Chainlink ETH/USD feed on Sepolia | about $2,255 |
| Uniswap WETH/USDC 0.05% pool on Sepolia | about $26,060 |

The pool is about 11.6x the market price. With `PRICE_TOLERANCE_BPS=100`, a report at the market price would fail the cross-check every time, and every intent would stay pending.

### The decision

**Use the existing pool, and take the reference price from it.**

- The CRE workflow reads the pool price on-chain and reports that as `price`.
- The external API price is fetched and logged, but does not trigger swaps.
- `triggerPrice` is set relative to the pool price, not the market price.
- The demo says openly that testnet pools do not track the market.

**Why:** this carries the least risk for the Uniswap prize, the largest of the three, because the Trading API is most likely to route through an established pool.

**What it costs:** a weaker Chainlink entry, because the prize asks for an external price API too. The cross-check still catches a forged report, because the enclave compares it with its own quote.

### Alternative

Deploy MockUSDC and our own pool, priced at market. This keeps the price check exactly as specified and gives us control of the price, but the Trading API may not route to a new pool. If it does not, we build the swap ourselves, which weakens the Uniswap entry. Switch to this only if the API is shown to route to it.
