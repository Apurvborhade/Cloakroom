# packages/shared

Types, EIP-712 definitions and constants, shared so the browser signs exactly what the enclave verifies.

**Owner:** Shreyas. Announce every change to the team. See [docs/api.md](../../docs/api.md).

## Margin accounting contract

[MarginAccounting](src/types/margin.ts) is the API/executor contract. See the [backend handoff](../../docs/margin-interface.md) for signed commands and execution results.

[MarginFunding](../../services/enclave/src/margin-funding.ts) implements supply, redemption and lending queries against the existing ledger. Pass the same journal and queue used by withdrawals. Authenticate commands first; their owner and nonce identify retries. `replayLedger` restores funding claims and reservations alongside ordinary balances.

`reserveOpen` only locks funding; `releaseOpen` refuses an authorized operation. [JournaledMarginAccounting](../../services/enclave/src/margin-accounting.ts) adds atomic approval, settlement, collateral top-ups and liquidation for longs and shorts. `main.ts` selects it when margin is enabled.
