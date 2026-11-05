# Network: Sepolia

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted, pending a Trading API quote test | Apurva | Phase 0 |

## Decision

Run on Sepolia. An Anvil mainnet fork is the fallback, but a local fork may not work for the EF prize, because local URLs probably cannot be reached through Anon-RPC.

None of Whitechain's four tracks fits as written: each needs a USDT payment settled on Whitechain Sepolia in the main flow, and they target payments, not swaps.

## What was checked

Read on-chain and from the Uniswap and Anon-RPC docs on 2026-11-06. Quotes below come from Uniswap's on-chain QuoterV2.

| Check | Result |
| --- | --- |
| Trading API support | Sepolia is listed as accessible through the API |
| Liquidity | The WETH/USDC 0.05% pool holds about 128 WETH and 3.2M USDC |
| Quote | About 2,630 USDC for 0.1 WETH |
| Anon-RPC | Browser-only, so enclave reads are a known leak. It takes a target URL, so a Sepolia RPC should work through any worker (not yet tested). Nox is published on Sepolia. Tor and Nym bootstrap with one non-anonymized mainnet read |

## Consequences

The Sepolia pool price does not match the market: see [the reference price decision](2026-11-06-0229-sepolia-reference-price.md).
