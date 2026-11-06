# Risks and fallbacks

| Risk | Fallback | Owner |
| --- | --- | --- |
| TEE setup eats the schedule | Run the same container outside a TEE, label it TEE-simulated in the UI and README, and make no confidentiality claim | Felix |
| No Uniswap liquidity on the chosen testnet | Run on an Anvil mainnet fork and call it a fork-based demonstration. Check first that this does not break the Anon-RPC integration | Apurva |
| Sepolia pool price is far from the market | Trigger prices follow the pool, and we say so in the demo | Apurva, Pradnyesh |
| No independent price source, so a bad pool could make a condition look met | Each swap is limited by its own quote, the owner's trigger price, slippage limit and simulation | Apurva |
| Inventory shortage during the demo | Pre-seed 4 to 6 EOAs and reject cleanly when a request cannot be filled | Apurva |
| Anon-RPC only covers the browser | Route frontend reads only and list the enclave's reads as a leak | Pradnyesh |
| Tiny anonymity set with 2 to 3 demo users | Claim no anonymity. Use equal deposit sizes and varied delays, and say the set is small | Everyone |
| State loss on a single node | Journal only, no backup in the MVP, documented as a limit | Shreyas |
