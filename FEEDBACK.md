# Uniswap developer feedback

Feedback from building Cloakroom at ETHGlobal Mumbai. Every point below comes from something we saw while integrating, and we say where we are unsure.

## What we built

Cloakroom is a private intent network. Users hold a confidential balance inside a TEE and sign a conditional swap, such as "swap 0.1 ETH to USDC if the price reaches X". When the condition is met, the enclave runs the swap through Uniswap from a custody address the user is not linked to.

| What we used | How |
| --- | --- |
| Trading API, `POST /quote` | Price checks, swap quotes and the swap transaction |
| Universal Router 2.1.2 on Sepolia | Executes each swap |
| V2 and V3 routes | The routes we could verify before signing |
| Permit2 | One-time on-chain approvals, so a custody address can sell USDC |

**Result:** real swaps settled on Sepolia. The first, using a stand-in signer, turned 0.001 ETH into 26.172175 USDC, read back from the receipt's Transfer logs ([transaction](https://sepolia.etherscan.io/tx/0x350ea3b0af02aeb7cb56c9bc7a00c2e8f210e0f7d9193734a6a6dd62e88ea557)). A later swap went through the real API and our real signer: 0.001 ETH became 25.188361 USDC ([transaction](https://sepolia.etherscan.io/tx/0x749e037765df655095b4205bfee238bb9c1a70585bc16371e6f4728dca829d9b)). The README links to the code.

## Why our use case is unusual

A service holds the keys and signs automatically, with no person checking a wallet prompt. So we treat every API response as untrusted, and must prove a transaction is safe before signing it. Most of our feedback comes from that requirement.

## What worked well

- **The swap transaction comes back with the quote.** `POST /quote` returned a ready `swapTransaction`, so one call gave us everything we needed. We never had to call a second endpoint.
- **Quotes work for any address when selling ETH.** Quotes came back for new addresses holding no funds, including `swapTransaction`. This let us check prices without sending our custody addresses to the API on every poll, which matters for a privacy product. Selling a token is different: see point 6.
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
| Split, paying directly (about 0.0004 ETH, V2 and V3 only) | `WRAP_ETH`, 2 x `V3_SWAP_EXACT_IN`, `SWEEP` | Each swap pays the recipient directly | Each swap's `amountOutMin`, which together came to 1 unit below `minimumAmount` |

Our validator refused live transactions twice, because it had not yet seen the second and third shapes. Nothing was lost either time, and we only learned about them by running real swaps at different sizes.

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

### 6. A token sale can return a quote with no transaction

Selling USDC for ETH from an address with no approvals returned a normal quote with `permitData`, `permitTransaction: null` and no `swapTransaction`. Nothing said why, so code expecting a transaction simply gets none.

A custody service would have to add typed-data signing to use a permit. We tried on-chain approvals instead, `USDC.approve(Permit2)` then `Permit2.approve(USDC, router)` ([first](https://sepolia.etherscan.io/tx/0x15e4df580128e484dd31aff6d40a291394d2360794d08678c9641d175ed64202), [second](https://sepolia.etherscan.io/tx/0xff4874c3bc4a734220c538bdea20d7b665109122bcf8a319b3dfab8bab04b01b)). The same request then returned `permitData: null` and a normal `swapTransaction`. That suits us well, but we only found it by experimenting.

It also has a privacy cost for us. A usable transaction depends on the swapper's real approvals, so a token sale has to send the custody address to the API. A throwaway address, which we use for price checks, can't get one.

**Suggestion:** document the on-chain approval path, and have the response say why a transaction is missing.

### 7. This route adds another calldata shape, and limits the spend differently

| Route | Commands we saw | Who is paid | Where the minimum is |
| --- | --- | --- | --- |
| USDC to ETH, single pool, after approvals | `V3_SWAP_EXACT_IN`, `UNWRAP_WETH`, `SWEEP` | Router, then `UNWRAP_WETH` pays the recipient | `UNWRAP_WETH`, while the swap has 0 |

Selling ETH, the transaction value limits what can be spent. Selling a token, the value is 0 and the router pulls funds through Permit2, so we also add up the swap amounts in the calldata and check them against the approved amount. This adds to point 1.

### 8. ETH output is hard to read from a receipt

ETH paid out leaves no `Transfer` log, so the approach we used for USDC doesn't work. We read the router's `Withdrawal` event on WETH instead. On a local fork of Sepolia, that matched the swapper's actual balance change after gas, but we worked it out ourselves and don't know whether it holds for every route.

**Suggestion:** document how to read the output of a swap that ends in ETH.

### 9. Buy and sell quotes disagreed on testnet

In one round of quotes, selling ETH got about 25,820 USDC per ETH while buying cost about 25,660, so a round trip looked profitable. Sepolia's four USDC/WETH V3 pools ranged from about 25,645 to 25,932 at the time. We think this comes from testnet pools drifting apart, as in point 4, and it means a single quote direction isn't a reliable reference price here.

## What we did not test

So this feedback is not read as more than it is:

- UniswapX, and permit signatures. Our custody addresses only sign ordinary transactions, and the docs list no testnet for UniswapX.
- A token sale on live Sepolia. We ran the USDC to ETH swap on a local fork of Sepolia, using live Trading API calldata and Uniswap's real contracts. The approvals above were real, but that wallet held no USDC.
- V4 hooks, or the `/swap` endpoint, since `/quote` already gave us a transaction.
- Long-running rate limits. We only ran short bursts, so we cannot comment on them.
- Mainnet. Everything here happened on Sepolia or a local fork of it.
