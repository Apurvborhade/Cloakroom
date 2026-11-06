# Non-ETH deposits in v1

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas, Apurva | Phase 1 |

## Problem

The `DepositRequest` schema includes an `asset: Address` field, suggesting support for multi-token deposits. However, `DepositWatcher` operates via native balance checking (`eth_getBalance`), and does not monitor ERC-20 `Transfer` events for deposit EOAs.

## Existing behavior

The Zod wire schema in `packages/shared/src/schemas/api.ts` enforces `asset.toLowerCase() === NATIVE.toLowerCase()`.

## Decision

1. **Native ETH only in v1:** The enclave exclusively supports native ETH deposits in the MVP.
2. **Rejection of ERC-20 deposits:** Any `POST /deposit-session` request where `asset` is not the zero address (`0x0000000000000000000000000000000000000000`) is rejected with error code `UNSUPPORTED_ASSET`.
3. **Future expansion:** ERC-20 deposits require token approval and permit flows or log event filtering, which are deferred to v2.

## Alternatives considered

- **Supporting ERC-20 deposits via Transfer log polling:** Rejected for MVP due to added RPC overhead, approval management, and testing scope.

## Consequences

- Clear constraint for the frontend: users deposit ETH.
- Eliminates risk of uncredited ERC-20 transfers to deposit EOAs.
