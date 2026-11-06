# packages/shared

Types, EIP-712 definitions and constants, shared so the browser signs exactly what the enclave verifies.

**Owner:** Shreyas. Announce every change to the team. See [docs/api.md](../../docs/api.md).

## Margin accounting contract

[MarginAccounting](src/types/margin.ts) defines the internal API/executor handoff; its implementation follows separately. Amounts use token base units as `bigint`, USDC collateral uses 6 decimals, and timestamps use Unix seconds. Existing `PriceReport` prices use 18 decimals. Wire schemas and signatures remain separate.

After authenticating a command, pass its stable `opId` to accounting. `prepareOpen`, `prepareClose` and `prepareLiquidation` reserve funds and return bounded swap instructions. The executor supplies actual confirmed amounts and gas costs through `recordExecution`. Timeouts remain `unresolved`; only confirmed execution, a confirmed revert or proof that no swap was submitted can finish an operation. `recover` restores journal state and returns unfinished operations for the executor to resolve through the same method.

Supply, redemption and added collateral transfer existing ledger claims; they do not create deposits or send transactions. Query results are snapshots, and only accounting mutates balances, debt and positions. API routes must authenticate and restrict queries to the requesting owner; liquidation candidates still require accounting's health check.
