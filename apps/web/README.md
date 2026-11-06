# apps/web

The Cloakroom product frontend: dashboard, deposit, conditional swaps, withdrawals, margin, attestation and diagnostics.
Next.js 14 (App Router), TypeScript, wagmi 2, viem, RainbowKit 2, TanStack Query 5 and Tailwind. All protocol definitions come from `@cloakroom/shared`.

**Owner:** Pradnyesh. See [docs/frontend.md](../../docs/frontend.md).

## Run it

```bash
pnpm install
pnpm --filter @cloakroom/shared build
cp apps/web/.env.example apps/web/.env.local   # then fill it in
pnpm --filter @cloakroom/web dev                # http://localhost:3000
```

Start the enclave from the repo root with `pnpm start:enclave`, using a root `.env` (see `.env.example` and `docs/deployment.md`). Set `ALLOWED_ORIGIN=http://localhost:3000`. For local testing use `SIM_MODE=true` together with `NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE=true`, and add `MARGIN_ENABLED=true` to try margin.

Tests: `pnpm --filter @cloakroom/web test`. They also run as part of the root `pnpm test`.

## Routes

| Route | What it does | Endpoints |
| --- | --- | --- |
| `/` | Account, attestation, private balances, recent intents and withdrawals, margin snapshot | `/balance`, `/intents/status`, `/withdrawals/status`, `/margin/*` reads |
| `/deposit` | Sign a `DepositRequest`, get the address, QR code and countdown, send ETH, then follow submitted → confirmed → credited | `/deposit-session`, `/balance` |
| `/swap` | Conditional ETH → output-token intents with a review before signing, the intent list and cancellation | `/intents`, `/intents/status`, `/intents/cancel` |
| `/withdraw` | Token, amount and destination, review, then locked → sent → confirmed with the transaction link and an on-chain receipt check | `/withdrawals`, `/withdrawals/status` |
| `/margin` (`/trade`, `/positions`, `/lending`) | Overview, open long or short (up to 4x), add collateral, full close, supply and redeem | `/margin/*` |
| `/attestation` | Enclave key, salt, build hash, quote, the offline verification command and the trust model | `GET /attestation`, `GET /sim/enclave-key` |
| `/diagnostics` | API, keys, HPKE self-test, session, Anon-RPC routing, margin availability, safe refresh actions | none of its own |

## How a request works

1. `lib/attestation`: fetch `/attestation` with a fresh nonce. If that fails and `NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE=true`, fall back to `/sim/enclave-key`. The response's chain must match the configured chain. salt = `deriveEnclaveSalt(key)`.
2. `lib/wallet/typed-data`: builders on top of `EIP712_TYPES`. Each returns the bigint message the wallet signs and the decimal-string wire form.
3. `components/trading/signing-review`: a readable review. The wallet popup opens only from its confirm button.
4. `lib/crypto/transport`: `sealEnvelopeWithResponse` from the shared package, bound to the chain, the route path and the enclave key.
5. `lib/api/client`: POST `{ enc, ct }`, open the single-use reply, validate it with the shared zod schema, and map plaintext `{ error }` codes. A 404 `INVALID_PAYLOAD` from the server's not-found handler becomes `ROUTE_NOT_FOUND`, which is how a disabled margin looks from outside.
6. `lib/session`: a read-only session key from `generatePrivateKey`, kept in `sessionStorage` until the tab closes or the grant expires, so a refresh needs no new signature. It can read balances but never move funds. One `SessionGrant`, at most 29 minutes. It signs `SessionQuery` reads only. A refresh, account change, chain change, enclave-key change, or `UNKNOWN_SESSION` drops it.

Nonces come from the millisecond clock and always increase, because the API cannot report the last accepted nonce.

## Anon-RPC

`lib/chain/chain-reader.ts` routes every browser chain read through `@anon-rpc/browser-harness` 0.4.0 (`AnonRpcWorker.fetch`, used as a viem `custom` transport). These reads are: deposit receipts and block number, the wallet's ETH balance, payout receipts, and the optional Uniswap pool spot price. wagmi's own public transport goes through the same reader.

