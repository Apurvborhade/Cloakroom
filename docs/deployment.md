# Deployment, configuration and attestation

**Owner:** Felix.

The enclave ships as one Docker image built reproducibly, so a judge can rebuild it and compare hashes. How a quote is fetched and how secrets reach the enclave differs per TEE provider, so treat those steps as *verify* items for whichever platform is chosen.

## Docker image

Starting point from the spec. See [Dockerfile and pnpm](decisions/2026-11-06-0151-dockerfile-pnpm.md) before relying on the `node_modules` copy.

```dockerfile
FROM node:20-bookworm-slim@sha256:<pin-the-digest> AS build
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY services/enclave ./services/enclave
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter enclave build

FROM node:20-bookworm-slim@sha256:<pin-the-digest>
WORKDIR /app
COPY --from=build /app/services/enclave/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
CMD ["node", "dist/server.js"]
```

## Configuration

Mirrored in [`.env.example`](../.env.example), and read by `loadConfig` in `services/enclave/src/config.ts`. Every variable is required, and the enclave refuses to start if one is missing or invalid. The error names the variable, never its value.

Locally, pass the file to Node with `--env-file=.env`. In the TEE, inject the variables through the platform.

Fixed definitions, such as `NATIVE`, the basis-point scale and the 1e18 price scale, stay in `packages/shared`.

| Variable | Example | Purpose |
| --- | --- | --- |
| `CHAIN_ID` | `11155111` | Execution network and EIP-712 domain |
| `RPC_URL` | provider URL | Chain reads and broadcasts. Injected as a secret |
| `CONFIRMATIONS` | `2` | Blocks before crediting or settling |
| `GAS_RESERVE_WEI` | `10000000000000000` | Kept in each inventory EOA, excluded from claims |
| `GAS_MARGIN_PERCENT` | `120` | Gas limit as a percentage of the estimate |
| `RECEIPT_TIMEOUT_MS` | `180000` | How long to wait before a transaction's result counts as unresolved |
| `INVENTORY_SETTLE_ATTEMPTS` | `3` | Balance refresh attempts before an EOA is freed |
| `UNIVERSAL_ROUTER_ADDRESS` | `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3` | Pinned swap destination (2.1.2 on Sepolia). Confirm against a Trading API response |
| `WETH_ADDRESS` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | Pair for the demo |
| `TOKEN_OUT_ADDRESS` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Circle USDC on Sepolia |
| `UNISWAP_API_KEY` | from the developer platform | Quotes and swap calldata |
| `MAX_SLIPPAGE_BPS_CAP` | `100` | Upper limit on a user's slippage setting |
| `FEE_BPS` | `10` | Fee: see [fee model](decisions/2026-11-06-0151-fee-model.md) |
| `DEPOSIT_SESSION_TTL_SEC` | `900` | Lifetime of a deposit address |
| `SESSION_GRANT_TTL_SEC` | `1800` | Lifetime of a browser session key |
| `MAX_EXPIRY_FUTURE_SEC` | `300` | How far ahead a signed request's expiry may be |
| `MAX_CLOCK_SKEW_SEC` | `60` | Clock difference allowed on a signed request |
| `MAX_BODY_SIZE_BYTES` | `16384` | Largest request body accepted |
| `PRICE_POLL_INTERVAL_SEC` | `60` | How often the enclave checks the price |
| `PRICE_REFERENCE_AMOUNT_WEI` | `100000000000000000` | Input amount for each price check |
| `ADMIN_ADDRESS`, `SEEDING_ENABLED` | wallet, `true` then `false` | Operator seeding endpoint, turned off after setup |
| `MAX_AMOUNT_NATIVE_WEI` | `1000000000000000000` | Demo cap that limits exposure |
| `SIM_MODE` | `false` | Shows the TEE-simulated banner when `true` |
| `ALLOWED_ORIGIN` | frontend URL | CORS |

## Boot and attestation

1. At boot the enclave generates its HPKE key pair and loads or creates the sealed HD seed.
2. It requests a platform quote whose report data commits to `sha256(enclavePubKey || buildHash)`.
3. `GET /attestation` returns the quote, the public key, the build hash and the chain ID. The frontend uses the key hash as the EIP-712 `salt`.
4. The journal is encrypted with a key derived inside the TEE. If the platform has no sealed storage, use a persistent volume with a platform-derived key. Only `SIM_MODE` may fall back to a key from an environment variable.

## Seeding

A signed admin call returns the inventory EOA addresses once. `scripts/seed-inventory.ts` funds them with ETH and the output token, then set `SEEDING_ENABLED=false`. These addresses become public the moment they are funded, which is a known leak.

## Release steps

1. Build the image, record its digest in the README.
2. Deploy to the TEE provider and fetch `/attestation`.
3. Verify the quote with a CLI script and check that its report data matches the public key.
4. Seed the inventory (Apurva), then disable seeding.
5. Point the frontend at the enclave URL (Pradnyesh).
