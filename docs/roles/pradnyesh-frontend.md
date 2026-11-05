# Pradnyesh: frontend and web3 integrations

**Done when:** the full flow runs from the UI.

You own everything a judge sees, plus the Anon-RPC prize integration. Most of the prize evidence and the submission itself also land with you.

## You own

- `apps/web/`: the Next.js app, wallet connection, request sealing
- Anon-RPC integration (EF prize)
- `README.md`, `FEEDBACK.md`, the demo video, the submission

Read: [frontend.md](../frontend.md), [prizes.md](../prizes.md), [demo.md](../demo.md).

## Tasks

### Before hour 0

- [ ] WalletConnect project ID

### Phase 0 (hours 0 to 3)

- [ ] Next.js app with wagmi, viem, RainbowKit, TanStack Query and Tailwind
- [ ] Wallet connect working, no analytics or third-party scripts
- [ ] Read the [Anon-RPC wallet and app guide](https://ethereum.github.io/anon-rpc/wallets/), try [`@anon-rpc/browser-harness`](https://www.npmjs.com/package/@anon-rpc/browser-harness), and confirm how it plugs into viem

### Phase 1 (hours 3 to 12)

- [ ] `lib/`: fetch attestation, check the key hash against the `salt`, sign typed data, seal with HPKE, POST
- [ ] `/` with the attestation badge and the TEE-simulated banner
- [ ] `/deposit` with the assigned address and countdown
- [ ] Balance panel on every page
- [ ] `/withdraw` with status and the payout transaction link, which needs the [withdrawal status endpoint](../decisions/2026-11-06-0331-withdrawal-status-endpoint.md)
- [ ] Session key flow, optional but it saves wallet popups
- [ ] [Missing EIP-712 types](../decisions/2026-11-06-0151-missing-eip712-types.md) with Shreyas and [salt hash and key lifetime](../decisions/2026-11-06-0151-salt-and-key-lifetime.md) with Felix

### Phase 2 (hours 12 to 22)

- [ ] `/swap`: form, readable summary before signing, intent list, cancel

### Phase 3 (hours 22 to 29)

- [ ] Route all frontend chain reads through Anon-RPC by default
- [ ] Raise the share of traffic it carries, for example by showing payout status from the chain instead of the API
- [ ] List any traffic left out and why, including the enclave's own reads
- [ ] UX rules: human units shown but base units signed, exact trigger price displayed, no custody addresses except the open deposit address

### Phase 4 (hours 29 to 36)

- [ ] README: setup, architecture, trust assumptions, known leaks, Uniswap integration line links, image digest
- [ ] A README section titled CROPS, with lines for C, O, P and S as listed in [prizes.md](../prizes.md)
- [ ] `FEEDBACK.md`, using Apurva's notes
- [ ] Complete the [Uniswap feedback form](https://developers.uniswap.org/hackathon-feedback) with the file link
- [ ] Demo video of 3 minutes or less following [demo.md](../demo.md), showing reads going through Anon-RPC
- [ ] Submit with a buffer

## You depend on

| From | What |
| --- | --- |
| Shreyas | `packages/shared`, endpoints, error codes |
| Felix | Attestation, HPKE parameters, final enclave URL, image digest |
| Apurva | Uniswap line links and notes |

## Others depend on you

| Who | What |
| --- | --- |
| Everyone | A UI to demo, and the submission itself |

## Fallbacks

- Anon-RPC cannot cover something: list it in the README instead of hiding it.

EF places a project in at most one EF prize. Submit to both, with Anon-RPC as the target and CROPS as the backup.
