# Risks and fallbacks

| Risk | Fallback | Owner |
| --- | --- | --- |
| TEE setup eats the schedule | Run the same container outside a TEE, label it TEE-simulated in the UI and README, and make no confidentiality claim | Felix |
| No Uniswap liquidity on the chosen testnet | Run on an Anvil mainnet fork and call it a fork-based demonstration. Check first that this does not break the Anon-RPC integration | Apurva |
| Inventory shortage during the demo | Pre-seed 4 to 6 EOAs and reject cleanly when a request cannot be filled | Apurva |
| CRE access or setup problems | Let the enclave poll its own Uniswap quote and treat CRE as optional | Pradnyesh, Apurva |
| Anon-RPC only covers the browser | Route frontend reads only and list the enclave's reads as a leak | Pradnyesh |
| Tiny anonymity set with 2 to 3 demo users | Claim no anonymity. Use equal deposit sizes and varied delays, and say the set is small | Everyone |
| State loss on a single node | Journal only, no backup in the MVP, documented as a limit | Shreyas |
