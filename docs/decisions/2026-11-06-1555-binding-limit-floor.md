# Binding limit floor

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Apurva, Felix | Phase 3 |

## Problem

An order says "sell if the price is at least X". Taking slippage off the limit meant it could fill below X: 0.1 ETH at a limit of 3,000 USDC per ETH, with 0.5% slippage, could pay 298.5 USDC. Felix asked for a binding limit.

## Decision

1. **The floor is amount times limit price, with no slippage taken off.** 0.1 ETH at 3,000 USDC per ETH gives 300 USDC. `limitFloor` rounds up, so rounding can't allow a fill just under the limit.

   ```ts
   floor = ceil(amountIn * triggerPrice * 10n ** outDecimals / 10n ** 36n);
   ```

2. **Slippage still applies to the current quote, but only down to the floor.** The API builds the calldata from the slippage we request, so when the order's slippage would go below the floor, the executor asks for a new quote using only the room above it, rounded down.

   At a quote of 301 USDC, 0.5% would give 299.5, so the executor asks again with 0.33%, which gives about 300.01.

3. **If there is less than 1 basis point of room, the order stays pending.** It's retried on the next price check. A swap with no slippage at all would be likely to revert, and a revert fails the order and costs gas.

4. **The calldata check enforces the floor separately from `minOut`.** Split swaps keep their rounding tolerance against `minOut`, but get none against the floor.

5. **Only "price at or above" orders can run.** "At or below" orders have no floor, so the executor fails them with `UNSUPPORTED_COMPARATOR` and releases the funds.

## Consequences

- An order can stay pending when the price only just reaches its limit.
- When the price is just above the limit, the public on-chain minimum sits close to the limit, which can reveal it. This replaces the earlier rule that the minimum must never equal the floor: a binding limit takes priority here. The swap's timing and price already hint at the limit.
- The limit holds after our fee, as Felix decided: `limitFloor` raises the floor by `FEE_BPS`, so a 300 USDC limit needs about 300.3 USDC of output at 10 bps.
- `POST /intents` refuses comparator 1 when the order is created, so the user gets an error straight away. `IntentStore` and the shared schema still accept it.
- `KeyManager` also checks the floor before signing, using the journaled order and not the quote.
