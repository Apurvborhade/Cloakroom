# Non-ETH deposits in v1

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Shreyas, Apurva | Phase 1 |

## Decision

1. **ETH deposits:** Native ETH deposits remain supported.
2. **USDC deposits:** Allow the configured USDC token only together with ETH for gas, sent to the same assigned deposit address. Both deposits must be confirmed before accepting the USDC deposit.
3. **Other tokens:** Reject unsupported assets with `UNSUPPORTED_ASSET`.

## Implementation status

The current schema and watcher support ETH deposits only. USDC detection and the required ETH gas-budget check remain to be implemented.
