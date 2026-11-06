# Apurva: on-chain execution and margin backend

**Done when:** a swap and a payout settle from a non-depositor EOA.

There is almost no Solidity in this design: custody accounts are plain EOAs and the ledger lives in the enclave. The on-chain work is everything that reads from and writes to the chain, and the moment where a swap runs from an EOA that neither user funded is the headline of the demo.

## You own

- Network decision, addresses and liquidity
- `services/enclave/src/watcher.ts`: deposits, confirmations, receipts
- `inventory.ts`: per-EOA balances and selection
- `executor.ts`: Uniswap swap, payout, transaction lifecycle, recovery
- `price-poller.ts`: price checks that trigger intents
- `contracts/`: optional EnclaveRegistry
- `scripts/seed-inventory.ts`, `scripts/demo-fixture.ts`
- Fork tests
- Margin API, shared wire schemas, price monitoring, and liquidation orchestration

Read: [chain-logic.md](../chain-logic.md), [contracts.md](../contracts.md), [enclave.md](../enclave.md) (Inventory, Executor, Price poller).

## Tasks

### Before hour 0

- [ ] RPC provider key and testnet ETH for 4 to 6 custody EOAs
- [x] Uniswap developer platform key
- [ ] Test token liquidity, or a funded fork

### Phase 0 (hours 0 to 3)

- [x] Choose the network: Sepolia ([decision](../decisions/2026-11-06-0229-network-sepolia.md))
- [x] Collect `UNIVERSAL_ROUTER_ADDRESS`, `WETH_ADDRESS`, `TOKEN_OUT_ADDRESS` (in `.env.example`)
- [x] Request a Trading API quote on Sepolia, and confirm the router in the response matches `UNIVERSAL_ROUTER_ADDRESS`
- [ ] Agree the pool-based reference price with Pradnyesh
- [x] Confirm the swap flow: from native ETH, the router wraps it, with no Permit2 or approval

### Phase 1 (hours 3 to 12)

- [x] Watcher: baseline on session open, read at `head - CONFIRMATIONS`, journal `DEPOSIT_CREDITED`, then credit
- [x] Session expiry: one last check, close the session
- [x] Relabel the EOA as inventory in `onSessionClosed`, and rebuild closed sessions into inventory on boot, because replay does not call it
- [x] Wire the watcher to the real `Ledger`, `Journal`, `SerialQueue` and `KeyManager` ([deposit journal events](../decisions/2026-11-06-0258-deposit-journal-events.md))
- [x] `Inventory`: `refresh`, `pick` with exclusions, `hold`, `free`
- [x] Connect `Inventory` to Felix's `KeyManager` and the watcher at boot, with settings from `loadConfig`
- [x] Run `pnpm smoke:sepolia` on real Sepolia ([scripts/README.md](../../scripts/README.md))
- [x] `runWithdrawal`: pick, sign, journal, send, confirm, consume. The API takes the lock first
- [x] On-chain totals for Shreyas's `reconcile()`, through `Inventory.getPhysicalBalances`
- [ ] [Fee model](../decisions/2026-11-06-0151-fee-model.md) and [non-ETH deposits](../decisions/2026-11-06-0151-non-eth-deposits.md) with Shreyas

### Phase 2 (hours 12 to 22)

- [x] `runIntent`, following the steps in [chain-logic.md](../chain-logic.md)
- [x] Run `pnpm smoke:swap` on real Sepolia
- [x] Treat the API's transaction as untrusted: pin `to`, decode the calldata, run `eth_call`
- [x] Price poller: quote every `PRICE_POLL_INTERVAL_SEC`, and trigger nothing when a poll fails
- [x] Run `pnpm smoke:quote` against the live Trading API
- [x] Connect the price poller to `IntentStore.due` at boot
- [x] Recheck the intent's condition against the swap's own quote before signing
- [ ] Keep a running list of Uniswap friction points for `FEEDBACK.md`

### Phase 3 (hours 22 to 29)

- [x] `Executor.recover`: settle, rebroadcast, or flag for review
- [x] `executor-recover.test.ts`, `watcher.test.ts`, `price-poller.test.ts`
- [ ] `executor.fork.test.ts`
- [ ] Lead `e2e.fork.test.ts`

### Phase 4 (hours 29 to 36)

- [x] `seed-inventory.ts`: claim the addresses once, and fund them with ETH and the output token, swapping Sepolia ETH for what is missing
- [ ] Run `pnpm seed:claim` and `pnpm seed:fund --execute` against the deployed enclave
- [x] `demo-fixture.ts`: two users, scripted run, with `pnpm demo:local` and `pnpm demo:sepolia`
- [ ] Run `pnpm demo:sepolia`
- [ ] Move the demo to the real signer, `IntentStore` and API once they land
- [ ] Give Pradnyesh the Uniswap integration line links for the README
- [ ] Optional, only if time is left: deploy EnclaveRegistry

