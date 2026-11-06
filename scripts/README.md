# scripts

| Script | Purpose |
| --- | --- |
| `seed-inventory.ts` | Fund and label the custody EOAs |
| `demo-fixture.ts` | Two users, scripted run |

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
