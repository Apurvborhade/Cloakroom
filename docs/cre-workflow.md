# CRE workflow

The workflow is a scheduled messenger: every minute it fetches a price and posts it to the enclave. Intent contents never reach it, because it only handles prices.

**Owner:** Pradnyesh. The receiving end, `oracle.ts`, belongs to Apurva.

## Setup

From the [CRE overview](https://docs.chain.link/cre/overview): create an account on the CRE platform, install the CRE CLI, and build the workflow with the TypeScript SDK. Simulation works without approval. Deploying to a live DON is Early Access and needs approval, which is not needed for the prize.

## Files

Scaffold them with the CLI, then check the layout it generates.

```text
workflows/price-report/
  main.ts          # trigger and callback
  workflow.yaml    # workflow settings
  config.json      # pair, price API URL, enclave URL, tolerance
```

## Logic sketch

Helper names are placeholders. Use the imports the scaffold provides.

```ts
handler(
  cronTrigger.trigger({ schedule: '0 * * * * *' }), // every minute (six-field cron, seconds first)
  onCronTrigger,
);

function onCronTrigger(runtime: Runtime<Config>) {
  const price = fetchPrice(runtime);  // HTTP capability: price API, parsed to 1e18 fixed point
  const report = { pair: runtime.config.pair, price: price.toString(), ts: nowSeconds(), source: 'cre' };
  postToEnclave(runtime, report);     // HTTP capability: POST /oracle/price with auth header
  return {};
}
```

Optional second source: read the Chainlink ETH/USD data feed on the chosen chain and take the median of the two.

## Price source on Sepolia

The Sepolia WETH/USDC pool trades at about 11.6x the market price, so a market price would fail the enclave's cross-check every time. See [decisions.md](decisions.md) section 5.

- Read the pool price on-chain and report that as `price`.
- Fetch the external API price and log it, but do not use it to trigger swaps.

This replaces `fetchPrice` as the source of `price` in the sketch above, and the median with the data feed does not apply on Sepolia.

## Authentication

Keep a shared secret in CRE secrets and send `X-Report-Auth: HMAC_SHA256(secret, body)`. The enclave checks the HMAC in constant time, requires `ts` within 90 seconds, and rejects any `ts` not newer than the last accepted one. A shared secret means CRE is trusted for freshness, not for the price itself.

**Why that is safe enough:** the enclave also compares every report with its own Uniswap quote (`PRICE_TOLERANCE_BPS`) and enforces `minOut` on the swap, so a wrong report cannot drain funds.

## Verify in the CRE docs before building

- Whether an HTTP POST inside a workflow runs once or on several DON nodes. Make `/oracle/price` idempotent anyway: key each report by `(pair, floor(ts / 60))` and ignore repeats.
- Whether the enclave can verify a DON-signed report instead of using the HMAC. Treat this as a stretch.

## Demo setup

Simulation runs locally and makes real calls to live APIs and public EVM chains, so the enclave must be reachable by URL, for example through a tunnel when it runs locally. Show the simulation output and the enclave log line that accepted the report. CLI steps are in the [simulating workflows guide](https://docs.chain.link/cre/guides/operations/simulating-workflows).

## Fallback

If CRE access or setup fails, the enclave polls its own Uniswap quote and CRE is treated as optional.