## You depend on

| From | What |
| --- | --- |
| Felix | `KeyManager`: `allocate`, `sign`, opId registration. One-time EOA list for seeding |
| Shreyas | `Ledger`, `Journal`, `SerialQueue`, `IntentStore.due` and `mark` |
| Felix | Margin accounting types, preparation/settlement methods, risk checks, and recovery state |

## Others depend on you

| Who | What |
| --- | --- |
| Shreyas | On-chain totals for reconcile: `Inventory` implements `InventoryReader` |
| Pradnyesh | Deposit addresses working end to end, Uniswap notes for `FEEDBACK.md` |
| Felix | Margin API integration, fresh risk prices, physical inventory, and execution outcomes |

## Margin backend and execution

**Done when:** the API can open and fully close a long and a short, and the liquidation worker closes an unhealthy position through Uniswap and settles through Felix's accounting service. [Felix](felix-tee.md#margin-accounting) owns margin balances, ledger, risk calculations, and reconciliation; Apurva owns the margin API and all on-chain/backend integration.

Reuse the existing enclave service, deposit/withdrawal flows, custody, and Uniswap integration. The API and its private state processing stay inside the TEE; external ingress only relays encrypted traffic. Opening and closing positions still execute onchain.

- [x] Define signed margin commands, authenticated queries, wire schemas, and errors in `packages/shared/`, using Felix's accounting types. Reuse signature, nonce, expiry, and encrypted-transport checks; existing session keys remain read-only.
- [x] Add lending supply/redemption, open long/short, position/health queries, add-collateral, and full-close routes. Delegate all balance, debt, and margin mutations to Felix's accounting service. Apply its restrictions to withdrawals.
- [x] Extend Uniswap execution for both directions: buy ETH to open a long or close a short; sell ETH to open a short or close a long. Support required approvals and ETH/WETH handling, and return actual confirmed token deltas and costs.
- [x] Add narrowly scoped margin operation registration and signing validation, with Felix reviewing custody integration. Enforce bounded spending, permitted routers and recipients, minimum output, and deadlines; preserve existing swap guards.
- [x] Supply risk prices from the existing price check. For the testnet MVP there is no staleness rule: margin uses the last price, and refuses only when it has none.
- [x] Run the liquidation monitor: submit candidates to Felix's risk checks, obtain a reserved operation, execute the full close, and return its outcome. Do not mutate balances or bypass maintenance-margin rules.
- [x] Integrate transaction recovery with the journal, against the mock. Inventory reconciliation still needs Felix's accounting. Original task: integrate transaction recovery and inventory reconciliation with Felix's journal state. Report definite failure versus unresolved status correctly; never treat a broadcast transaction as a confirmed close.
- [x] Build a small API demo client and integration tests for successful longs/shorts, insufficient liquidity, failed swaps, duplicate requests, simultaneous close/liquidation, and restart recovery.

The ticked items work against the mock, and the signing changes still need Felix's review. See [margin-interface.md](../margin-interface.md).

Primary ownership: margin changes to `routes.ts`, `auth.ts`, `server.ts`, `executor.ts`, `swap-calldata.ts`, `uniswap.ts`, `inventory.ts`, `price-poller.ts`, shared wire contracts, and demo scripts. Coordinate signing-policy changes in `keys.ts` with Felix. Existing base API/accounting responsibilities remain with Shreyas; this split applies to the margin extension.

### Margin delivery

1. Agree the [accounting handoff](felix-tee.md#margin-handoff) and shared types with Felix. Work against a mock accounting service while Felix uses a mock executor.
2. Integrate lending, one long, and one short with full manual closure and debt repayment.
3. Demonstrate automatic liquidation after a controlled adverse price move, including correct trader remainder or explicit shortfall and consistent recovery after restart.

Scope: one chain, ETH/WETH and USDC, USDC collateral, isolated positions, and leverage capped at up to 4x subject to risk and liquidity limits. No stop-loss, take-profit, partial closes, position increases, collateral removal, cross-margin, automated strategies, internal matching, withdrawal queues, or new session permissions.

Use a local fork or testnet for the demo. Agree fees, borrowing interest, price source, maintenance margin, and loss allocation with Felix before integration. Liquidations can leave a shortfall; the existing full-storage rollback gap also remains a production-custody requirement.

## Known gaps to state, not fix

- A stuck transaction is not fee-bumped.
- A reorg deeper than `CONFIRMATIONS` after settlement is not handled.
- Gas top-ups from one funder link the EOAs publicly.
