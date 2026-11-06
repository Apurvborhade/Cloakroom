# scripts

| Script | Purpose |
| --- | --- |
| `seed-inventory.ts` | Claim the custody addresses once, then fund them |
| `demo-fixture.ts` | Two users, scripted run, on a local chain or Sepolia |

**Owner:** Apurva.

## Sepolia test

`services/enclave/scripts/sepolia-smoke.ts` runs the real watcher, inventory and executor on a live chain, with stand-ins for the journal, ledger and signer. It seeds an address, makes a deposit, waits for the session to expire, and pays a withdrawal from the address the owner did not fund.

It refuses to run on anything except Sepolia or a local Anvil chain.

Add these to `.env`, which git ignores:

| Variable | Value |
| --- | --- |
| `RPC_URL` | A Sepolia RPC endpoint |
| `TEST_PRIVATE_KEY` | A throwaway wallet holding at least 0.05 Sepolia ETH. Never use a wallet with real funds |

```bash
pnpm smoke:sepolia
```

A run takes a few minutes and costs a little gas. Unspent test ETH goes back to the test wallet at the end, even if a step fails. If that return fails too, run the script again: its addresses come from the test key, so it recovers them first.

Optional settings: `SMOKE_SESSION_TTL_SEC` (default 90), `SMOKE_POLL_MS` (default 4000), `SMOKE_STEP_TIMEOUT_MS` (default 300000).

## Live quote check

`services/enclave/scripts/quote-check.ts` sends a few quote requests to the Uniswap Trading API with the same code the price poller uses, each from a new throwaway address. It sends nothing on-chain.

Add these to `.env`, using the values in `.env.example`: `UNISWAP_API_KEY`, `UNISWAP_API_URL`, `CHAIN_ID`, `TOKEN_OUT_ADDRESS`, `TOKEN_OUT_DECIMALS`, `PRICE_REFERENCE_AMOUNT_WEI` and `PRICE_QUOTE_TIMEOUT_MS`.

```bash
pnpm smoke:quote
```

## Sepolia swap test

`services/enclave/scripts/swap-smoke.ts` runs one real swap of 0.001 ETH through the live Trading API and Universal Router, with a stand-in journal and signer. It refuses to run anywhere except Sepolia, and spends test ETH only.

Add these to `.env`, on top of those above: `RPC_URL`, `TEST_PRIVATE_KEY`, `UNIVERSAL_ROUTER_ADDRESS`, `FEE_BPS` and `MAX_SLIPPAGE_BPS_CAP`. The test wallet needs at least 0.02 Sepolia ETH.

```bash
pnpm smoke:swap
```

Unspent ETH goes back to the test wallet at the end. The swapped tokens stay at the swap address.

## Running the service

Runs the real server in simulation mode, with no TEE. Fill in `.env` from `.env.example`, and set `SIM_MODE=true`, `SIM_VAULT_PATH` and `SIM_SEALING_KEY`. Set `CUSTODY_ALLOW_CREATE=true` for the first run only.

```bash
pnpm start:enclave
```

It needs `flock` to save custody state. Linux includes it, and on macOS install it with `brew install flock`. Without it the service stops with `BOOT_FAILED:keys`.

## Two-user round trip

The Phase 1 gate on real Sepolia, through the running service: two users deposit, then each withdraws to a fresh wallet, paid from an address they never funded. It needs no seeding, because each user's deposit address joins the pool when their session ends.

Start the service in another terminal, with `DEPOSIT_SESSION_TTL_SEC=120` in `.env` so the run takes minutes rather than a quarter of an hour. It needs `TEST_PRIVATE_KEY` with about 0.05 ETH. Each run deposits 0.02 ETH per user and pays out 0.003 ETH per user. The rest stays in the pool as those users' balances.

```bash
pnpm test:roundtrip
```

## Seeding the inventory

`services/enclave/scripts/seed-inventory.ts` has two steps. It refuses to run anywhere except Sepolia or a local Anvil chain.

### 1. Claim the addresses

**The enclave discloses these only once, and a lost response does not reopen it.** The script saves them straight away to `.seed-addresses.json`, which git ignores, and refuses to claim again while that file exists. Keep the file until funding is finished.

Take `ENCLAVE_PUB_KEY` from an attestation you have verified. The enclave must have `SEEDING_ENABLED=true`.

Add to `.env`: `ENCLAVE_URL`, `ENCLAVE_PUB_KEY`, `CHAIN_ID` and `ADMIN_PRIVATE_KEY`.

```bash
pnpm seed:claim
```

### 2. Fund them

Add to `.env`, alongside the Uniswap settings above: `RPC_URL`, `SEED_FUNDER_PRIVATE_KEY`, `GAS_RESERVE_WEI`, `SEED_ETH_PER_EOA_WEI` (ETH each address should hold, above its gas reserve) and `SEED_TOKEN_PER_EOA` (output token each address should hold, in base units).

Preview what it would do. This sends nothing:

```bash
pnpm seed:fund
```

Then fund them:

```bash
pnpm seed:fund --execute
```

It swaps ETH for any tokens the wallet is missing, using the same calldata checks as swaps, and checks the wallet can cover everything before sending. Running it again only tops up what is missing.

Afterwards, set `SEEDING_ENABLED=false`. Funding makes these addresses public, and funding them all from one wallet links them on-chain, which is a known leak.

## Two-user demo

`services/enclave/scripts/demo-fixture.ts` runs the whole demo script as one command: two users deposit, one swaps and withdraws, and three attacks fail. It prints each step, and checks it.

**What is real:** auth, journal, ledger, queue, watcher, inventory, price poller and executor.

**What is not yet real:** a stand-in signer and intent store, no API or UI, and nothing runs in a TEE. The output says so. Use it to rehearse and to test the core, not as the finished demo.

On a local chain, with a mock Uniswap router and no setup beyond Foundry:

```bash
pnpm demo:local
```

On real Sepolia, with the real Trading API and Universal Router. This spends test ETH, and needs the same `.env` as `pnpm smoke:swap`:

```bash
pnpm demo:sepolia
```

The Sepolia run takes several minutes. Unspent ETH goes back to the test wallet at the end, and tokens stay at the test addresses.
