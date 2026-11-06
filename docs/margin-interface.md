# Margin interface

The API and execution side of margin trading, and what it needs from accounting. Written for Felix, who owns accounting. The interface is a proposal: change it where accounting needs something different.

Everything is off unless `MARGIN_ENABLED=true`. With it off, the routes don't exist and the signer refuses margin operations.

## How the two sides meet

The interface is [`MarginAccounting`](../packages/shared/src/types/margin.ts). `server.ts` takes a real one through the `marginAccounting` boot option. Without one, simulation uses [`MockMarginAccounting`](../services/enclave/src/margin-mock.ts), and a non-simulated boot fails.

1. The route verifies the signature and spends the nonce, or the liquidation monitor passes a candidate.
2. `prepareOpen`, `prepareClose` or `prepareLiquidation` checks the risk, reserves funds, and journals `MARGIN_OP_APPROVED`.
3. The executor picks an address, quotes, checks the calldata, signs and broadcasts, journaling `MARGIN_OP_BROADCAST`.
4. The executor calls `settle` with amounts read from the receipt, or `fail`. Each must journal `MARGIN_OP_SETTLED` or `MARGIN_OP_FAILED` and apply the result once.

A broadcast with no receipt calls neither, and the funds stay reserved. On restart, the executor settles whatever has a receipt, and calls `fail` with `INTERRUPTED` on anything approved but never broadcast. Accounting must rebuild its own state from the journal before that runs.

`InMemoryLedger.apply` ignores the four margin events, so margin balances are entirely accounting's.

## Routes

All are `POST`, encrypted, and signed by the owner. The two queries take a session key instead, because session keys stay read-only.

| Route | Signed type |
| --- | --- |
| `/margin/lending/supply`, `/margin/lending/redeem` | `MarginSupply`, `MarginRedeem` |
| `/margin/positions/open` | `MarginOpen` |
| `/margin/positions/collateral` | `MarginAddCollateral` |
| `/margin/positions/close` | `MarginClose` |
| `/margin/positions`, `/margin/lending` | `SessionQuery` |

Open and close answer once approved, without waiting for the chain. Poll `/margin/positions` for the result.

## Signer changes to review

These are in `keys.ts`, which is yours.

- **`margin:` operations** must match a journaled `MARGIN_OP_APPROVED` with no earlier broadcast or result. They check the expiry, router, amounts and minimum, and refuse the owner's deposit addresses. No fresh user signature exists for a liquidation, so the approval event is the only authority for it.
- **`approval:` operations** can only be the two exact approvals below.

## USDC to ETH

Tested against the real Trading API and Universal Router on Sepolia.

- With no approvals, a quote returns `permitData` and no `swapTransaction`.
- After `USDC.approve(Permit2)` and `Permit2.approve(USDC, router)`, the same request returns a normal transaction, with commands `00 0c 04`: swap into the router, unwrap to the EOA, sweep.

So each custody address approves once, on its first USDC sale, and we never sign a permit. The allowance is unlimited but only the router has it, and the router can only pull funds when that address calls it. `assertSafeTokenToNativeCalldata` checks this pattern, including that the swap amounts add up to the approved amount. The check for ETH-input swaps is unchanged.

On a local fork of Sepolia, this swap spent exactly the approved 5 USDC and paid out what the receipt reports. The executor reads ETH received from WETH's `Withdrawal` event, because paying out ETH emits no `Transfer`.

## Decisions to make together

The mock uses these so the rest could be built. They are suggestions.

| Decision | Mock uses |
| --- | --- |
| Meaning of 4x | Position size divided by collateral, so a long borrows 3x and a short borrows 4x |
| Maintenance margin | 10% of current position value: a long liquidates at -16.7%, a short at +13.6% |
| Interest and fees | None. A simple fixed rate is the suggestion |
| Price | The last ETH to USDC quote from the existing price check, with no freshness or spread check, because this is testnet only |
| Liquidation limit | At most 3% worse than the last price |
| Losses past collateral | Recorded as `shortfall` only. The suggestion is that lenders share them |

## Old prices

If price checks stop working, margin keeps using the last price, for both new positions and liquidations. A position can then be opened or liquidated on a price that is no longer true. The swap's own quote still has to meet the minimum output, so a badly wrong price makes the swap fail, not fill badly. Mainnet would need a freshness rule.

## Things accounting has to handle

- **Closing a short overbuys.** The API only does exact-input, so the amount of USDC needed for a fixed ETH debt is an estimate. The mock adds 2% and leaves spare ETH. Accounting must credit that spare ETH and treat too little as a shortfall.
- **Physical funds.** A swap must come from one address holding the whole amount and its gas reserve. Otherwise it fails with `NO_INVENTORY`, and a liquidation retries on the next price. This needs position limits, and possibly moving funds between addresses, which is public.
- **Approval gas** is booked with `FEE_BOOKED`, using an `approval:` operation ID that belongs to no position.
- **USDC collateral** can't be deposited yet, because the watcher only credits ETH. A user can deposit ETH and swap to USDC first.

## Address rule

Margin swaps only avoid the owner's deposit addresses, and don't link the address they use. The wider spot rule would let a few trades use up every address, which could block a liquidation or that user's withdrawals. The cost is that a user's payout can come from an address that ran their margin swap. That link isn't public unless someone can already tie the swap to them, but it is weaker than the spot rule.

## Demo

Sepolia's pool is too deep to move on cue. On the buy side, 10,000 USDC moved the price only about 0.4%. So the demo needs the `riskPrices` boot option, which replaces the price margin uses and is refused outside simulation. The liquidation then executes against the real pool at the real price, and the demo must say the price drop was simulated.

`pnpm test:margin` runs all of this on a Sepolia fork: see [scripts/README.md](../scripts/README.md).

## Known leaks

- A position's open and close amounts can be matched on-chain, and 4x swaps are larger and easier to spot.
- A large swap right after a price move can look like a liquidation.
- Liquidation swaps go through the public mempool, so on mainnet they could be front-run.
