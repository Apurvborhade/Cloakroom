# Uniswap developer feedback

Feedback from building Cloakroom at ETHGlobal Mumbai. Every point below comes from something we saw while integrating, and we say where we are unsure.

## What we built

Cloakroom is a private intent network. Users hold a confidential balance inside a TEE and sign a conditional swap, such as "swap 0.1 ETH to USDC if the price reaches X". When the condition is met, the enclave runs the swap through Uniswap from a custody address the user is not linked to.

| What we used | How |
| --- | --- |
| Trading API, `POST /quote` | Price checks, swap quotes and the swap transaction |
| Universal Router 2.1.2 on Sepolia | Executes each swap |
| V2 and V3 routes | The routes we could verify before signing |

**Result:** a real swap settled on Sepolia. 0.001 ETH became 26.172175 USDC, read back from the receipt's Transfer logs ([transaction](https://sepolia.etherscan.io/tx/0x350ea3b0af02aeb7cb56c9bc7a00c2e8f210e0f7d9193734a6a6dd62e88ea557)). The README links to the code.

## Why our use case is unusual

A service holds the keys and signs automatically, with no person checking a wallet prompt. So we treat every API response as untrusted, and must prove a transaction is safe before signing it. Most of our feedback comes from that requirement.

## What worked well

- **The swap transaction comes back with the quote.** `POST /quote` returned a ready `swapTransaction`, so one call gave us everything we needed. We never had to call a second endpoint.
- **Quotes work for any address.** Quotes came back for new addresses holding no funds, including `swapTransaction`. This let us check prices without sending our custody addresses to the API on every poll, which matters for a privacy product.
- **Native ETH input is simple.** `permitData` was null and `isTokenApprovalApplicable` was false, so a custody address needed no approvals or Permit2 signature. The router wrapped the ETH itself.
- **Speed.** Six quotes in a row took about 0.7 to 1.4 seconds each on Sepolia, and none were rejected.
- **The response explains itself.** `routeString`, `route` and `aggregatedOutputs` made it easy to see what a quote would do while debugging.

## What was hard

### 1. No simple way to verify a swap transaction (our biggest blocker)

`quote.output.recipient` and `quote.output.minimumAmount` describe what should happen, but nothing ties them to `swapTransaction.data`, which is what actually gets signed. `execute` returns nothing, so a simulation does not reveal the output or who receives it either. A bad response could pay someone else and still simulate cleanly.

We did not find a helper for this, so we wrote our own decoder for the Universal Router commands. Getting it right took real effort because **the minimum output lives in different places depending on the route:**

| Route | Commands we saw | Who is paid | Where the minimum is |
| --- | --- | --- | --- |
| Split across pools (0.1 ETH, default routing) | `WRAP_ETH`, 3 x `V3_SWAP_EXACT_IN`, 2 x `SWEEP` | Router, then `SWEEP` pays the recipient | `SWEEP`, while each swap has 0 |
| Single pool (0.001 ETH, V2 and V3 only) | `WRAP_ETH`, `V3_SWAP_EXACT_IN`, `SWEEP` | The swap pays the recipient directly | The swap's `amountOutMin` |

Our first live swap was refused by our own validator, because we had only seen the first shape. Nothing was lost, but we would not have known about the second shape without running it.

**Suggestion:** publish a small helper or documented recipe, such as `verifySwapCalldata(calldata, { recipient, tokenOut, minOut })`, or document the command patterns the API can return.

### 2. Small swaps default to V4, which is harder to verify

With default routing, a 0.001 ETH quote on Sepolia included a V4 route. We could not check V4 commands with our decoder, so those swaps would never have run. Setting `protocols` to `["V2", "V3"]` fixed this, and on one 0.001 ETH comparison the output was about 0.06% lower. We only found this by testing, because our integration worked with the earlier larger quote.

**Suggestion:** note in the docs that routes, and so calldata shapes, can change with the amount.

### 3. The default slippage is easy to miss

A quote sent without `slippageTolerance` came back with 2.5%, setting the minimum at about 2,565 USDC on a 2,631 USDC quote. An automated system that forgets this field accepts far more slippage than it may intend, with no error or warning. We now always send it.

**Suggestion:** make the default prominent in the docs, or have the response flag that a default was used.

### 4. Testnet prices do not track the market

On Sepolia, the WETH/USDC 0.05% pool priced ETH at about $26,060, while the Chainlink ETH/USD feed on Sepolia read about $2,255, roughly 11.6 times lower. We had planned to compare an external price with the Uniswap quote before executing, and at that gap every swap would have been blocked. We dropped the external price check, partly because of this, so our testnet demo cannot show that kind of protection.

We understand why testnet pools drift, and there may be no easy fix.

**Suggestion:** a note in the docs would have saved us time, and a pool kept near market price would make price-triggered apps easier to demonstrate.

### 5. Finding the right router address took some checking

The docs list several Universal Router addresses for Sepolia across different pages and versions. The supported chains page and the API response agreed on `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`, so that is the one we pinned. A service that pins an address needs to be sure it is the right one, and we only became sure by comparing against a live response.

**Suggestion:** state clearly which router the Trading API targets on each chain, which the supported chains page mostly does already.

## What we did not test

So this feedback is not read as more than it is:

- ERC-20 input swaps, Permit2 flows and UniswapX. Our custody addresses only sign ordinary transactions, and the docs list no testnet for UniswapX.
- V4 hooks, or the `/swap` endpoint, since `/quote` already gave us a transaction.
- Long-running rate limits. We only ran short bursts, so we cannot comment on them.
- Mainnet. Everything here happened on Sepolia.
- Our real signer. The swap above used a stand-in signer and journal, because the enclave's signing guard does not allow swaps yet.
