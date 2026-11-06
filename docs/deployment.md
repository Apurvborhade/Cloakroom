# Deployment, configuration and attestation

**Owner:** TEE workstream.

The enclave ships as one Docker image. Source hashing and base-image pinning are implemented. Byte-for-byte image reproduction still needs fixed OS package snapshots and normalized build timestamps; do not claim matching PCRs across independent builds yet.

## Docker image

The [Dockerfile](../services/enclave/Dockerfile) builds a self-contained runtime with `pnpm deploy --prod --legacy`. Both package manifests include compiled output explicitly. The image includes all application dependencies and Nitro helpers. The current entrypoint serves attestation and runs an unfunded custody self-test; mounting the application API remains a separate integration step.

```sh
docker build -f services/enclave/Dockerfile -t cloakroom-attestation .
```

See the [enclave README](../services/enclave/README.md) for Nitro image creation, vsock forwarding and verification. Public HTTPS, live KMS provisioning and final reproducible builds remain open. The recipient adapter, external ciphertext storage and reviewed-parameter infrastructure template are available in [the Nitro runbook](../infra/nitro/README.md).

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
| `UNISWAP_API_URL` | `https://trade-api.gateway.uniswap.org/v1` | Trading API address |
| `TOKEN_OUT_DECIMALS` | `6` | Decimals of `TOKEN_OUT_ADDRESS`, used to calculate prices |
| `MAX_SLIPPAGE_BPS_CAP` | `100` | Upper limit on a user's slippage setting |
| `FEE_BPS` | `10` | Fee: see [fee model](decisions/2026-11-06-0151-fee-model.md) |
| `DEPOSIT_SESSION_TTL_SEC` | `900` | Lifetime of a deposit address |
| `SESSION_GRANT_TTL_SEC` | `1800` | Lifetime of a browser session key |
| `MAX_EXPIRY_FUTURE_SEC` | `300` | How far ahead a signed request's expiry may be |
| `MAX_CLOCK_SKEW_SEC` | `60` | Clock difference allowed on a signed request |
| `MAX_BODY_SIZE_BYTES` | `16384` | Largest request body accepted |
| `PRICE_POLL_INTERVAL_SEC` | `60` | How often the enclave checks the price |
| `PRICE_REFERENCE_AMOUNT_WEI` | `100000000000000000` | Input amount for each price check |
| `PRICE_QUOTE_TIMEOUT_MS` | `10000` | How long to wait for a quote before the poll counts as failed |
| `SIGNING_MAX_GAS` | `1000000` | Largest gas limit the signer accepts. Must fit a swap, about 900,000 |
| `SIGNING_MAX_FEE_PER_GAS` | `100000000000` | Largest max fee per gas the signer accepts |
| `SIGNING_MAX_PRIORITY_FEE_PER_GAS` | `10000000000` | Largest priority fee the signer accepts. Cannot exceed the max fee limit |
| `SIGNING_MAX_NATIVE_VALUE_WEI` | `1000000000000000000` | Largest ETH value the signer accepts. Cannot be below `MAX_AMOUNT_NATIVE_WEI` |
| `ADMIN_ADDRESS`, `SEEDING_ENABLED` | wallet, `true` then `false` | Operator seeding endpoint, turned off after setup |
| `MAX_AMOUNT_NATIVE_WEI` | `1000000000000000000` | Demo cap that limits exposure |
| `SIM_MODE` | `false` | Shows the TEE-simulated banner when `true` |
| `ALLOWED_ORIGIN` | frontend URL | CORS |

## Boot and attestation

1. Open the sealed custody state with `openNitroCustody`. Fresh provisioning requires explicit `allowCreate: true`; ordinary restarts refuse missing state. The HPKE identity is derived from the restored seed.
2. It requests a platform quote whose report data commits to `sha256(enclavePubKey || buildHash)`.
3. `GET /attestation` returns the quote, the public key, the build hash and the chain ID. The frontend uses the key hash as the EIP-712 `salt`.
4. Open the journal with `keys.journalCipher()`, replay application state, then call `keys.restoreSigningState()`. The parent stores ciphertext only. KMS delivers its wrapping key encrypted to an attested RSA recipient; TLS to KMS terminates inside the enclave. Simulation wrapping keys require an explicit simulation-only vault.

## Seeding

Mount `custodyRoutes` during initial funding. A signed, encrypted admin call returns inventory EOA addresses once through an authenticated encrypted response. Funding tooling is a separate executor handoff. Set `SEEDING_ENABLED=false` after setup. The one-time disclosure flag also survives restart. Funding exposes these inventory addresses on-chain.

## Release steps

1. Build the image, record its digest in the README.
2. Deploy to the TEE provider and fetch `/attestation`.
3. Verify the quote with a CLI script and check that its report data matches the public key.
4. Seed the inventory (Apurva), then disable seeding.
5. Point the frontend at the enclave URL (Pradnyesh).
