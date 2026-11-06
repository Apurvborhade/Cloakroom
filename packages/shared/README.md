# packages/shared

Types, EIP-712 definitions and constants, shared so the browser signs exactly what the enclave verifies.

**Owner:** Shreyas. Announce every change to the team. See [docs/api.md](../../docs/api.md).

## Margin accounting contract

[MarginAccounting](src/types/margin.ts) is the API/executor contract. See the [backend handoff](../../docs/margin-interface.md) for signed commands and execution results.

[MarginFunding](../../services/enclave/src/margin-funding.ts) implements supply, redemption and lending queries against the existing ledger. Pass the same journal and queue used by withdrawals. Authenticate commands first; their owner and nonce identify retries. `replayLedger` restores funding claims and reservations alongside ordinary balances.

`reserveOpen` locks USDC collateral and lending liquidity; it does not authorize a swap or issue spendable debt. Full risk checks and position settlement remain separate work. Until execution is authorized, `releaseOpen` returns those holds. Supply and redemption move existing claims; physical inventory alone never creates lending liquidity.
