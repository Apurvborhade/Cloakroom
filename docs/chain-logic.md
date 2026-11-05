# Chain logic

Every on-chain operation follows one order: **reserve funds, journal, sign, broadcast, confirm, settle.** Nothing is signed before its journal entry exists.

## Intent lifecycle

```mermaid
stateDiagram-v2
  [*] --> Pending: amountIn reserved
  Pending --> Pending: no inventory or price mismatch, retried on next report
  Pending --> Executing: condition met, EOA held
  Pending --> Cancelled: user cancels, funds freed
  Pending --> Expired: expiry passes, funds freed
  Executing --> Done: settled, output credited
  Executing --> Failed: reverted, funds freed
```

Only a confirmed swap consumes the reserved funds. Every other ending gives them back to the owner's available balance.

## Deposits (`watcher.ts`)

1. The user signs a DepositRequest. The enclave verifies the signature and nonce, assigns a fresh unused EOA exclusively to this session, and returns its address and expiry.
2. The user sends ETH to that address with an ordinary transfer.
3. When a session opens, record the assigned EOA's native balance as its baseline.
4. On each new block, read that balance at `head - CONFIRMATIONS`. Credit the owner with the increase over what is already credited. Journal `DEPOSIT_CREDITED` first, then call `ledger.credit`.
5. Crediting by the recipient's balance, not by the sender, also works for smart-contract wallets. The sender is recorded but not required.
6. After expiry and one last check, close the session and relabel the EOA as inventory. Later transfers to a closed address are not credited and need a manual refund, which is out of scope.

## Inventory selection (`inventory.ts`)

```ts
function pick(token: Address, amt: bigint, exclude: Set<Address>): CustodyEOA | null {
  const need = token === NATIVE ? amt + GAS_RESERVE_WEI : amt;
  return eoas
    .filter(e => e.role === 'inventory' && !e.inFlight && !exclude.has(e.address))
    .filter(e => freeBalance(e, token) >= need)              // physical balance minus holds
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)             // least recently used first
    [0] ?? null;
}
```

`exclude` holds the EOAs that received this owner's deposits and ran this owner's earlier swaps. This is what separates the funded address from the executing address. With 4 to 6 EOAs the choice is small, so say that in the demo.

## Swap execution (`executor.ts`)

On each price report the enclave evaluates pending intents. When a condition is met:

1. Create an `opId`, call `inventory.hold`, and register the expected destination with the signing guard.
2. Get a quote for exactly `amountIn` from the Uniswap Trading API, with the chosen EOA as recipient. Set `minOut = quote.out * (1 - maxSlippageBps / 10000)`.
3. Compare the quote's implied price with the oracle price. If they differ by more than `PRICE_TOLERANCE_BPS`, stop and leave the intent pending.
4. Treat the API's transaction as untrusted data. Require `to === UNIVERSAL_ROUTER_ADDRESS`, run it through `eth_call`, and require the simulated output to be at least `minOut`.
5. Take the next nonce from a local per-EOA counter, sign, compute the hash from the serialized transaction, journal `EXEC_BROADCAST`, then send the raw transaction.
6. After `CONFIRMATIONS` blocks, sum the ERC-20 Transfer logs to the EOA in the receipt. That sum is `amountOut`.
7. Journal `EXEC_SETTLED`, then `ledger.consume` the reserved input and credit the owner's output minus the fee. Free the hold. Book the gas used to the fee ledger.

If the receipt shows a revert, journal `EXEC_FAILED` and release the reservation. Gas spent is the pool's cost.

**Token handling:** a swap that starts from ETH needs a wrap step. A swap that starts from an ERC-20 needs an approval, through Permit2 if using the Universal Router. Confirm the exact flow in the Uniswap docs before coding the executor.

## Withdrawal

1. `ledger.reserve`, journal `WITHDRAWAL_LOCKED`, then `inventory.pick` with the owner's EOAs excluded.
2. Build a native send, or `transfer(to, amount)` on the token contract. The destination is the signed `to`.
3. Sign, journal `WITHDRAWAL_BROADCAST`, send, wait for confirmations, then `ledger.consume` and journal `WITHDRAWAL_CONFIRMED`.
4. If `pick` returns nothing, release the lock and return `NO_INVENTORY`. There is no consolidation step in the MVP.

## Gas

Every inventory EOA keeps `GAS_RESERVE_WEI`, which reconcile excludes from claims. Top-ups from one funder link the EOAs publicly. List that as a known leak.

## Inventory seeding

Before the demo, fund 4 to 6 EOAs with ETH and the output token so withdrawals never depend on a lucky deposit. Say so openly in the demo.

## Recovery on boot (`executor.recover`)

For each broadcast without a terminal event, look up the receipt by hash.

- **Found:** settle or fail it.
- **Not found and the EOA nonce has not moved:** rebroadcast the identical raw transaction.
- **The nonce moved:** mark the operation failed for manual review.

This is why the raw signed transaction is stored in the BROADCAST journal events.

## Known gaps

- A stuck transaction is not fee-bumped in the MVP.
- A reorg deeper than `CONFIRMATIONS` after settlement is not handled.
