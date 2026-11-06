# Frontend

A Next.js app that never shows a private key and never needs a custom wallet. The user's existing wallet signs; the app seals the request and sends it.

**Stack:** Next.js, TypeScript, wagmi, viem, RainbowKit, TanStack Query, Tailwind. Use `packages/shared` for every message type.

## Routes

| Route | What it does | Calls |
| --- | --- | --- |
| `/` | Connect wallet, show the attestation badge (build hash, enclave key, link to the reproducible build) | `GET /attestation` |
| `/deposit` | Sign a DepositRequest, show the assigned address and countdown, then send ETH from the wallet | `POST /deposit-session` |
| `/swap` | Form for token pair, amount, trigger price, comparator, slippage, expiry. List of intents with status | `POST /intents`, `/intents/status`, `/intents/cancel` |
| `/withdraw` | Choose token, amount and destination, sign, show status and the payout transaction link | `POST /withdrawals` |
| `/balance` (panel on every page) | Available, reserved and pending per token | `POST /balance` |

## Request flow in `lib/`

1. Fetch `/attestation` once and keep the enclave key. Check that its hash equals the EIP-712 `salt` the app will sign with.
2. Build the typed message from `packages/shared`, ask the wallet to sign it with viem's `signTypedData`, and show the user a readable summary first.
3. Seal `{ message, signature }` to the enclave key with HPKE and POST the envelope.
4. Poll status every 5 seconds while an operation is open, using the session key if one is granted.

## Anon-RPC

Route chain reads (wallet balance, transaction receipts, token reads) through the Anon-RPC browser harness by default, instead of a normal RPC provider. Follow the [wallet and app guide](https://ethereum.github.io/anon-rpc/wallets/) and use [`@anon-rpc/browser-harness`](https://www.npmjs.com/package/@anon-rpc/browser-harness). How the harness plugs into viem has not been checked yet.

EF judges weigh how much app traffic goes through Anon-RPC, so prefer a chain read over an API call where both would work.

Anything left out, such as the wallet's own signing RPC, goes in the README leak list with the reason.

## UX rules

- Show amounts in human units but sign base units. Display the exact trigger price the wallet will sign.
- On Sepolia, show the current pool price beside the trigger price field, because it is far from the market price.
- Never display custody EOA addresses other than the one deposit address for the open session.
- Show "TEE-simulated" in a banner whenever the attestation badge is not real.
- No analytics or third-party scripts. The EF CROPS prize rejects trackers in the client.
