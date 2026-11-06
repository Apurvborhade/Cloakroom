# Uniswap feedback

Required by the Uniswap prize. Fill this in during the build with what worked, what did not, bugs, and documentation gaps in the Trading API and router.

Owner: Pradnyesh, using notes from Apurva. See [docs/prizes.md](docs/prizes.md).

## Notes from the integration (Apurva)

- **Default slippage:** without `slippageTolerance`, a Sepolia quote came back with 2.5%, so the minimum output was far lower than expected. It is easy to miss.
- **V4 routes by default:** small Sepolia swaps routed through V4, whose router commands are much harder for an integrator to verify. Setting `protocols` to `["V2", "V3"]` gave a decodable route at nearly the same price.
- **Verifying calldata:** we treat API responses as untrusted before a custody key signs them. We did not find a simple way to check a response's recipient and minimum output, so we decode the Universal Router commands ourselves.
- **What worked well:** quotes returned a ready `swapTransaction`, including for addresses with no funds, in about a second on testnet.
