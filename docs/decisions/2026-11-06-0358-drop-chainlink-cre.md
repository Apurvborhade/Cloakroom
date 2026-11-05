# Drop Chainlink CRE

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Apurva, Pradnyesh, Shreyas | Phase 2 |

## Decision

We will not build the Chainlink CRE workflow or enter the Chainlink prize. The enclave checks the price itself instead.

- A price poller in the enclave gets a Uniswap Trading API quote every `PRICE_POLL_INTERVAL_SEC`, and turns it into a `PriceReport`.
- Each report goes to `IntentStore.due`, as a CRE report would have.
- Before signing, the executor rechecks the intent's condition against the quote for that swap's own amount. If the condition no longer holds, the intent stays pending.

## Why

On Sepolia the pool price is far from the market, so CRE had to report the same pool price the enclave already reads. It added no independent check, and the Chainlink prize requires it to be meaningfully used. Dropping it frees Pradnyesh for Anon-RPC, and the demo no longer depends on CRE setup.

## What this removes

- `workflows/price-report/` and `docs/cre-workflow.md`
- `POST /oracle/price` and its HMAC check
- `ORACLE_HMAC_SECRET` and `PRICE_TOLERANCE_BPS`
- The optional Chainlink data feed

## Consequences

There is no independent price source. A manipulated or broken pool could make a condition look met. Each swap is still limited by its own quote, the owner's trigger price, the slippage limit and the simulation before signing, but those all rely on the same Uniswap data.

Uniswap's API now sees a price poll every interval as well as each swap request.

## Follow-up in `packages/shared`

`OracleVerifier`, `PriceReportWireSchema`, `wireToPriceReport`, `ORACLE_MAX_STALENESS_SEC` and the `STALE_PRICE` and `PRICE_MISMATCH` error codes are no longer needed by the API. `PriceReport` stays, because `IntentStore.due` takes it. Shreyas to remove what his code does not use.

## Supersedes

- [Sepolia reference price](2026-11-06-0229-sepolia-reference-price.md)
- [Oracle body format](2026-11-06-0151-oracle-body-format.md)
