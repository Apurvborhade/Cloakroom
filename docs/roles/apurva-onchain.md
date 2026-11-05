# Apurva: on-chain and execution

**Done when:** a swap and a payout settle from a non-depositor EOA.

There is almost no Solidity in this design: custody accounts are plain EOAs and the ledger lives in the enclave. The on-chain work is everything that reads from and writes to the chain, and the moment where a swap runs from an EOA that neither user funded is the headline of the demo.

## You own

- Network decision, addresses and liquidity
- `services/enclave/src/watcher.ts`: deposits, confirmations, receipts
- `inventory.ts`: per-EOA balances and selection
- `executor.ts`: Uniswap swap, payout, transaction lifecycle, recovery
- `oracle.ts`: report auth, staleness, cross-check
- `contracts/`: optional EnclaveRegistry
- `scripts/seed-inventory.ts`, `scripts/demo-fixture.ts`
- Fork tests

Read: [chain-logic.md](../chain-logic.md), [contracts.md](../contracts.md), [enclave.md](../enclave.md) (Inventory, Executor, Oracle).

## Tasks

### Before hour 0

- [ ] RPC provider key and testnet ETH for 4 to 6 custody EOAs
- [ ] Uniswap developer platform key
- [ ] Test token liquidity, or a funded fork

### Phase 0 (hours 0 to 3)

- [x] Choose the network: Sepolia ([decisions.md](../decisions.md) section 5)
- [x] Collect `UNIVERSAL_ROUTER_ADDRESS`, `WETH_ADDRESS`, `TOKEN_OUT_ADDRESS` (in `.env.example`)
- [ ] Request a Trading API quote on Sepolia for 0.1 WETH to USDC, and confirm the router in the response matches `UNIVERSAL_ROUTER_ADDRESS`
- [ ] Agree the pool-based reference price with Pradnyesh
- [ ] Confirm the exact swap flow in the Uniswap docs: wrap step from ETH, Permit2 approval from an ERC-20

### Phase 1 (hours 3 to 12)

- [ ] Watcher: baseline on session open, read at `head - CONFIRMATIONS`, journal `DEPOSIT_CREDITED`, then credit
- [ ] Session expiry: one last check, close the session, relabel the EOA as inventory
- [ ] `Inventory`: `refresh`, `pick` with exclusions, `hold`, `free`
- [ ] `runWithdrawal`: lock, pick, sign, journal, send, confirm, consume
- [ ] On-chain totals for Shreyas's `reconcile()`
- [ ] [Gap 3.1](../decisions.md) and [gap 3.9](../decisions.md) with Shreyas

### Phase 2 (hours 12 to 22)

- [ ] `runIntent`, following the 7 steps in [chain-logic.md](../chain-logic.md)
- [ ] Treat the API's transaction as untrusted: pin `to`, run `eth_call`, require output of at least `minOut`
- [ ] `Oracle.accept`: HMAC in constant time, `ts` within 90 seconds and newer than the last, idempotent on `(pair, floor(ts / 60))`, tolerance check
- [ ] Keep a running list of Uniswap friction points for `FEEDBACK.md`

### Phase 3 (hours 22 to 29)

- [ ] `Executor.recover`: settle, rebroadcast or fail
- [ ] `recovery.test.ts`, `watcher.test.ts`, `executor.fork.test.ts`, `oracle.test.ts`
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
| Pradnyesh | CRE report format and HMAC |

## Others depend on you

| Who | What |
| --- | --- |
| Shreyas | On-chain totals for reconcile |
| Pradnyesh | Deposit addresses working end to end, Uniswap notes for `FEEDBACK.md` |

## Known gaps to state, not fix

- A stuck transaction is not fee-bumped.
- A reorg deeper than `CONFIRMATIONS` after settlement is not handled.
- Gas top-ups from one funder link the EOAs publicly.
