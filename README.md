# Cloakroom

**Swap and withdraw without linking your new wallet to the one you deposited from.**

Cloakroom is a private intent network. You deposit ETH, hold a confidential balance, and sign an order such as "swap 0.1 ETH to USDC if the price reaches X". A trusted execution environment (TEE) runs the swap from a pooled address you never funded, then pays out to any wallet you choose. There is no mandatory privacy contract, so on-chain it looks like ordinary transfers and swaps.

> **What we claim:** private ownership coordination and intent execution, with no mandatory privacy-contract call.
>
> **What we don't claim:** that usage is undetectable, or anonymity. See [Known leaks](#known-leaks).

Built for ETHGlobal Mumbai.

## How it works

```mermaid
flowchart LR
  alice["Alice's wallet"] -- "ETH" --> deposit["Deposit address"]
  alice -. "signed, encrypted order" .-> tee

  subgraph tee["TEE: holds every key and the private ledger"]
    ledger["Who owns what"]
    guard["Signing guard"]
  end

  tee -- "signs" --> pool["Pooled address"]
  pool -- "swap" --> uniswap["Uniswap"]
  pool -- "payout" --> fresh["Alice's new wallet"]
```

1. **Deposit.** Alice sends ETH to an address the enclave assigns. The enclave credits her private balance.
2. **Order.** Alice signs a conditional swap with her existing wallet. The order and its trigger price stay inside the enclave.
3. **Swap.** When the price is met, the enclave swaps from a pooled address not linked to her, through Uniswap.
4. **Withdraw.** Alice signs a withdrawal to a fresh wallet, and a different pooled address pays it.

On-chain, nothing connects Alice's deposit to the swap or the payout. Only the enclave knows they are the same person's. Her balance is a claim on the pool, like a bank balance, not specific coins.

## Status

This is a work in progress. The core works end to end from the command line, but the parts are not yet joined into one running service.

| Part | Status |
| --- | --- |
| Crediting deposits by balance | Working, run on Sepolia |
| Choosing unlinked addresses, and withdrawals | Working, run on Sepolia |
| Swaps through the Uniswap Trading API and router | Working, with [a real swap on Sepolia](https://sepolia.etherscan.io/tx/0x350ea3b0af02aeb7cb56c9bc7a00c2e8f210e0f7d9193734a6a6dd62e88ea557) |
| Checking Uniswap's calldata before signing | Working, tested on real responses |
| Recovery after a restart | Working, tested on a local chain |
| Signed requests, replay protection, ledger, encrypted journal | Working, tested |
| Attestation and custody signer | Deployed Nitro service serves attestation and runs an unfunded self-test |
| Signer allowing swaps | Not built. Swap runs so far use a stand-in signer |
| Intent store and API routes | Not built |
| Boot file joining everything | Not built |
| Frontend | In progress, not yet connected |
| Anon-RPC | Not built |
| Live KMS provisioning, public HTTPS | Not done |

## Try it

You need Node 20+, pnpm and [Foundry](https://getfoundry.sh).

```bash
pnpm install
```

Run the whole demo on a local chain. Two users deposit, one swaps and withdraws to a new wallet, and replay, wrong-destination and double-spend attacks are rejected.

```bash
pnpm demo:local
```

It uses a mock Uniswap router, a stand-in signer and intent store, and no TEE, and it says so when it runs.

Run the tests:

```bash
pnpm test
```

Three tests in `kms-sealing.test.ts` and `sealed-state.test.ts` currently fail on macOS.

To run against real Sepolia, or to see every command, read [scripts/README.md](scripts/README.md). Settings are described in [docs/deployment.md](docs/deployment.md).

## Repo layout

| Path | What | Owner |
| --- | --- | --- |
| `services/enclave/` | The TEE service, and its scripts and tests | Felix, Shreyas, Apurva |
| `packages/shared/` | Types, EIP-712 definitions, schemas | Shreyas |
| `frontend/` | Next.js app | Pradnyesh |
| `infra/nitro/` | AWS Nitro deployment | Felix |
| `scripts/` | Attestation verification, and script docs | Felix, Apurva |
| `docs/` | Plans, decisions and role briefs | Everyone |
| `FEEDBACK.md` | Uniswap developer feedback | Apurva |

## Team

| Person | Workstream | Brief |
| --- | --- | --- |
| Felix | TEE and custody | [docs/roles/felix-tee.md](docs/roles/felix-tee.md) |
| Shreyas | API and accounting | [docs/roles/shreyas-api.md](docs/roles/shreyas-api.md) |
| Apurva | On-chain and execution | [docs/roles/apurva-onchain.md](docs/roles/apurva-onchain.md) |
| Pradnyesh | Frontend and web3 integrations | [docs/roles/pradnyesh-frontend.md](docs/roles/pradnyesh-frontend.md) |

Start with [docs/README.md](docs/README.md). Decisions and open questions are in [docs/decisions/](docs/decisions/README.md).

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
| Checking the router calldata before signing | [`executor.ts:452`](services/enclave/src/executor.ts#L452), [`swap-calldata.ts:56`](services/enclave/src/swap-calldata.ts#L56) |
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

## CROPS

- **Censorship resistant:** weak today. One operator runs the only node and holds the keys. If it goes away or refuses a user, their funds are stuck. There is no key handover or escape path in this version.
- **Open source:** MIT licensed. `pnpm demo:local` runs from this repo alone. Running the full service is not yet possible, because it is not yet joined together.
- **Private:** the lead property. See below for what each party learns.
- **Secure:** keys are generated inside the enclave and never leave it. Users keep their own wallet keys, but custody keys are not on the user's device, because the enclave must sign without them. Every signed request is checked for replay and tampering, and Uniswap's calldata is checked before signing. Trust assumptions are below.

| Party | What it learns |
| --- | --- |
| The enclave | Everything. This is why attestation matters |
| The operator | Nothing about users, if the TEE holds. The enclave's public addresses, like anyone |
| Anyone reading the chain | Deposits to custody addresses, swaps and payouts, with amounts and timing. Not who they belong to |
| Our RPC provider | Which addresses the enclave reads, and the transactions it sends |
| Uniswap | Each swap's amount and custody address, plus price polls from throwaway addresses. Not who it is for |
| Analytics or trackers | Nothing. The client should include none |

## Trust assumptions

The operator, KMS policy administrator and TEE hardware are trusted. There is one node, with no key handover, threshold custody or slashing. External encrypted state is implemented; live KMS recovery remains unverified. Complete rollback of custody and journal storage requires an external trusted checkpoint. Journal loss still loses accounting state.

## Known leaks

- Deposit and payout amounts and timing are visible on-chain.
- The payout edge to the destination wallet is visible.
- Gas top-ups from one funder publicly link custody EOAs.
- Custody EOA addresses become public once funded.
- The enclave's own RPC reads are visible to its RPC provider. Anon-RPC, once added, covers the browser only.
- Uniswap's Trading API sees each swap request and price poll, and our API key identifies us. It never sees who the user is.
- The anonymity set is small, with 4 to 6 EOAs and a few demo users.

## Licence

[MIT](LICENSE)
