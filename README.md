# Cloakroom

A TEE private intent network. Deposit ETH, hold a confidential balance, submit a conditional swap, have it executed from pooled inventory, and withdraw to an existing wallet. One attested TEE node holds every key and the whole ledger.

> **Claim:** private ownership coordination and intent execution with no mandatory privacy-contract call.
> We never claim that usage is undetectable.

**Status:** pre-build. Documentation and repo skeleton only. No application code yet.

## Team

| Person | Workstream | Brief |
| --- | --- | --- |
| Felix | TEE and custody | [docs/roles/felix-tee.md](docs/roles/felix-tee.md) |
| Shreyas | API and accounting | [docs/roles/shreyas-api.md](docs/roles/shreyas-api.md) |
| Apurva | On-chain and execution | [docs/roles/apurva-onchain.md](docs/roles/apurva-onchain.md) |
| Pradnyesh | Frontend and web3 integrations | [docs/roles/pradnyesh-frontend.md](docs/roles/pradnyesh-frontend.md) |

## Documentation

Start at [docs/README.md](docs/README.md). Open conflicts and decisions are in [docs/decisions.md](docs/decisions.md).

## Repo layout

| Path | What | Owner |
| --- | --- | --- |
| `apps/web/` | Next.js frontend | Pradnyesh |
| `services/enclave/` | The TEE service | Felix, Shreyas, Apurva (per module) |
| `packages/shared/` | Types, EIP-712 definitions, constants | Shreyas |
| `workflows/price-report/` | Chainlink CRE workflow | Pradnyesh |
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

## Trust assumptions

Users trust the operator and the TEE hardware. There is one node, with no key handover, threshold custody or slashing. If the journal is lost, state is lost: there is no backup in the MVP.

## Known leaks

- Deposit and payout amounts and timing are visible on-chain.
- The payout edge to the destination wallet is visible.
- Gas top-ups from one funder publicly link custody EOAs.
- Custody EOA addresses become public once funded.
- The enclave's own RPC reads are visible to its RPC provider. Anon-RPC covers the browser only.
- The CRE workflow sees prices, never intent contents.
- The anonymity set is small, with 4 to 6 EOAs and a few demo users.

## Licence

[MIT](LICENSE)
