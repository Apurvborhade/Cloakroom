# Apurva: on-chain and execution

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
- [ ] Wire the watcher to the real `Ledger`, `Journal`, `SerialQueue` and `KeyManager` ([deposit journal events](../decisions/2026-11-06-0258-deposit-journal-events.md))
- [x] `Inventory`: `refresh`, `pick` with exclusions, `hold`, `free`
- [ ] Connect `Inventory` to Felix's `KeyManager` and the watcher at boot, with settings from `loadConfig`
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
- [ ] Connect the price poller to `IntentStore.due` at boot
- [x] Recheck the intent's condition against the swap's own quote before signing
- [ ] Keep a running list of Uniswap friction points for `FEEDBACK.md`

### Phase 3 (hours 22 to 29)

- [x] `Executor.recover`: settle, rebroadcast, or flag for review
- [x] `executor-recover.test.ts`, `watcher.test.ts`, `price-poller.test.ts`
- [ ] `executor.fork.test.ts`
- [ ] Lead `e2e.fork.test.ts`

### Phase 4 (hours 29 to 36)

- [ ] `scripts/seed-inventory.ts`: fund the EOAs with ETH and the output token. Get the USDC by swapping Sepolia ETH in the pool
- [ ] `scripts/demo-fixture.ts`: two users, scripted run
- [ ] Give Pradnyesh the Uniswap integration line links for the README
- [ ] Optional, only if time is left: deploy EnclaveRegistry

## You depend on

| From | What |
| --- | --- |
| Felix | `KeyManager`: `allocate`, `sign`, opId registration. One-time EOA list for seeding |
| Shreyas | `Ledger`, `Journal`, `SerialQueue`, `IntentStore.due` and `mark` |

## Others depend on you

| Who | What |
| --- | --- |
| Shreyas | On-chain totals for reconcile: `Inventory` implements `InventoryReader` |
| Pradnyesh | Deposit addresses working end to end, Uniswap notes for `FEEDBACK.md` |

## Known gaps to state, not fix

- A stuck transaction is not fee-bumped.
- A reorg deeper than `CONFIRMATIONS` after settlement is not handled.
- Gas top-ups from one funder link the EOAs publicly.
