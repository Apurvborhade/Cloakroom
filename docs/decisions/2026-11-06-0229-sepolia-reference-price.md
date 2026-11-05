# Sepolia reference price

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Apurva, Pradnyesh | Phase 0 |

## Context

| Source | ETH price |
| --- | --- |
| Chainlink ETH/USD feed on Sepolia | about $2,255 |
| Uniswap WETH/USDC 0.05% pool on Sepolia | about $26,060 |

The pool is about 11.6x the market price. With `PRICE_TOLERANCE_BPS=100`, a report at the market price would fail the cross-check every time, and every intent would stay pending.

## Decision

Use the existing pool, and take the reference price from it.

- The CRE workflow reads the pool price on-chain and reports that as `price`.
- The external API price is fetched and logged, but does not trigger swaps.
- `triggerPrice` is set relative to the pool price, not the market price.
- The demo says openly that testnet pools do not track the market.

## Why

This carries the least risk for the Uniswap prize, the largest of the three, because the Trading API is most likely to route through an established pool.

## Consequences

The Chainlink entry is weaker, because the prize asks for an external price API too. The cross-check still catches a forged report, because the enclave compares it with its own quote.

## Alternative

Deploy MockUSDC and our own pool, priced at market. This keeps the price check exactly as specified and gives us control of the price, but the Trading API may not route to a new pool. If it does not, we build the swap ourselves, which weakens the Uniswap entry. Switch to this only if the API is shown to route to it.
