# Cloakroom

A TEE private intent network. Deposit ETH, hold a confidential balance, submit a conditional swap, have it executed from pooled inventory, and withdraw to an existing wallet. One attested TEE node holds every key and the whole ledger.

> **Claim:** private ownership coordination and intent execution with no mandatory privacy-contract call.
> We never claim that usage is undetectable.

**Status:** custody, HPKE and withdrawal integration are implemented and tested. The deployed Nitro service serves attestation and runs an unfunded custody self-test. Full API mounting, live KMS provisioning and public HTTPS remain open.

## Team

| Person | Workstream | Brief |
| --- | --- | --- |
| Felix | TEE and custody | [docs/roles/felix-tee.md](docs/roles/felix-tee.md) |
| Shreyas | API and accounting | [docs/roles/shreyas-api.md](docs/roles/shreyas-api.md) |
| Apurva | On-chain and execution | [docs/roles/apurva-onchain.md](docs/roles/apurva-onchain.md) |
| Pradnyesh | Frontend and web3 integrations | [docs/roles/pradnyesh-frontend.md](docs/roles/pradnyesh-frontend.md) |

## Documentation

Start at [docs/README.md](docs/README.md). Open conflicts and decisions are in [docs/decisions/](docs/decisions/README.md).

## Repo layout

| Path | What | Owner |
| --- | --- | --- |
| `apps/web/` | Next.js frontend | Pradnyesh |
| `services/enclave/` | The TEE service | Felix, Shreyas, Apurva (per module) |
| `packages/shared/` | Types, EIP-712 definitions, constants | Shreyas |
| `contracts/` | Optional EnclaveRegistry (Foundry) | Apurva |
| `scripts/` | Inventory seeding, demo fixture | Apurva |
| `test/` | Vitest suites and fork tests | Everyone |
| `FEEDBACK.md` | Required by the Uniswap prize | Pradnyesh |

## Getting started

Requires Node 20+, pnpm and Foundry.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Variables are described in [docs/deployment.md](docs/deployment.md).

## Uniswap integration

Swaps run through the Uniswap Trading API and Universal Router, from custody addresses not linked to the user. Feedback is in [FEEDBACK.md](FEEDBACK.md).

**Proof it works:** a real swap on Sepolia, 0.001 ETH to 26.172175 USDC ([transaction](https://sepolia.etherscan.io/tx/0x350ea3b0af02aeb7cb56c9bc7a00c2e8f210e0f7d9193734a6a6dd62e88ea557)). It used a stand-in signer and journal, because the enclave's signing guard does not allow swaps yet.

### Contracts used (Sepolia)

We deploy no contracts of our own.

| Contract | Address |
| --- | --- |
| Universal Router 2.1.2 | [`0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`](https://sepolia.etherscan.io/address/0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3) |
| WETH | [`0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`](https://sepolia.etherscan.io/address/0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14) |
| USDC, the output token | [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |

### Where the integration is

| What | Code |
| --- | --- |
| Calling the Trading API | [`uniswap.ts:73`](services/enclave/src/uniswap.ts#L73) |
| Checking prices from quotes | [`price-poller.ts:86`](services/enclave/src/price-poller.ts#L86) |
| Running a swap | [`executor.ts:371`](services/enclave/src/executor.ts#L371) |
| Requesting a quote for a swap | [`executor.ts:422`](services/enclave/src/executor.ts#L422) |
| Checking the router calldata before signing | [`executor.ts:452`](services/enclave/src/executor.ts#L452), [`swap-calldata.ts:55`](services/enclave/src/swap-calldata.ts#L55) |
| Simulating the swap | [`executor.ts:469`](services/enclave/src/executor.ts#L469) |
| Sending the swap | [`executor.ts:531`](services/enclave/src/executor.ts#L531) |
| Reading the output from the receipt | [`executor.ts:568`](services/enclave/src/executor.ts#L568) |
| Tests, including real Sepolia responses | [`executor-intent.test.ts`](services/enclave/test/executor-intent.test.ts), [`swap-calldata.test.ts`](services/enclave/test/swap-calldata.test.ts) |

### Check it yourself

Needs Foundry, and `.env` set up as in [scripts/README.md](scripts/README.md) for the last two commands.

```bash
pnpm test
```

```bash
pnpm smoke:quote
```

```bash
pnpm smoke:swap
```

## Trust assumptions

The operator, KMS policy administrator and TEE hardware are trusted. There is one node, with no key handover, threshold custody or slashing. External encrypted state is implemented; live KMS recovery remains unverified. Complete rollback of custody and journal storage requires an external trusted checkpoint. Journal loss still loses accounting state.

## Known leaks

- Deposit and payout amounts and timing are visible on-chain.
- The payout edge to the destination wallet is visible.
- Gas top-ups from one funder publicly link custody EOAs.
- Custody EOA addresses become public once funded.
- The enclave's own RPC reads are visible to its RPC provider. Anon-RPC covers the browser only.
- Uniswap's Trading API sees each swap request and price poll, and our API key identifies us. It never sees who the user is.
- The anonymity set is small, with 4 to 6 EOAs and a few demo users.

## Licence

[MIT](LICENSE)
