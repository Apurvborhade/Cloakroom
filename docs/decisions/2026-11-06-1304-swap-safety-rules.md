# Swap safety rules

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Apurva, Felix | Phase 2 |

## Problem

The spec says to run the Trading API's transaction through `eth_call` and require the simulated output to be at least `minOut`. `execute` on Universal Router returns nothing, so a simulation cannot show the output or who receives it. A bad API response could pay someone else and still simulate cleanly.

## Decision

The [binding limit floor](2026-11-06-1555-binding-limit-floor.md) adds a second minimum to these rules, with no rounding tolerance.

1. **Read the calldata.** `assertSafeSwapCalldata` decodes the router commands before signing, and allows only `WRAP_ETH`, `V3_SWAP_EXACT_IN`, `V2_SWAP_EXACT_IN` and `SWEEP`. The router enforces each minimum on-chain. The live API has returned three shapes, and only these pass:
   - **Through the router:** every swap leaves its output in the router, and exactly one `SWEEP` pays the output token to the custody EOA with a minimum of at least `minOut`.
   - **One direct swap:** a swap pays the custody EOA directly, ends in the output token, and has a minimum of at least `minOut`.
   - **Several direct swaps:** each pays the custody EOA directly and ends in the output token, and their minimums add up to at least `minOut`. Splitting rounds each part down, so the total may fall short by one unit for each extra swap, and no more.
2. **Request only V2 and V3 routes.** The API defaults to V4 for some swaps, and V4 commands cannot be checked this way, so quotes for swaps set `protocols` to `["V2", "V3"]`. On Sepolia this returned nearly the same price.
3. **ETH to the configured output token only in v1.** An ERC-20 input needs a Permit2 signature, which custody EOAs cannot produce.
4. **Simulate as well.** `eth_call` still catches swaps that would revert.
5. **Anything wrong before signing leaves the intent pending,** to retry on the next price check. A refused signature fails it and releases the funds.

## Consequences

- If the API stops offering V2 or V3 routes for a pair, its intents stay pending rather than running unchecked.
- `KeyManager` must allow swaps: see the role document for Felix.
- A price from one provider can still be wrong: see [Drop Chainlink CRE](2026-11-06-0358-drop-chainlink-cre.md).