- **No silent fallback.** If the specifier, target or bootstrap URL is missing, or the harness fails or times out, reads are off and the UI says so. A direct RPC is used only with `NEXT_PUBLIC_CHAIN_READ_MODE=direct-dev`, and it is labelled "not anonymized".
- Each account gets a random `isolationKey`.
- **Cloakroom API requests also go through Anon-RPC.** They were already encrypted to the enclave, and this hides the user's IP from the operator. If Anon-RPC is down, requests fail and a banner offers a direct connection, which only the user can choose. Only the bootstrap read and the wallet's own traffic stay outside it. In a test, encrypted `/balance` calls took 0.7 to 1.9 seconds through Nox, against about 20 ms directly.
- **Status: running against the live Nox mixnet on Sepolia**, including in a production build. Its specifier is `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A`, on Sepolia, so the bootstrap RPC reads Sepolia. The header badge shows live status and the read count, and the harness starts on load and retries 30 seconds after a failure. `tor-js` also boots in the app, but its published demo gateway timed out when tested. Nox is a third-party network, so reads depend on it being up, and there is no fallback to a plain RPC.
- Traffic that does not go through Anon-RPC is listed on `/diagnostics`: wallet signing and the deposit transfer (the wallet's own RPC), the harness's one bootstrap specifier read, the Cloakroom API itself, and all of the enclave's own reads.

## Honest status

- **Attestation:** the browser does not verify the Nitro quote. The badge says "received · unverified", never "verified". `/attestation` shows the exact `scripts/verify-attestation.py` command. A simulated key shows a permanent TEE-SIMULATED banner.
- **Margin:** in simulation the backend uses `MockMarginAccounting`. It keeps everything in memory, does not debit your private balance, and charges no interest. The UI labels it as mock accounting. Leverage is capped at 4x. There is no stop-loss, partial close, collateral removal and so on.
- **Intent lifetime:** the signed `expiry` is also the order's lifetime, and the enclave accepts at most 5 minutes ahead. Intents therefore live at most about 4.5 minutes.
- **Intent and withdrawal details:** the status endpoints return only id, status, `amountOut`, `txHash` and `reason`. Pair, amount, trigger and destination are shown only for actions signed in the current tab (kept in memory only).
- **Deposits:** the amount typed is what gets credited. The app adds the server's `gasReserveWei` on top and shows it before funding. A USDC deposit shows an editable "ETH for gas" field, filled with the minimum, and needs two wallet transfers to the same address. ETH above the reserve is credited. `/deposits/status` tracks progress and lets a partly funded deposit resume after a refresh, and each completed address is single-use. A server without that route still takes ETH, with no reserve.

## Backend blockers found

| Endpoint | Expected | Actual | Proposal |
| --- | --- | --- | --- |
| `GET /health/reconcile` | Aggregate health (docs/api.md) | Not registered by `server.ts` | Register it, or remove it from the docs |
| `POST /intents` | Order lifetime separate from signature expiry | `expiry` serves as both, capped at 5 min | Add an `orderExpiry` field or a longer policy for `Intent` |
| `/intents/status`, `/withdrawals/status` | Pair, amount, created time | Id and status only | Return the owner's own order details (encrypted reply) |
| Margin capability | A way to detect it and whether accounting is mock | Only a 404 on the routes | `GET /capabilities` with `{ margin, accounting: 'mock' or 'real' }` |
| Risk price | Freshness value | Only inferred from missing `equity` | Add `riskPriceTs` to `/margin/positions` |
| Response schemas | In `@cloakroom/shared` | `/session`, `/intents`, `/intents/cancel` and margin `{ ok }` have none | Moved locally to `lib/api/schemas.ts`; upstream them |
| Mutation nonce | A readable last nonce | None | Clock-based nonces work; a read endpoint would make retries clearer |

## Environment variables

See `.env.example`. Everything is public and non-secret. To configure:

- **Required:** `NEXT_PUBLIC_CLOAKROOM_API_URL`, `NEXT_PUBLIC_CHAIN_ID` and `NEXT_PUBLIC_TOKEN_OUT_ADDRESS`, matching the enclave.
- **Anon-RPC:** `..._SPECIFIER_ADDRESS`, `..._TARGET_URL` and `..._BOOTSTRAP_RPC_URL`.
- **Optional:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_UNISWAP_POOL_ADDRESS`.

## Tests

`test/integration.enclave.test.ts` boots the **real** enclave (routes, auth, HPKE, ledger, watcher, orders, mock margin) on a fake in-memory chain. It drives it with the frontend's own client: deposit credit, intent create/cancel, withdrawal lifecycle, margin supply/redeem/open, and every error path. It proves the protocol layer matches the backend. It does not prove on-chain execution, Uniswap or the TEE: the fake chain cannot execute, so withdrawals and margin swaps end `failed`. The other suites cover units, typed data, transport, the API client, sessions, config, the chain reader, forms, the deposit lifecycle and components.
