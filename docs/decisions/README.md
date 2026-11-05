# Decisions

One decision per file. This page is the index, so check here first.

## Open

| Decision | Owner | Needed by |
| --- | --- | --- |
| [Dockerfile and pnpm](2026-11-06-0151-dockerfile-pnpm.md) | Felix | Phase 0 |
| [Fee model](2026-11-06-0151-fee-model.md) | Shreyas, Apurva | Phase 1 |
| [Missing EIP-712 types](2026-11-06-0151-missing-eip712-types.md) | Shreyas, Pradnyesh | Phase 1 |
| [Journal cannot replay every state](2026-11-06-0151-journal-replay-events.md) | Shreyas | Phase 1 |
| [Meaning of pending](2026-11-06-0151-pending-balance.md) | Shreyas | Phase 1 |
| [Salt hash and key lifetime](2026-11-06-0151-salt-and-key-lifetime.md) | Felix, Pradnyesh | Phase 1 |
| [Admin EOAs endpoint](2026-11-06-0151-admin-eoas-endpoint.md) | Felix, Shreyas | Phase 1 |
| [Non-ETH deposits](2026-11-06-0151-non-eth-deposits.md) | Shreyas, Apurva | Phase 1 |
| [Withdrawal status endpoint](2026-11-06-0331-withdrawal-status-endpoint.md) | Shreyas, Pradnyesh | Phase 1 |

## Proposed, waiting for confirmation

| Decision | Owner | Needed by |
| --- | --- | --- |
| [Relationship to hide](2026-11-06-0151-relationship-to-hide.md) | Team | Before hour 0 |
| [Withdrawal credential](2026-11-06-0151-withdrawal-credential.md) | Team | Before hour 0 |
| [Initial inventory](2026-11-06-0151-initial-inventory.md) | Apurva | Before hour 0 |
| [Deposit journal events](2026-11-06-0258-deposit-journal-events.md) (`watcher.ts` side done) | Shreyas, Apurva | Phase 1 |

## Accepted

| Decision | Owner | Needed by |
| --- | --- | --- |
| [TEE platform: AWS Nitro Enclaves](2026-11-06-0151-tee-platform.md) | Felix | Phase 0 |
| [Network: Sepolia (pending a Trading API quote test)](2026-11-06-0229-network-sepolia.md) | Apurva | Phase 0 |
| [Drop Chainlink CRE](2026-11-06-0358-drop-chainlink-cre.md) | Apurva, Pradnyesh, Shreyas | Phase 2 |
| [Open-source licence](2026-11-06-0151-open-source-licence.md) | Team | Before hour 0 |
| [The spec wins over the plan](2026-11-06-0151-spec-over-plan.md) | Team | Settled |
| [Files with no owner](2026-11-06-0151-unowned-files.md) | Shreyas | Phase 0 |

## Superseded

| Decision | Replaced by |
| --- | --- |
| [Sepolia reference price](2026-11-06-0229-sepolia-reference-price.md) | [Drop Chainlink CRE](2026-11-06-0358-drop-chainlink-cre.md) |
| [Oracle body format](2026-11-06-0151-oracle-body-format.md) | [Drop Chainlink CRE](2026-11-06-0358-drop-chainlink-cre.md) |

## Adding a decision

1. Get the timestamp:

   ```bash
   date +%Y-%m-%d-%H%M
   ```

2. Copy [`_template.md`](_template.md) to `<timestamp>-short-name.md`, for example `2026-11-07-1430-fee-model-change.md`.
3. Fill it in, and add a row to the matching table above.

## Changing a decision

- When an open or proposed decision is settled, set its status to Accepted, rename Proposal to Decision, and move its row here.
- Once a decision is Accepted, do not rewrite it. Add a new file, and set the old file's status to `Superseded by <new file>`.

The timestamp in a filename is when the decision was first recorded. It does not change later.

## Still to verify against provider docs

These are facts to check, not decisions.

| Item | Owner |
| --- | --- |
| TEE provider access, pricing, attestation format, how a quote is fetched and how secrets reach the enclave | Felix |
| HPKE library choice (for example `@hpke/core`) works in both the browser and Node, in our build | Felix |
| Exact swap flow: wrap step from ETH, Permit2 approval from an ERC-20 | Apurva |
| The Trading API returns a Sepolia quote for WETH to USDC, and the router in its calldata matches `UNIVERSAL_ROUTER_ADDRESS` | Apurva |
| A Sepolia RPC URL works through an Anon-RPC worker, and the provider accepts that traffic. Some providers refuse Tor | Pradnyesh |
| How the Anon-RPC harness plugs into viem | Pradnyesh |
| Trading API rate limits allow one quote per `PRICE_POLL_INTERVAL_SEC` | Apurva |
