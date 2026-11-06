# Recovery rules

| Status | Owner | Needed by |
| --- | --- | --- |
| Accepted | Apurva, Felix | Phase 3 |

## Problem

After a restart, operations can be left unfinished. The spec covers broadcasts with no final event, but not locks that were never broadcast. It also says to mark an operation failed if its EOA's nonce moved with no receipt, which would release the funds.

## Decision

`Executor.recover` runs once on boot, after replay and before the server, watcher or price poller start.

| What the journal and chain show | What happens |
| --- | --- |
| Broadcast, with a receipt | Settle or fail it through the same code as a normal run |
| Broadcast, no receipt, nonce has not moved | Send the identical signed transaction again, then settle |
| Broadcast, no receipt, nonce has moved | Flag for review. Funds stay reserved and the EOA stays busy |
| Broadcast, and the chain cannot be reached | Stay unresolved, with funds reserved. The next boot tries again |
| Withdrawal locked, never broadcast | Release the funds, because nothing can have been sent |
| Intent with no broadcast | Nothing to do. It stays pending, and the price poller retries it |

## Why review instead of failing

This departs from the spec. Releasing funds is only safe if the transaction can never land. A moved nonce with no receipt could also be a lagging node, and if the transaction did land, releasing would pay the user twice. Keeping funds locked costs a manual check, while a wrong release costs real money. Each boot checks again, so a lagging node clears itself.

## Why resending is safe

A signed transaction has one hash and one nonce, so sending it again cannot pay twice. Nothing is signed during recovery.

## Consequences

- Review cases need a person, and there is no tool for this yet.
- A withdrawal interrupted before broadcast fails, and the user asks again. It does not retry by itself, so a payment cannot arrive long after the request.
- `Executor.recover` does not use `KeyManager.recoverSigned`. A transaction signed but not journaled was never sent, so it is discarded.
- A crash between a final event and `FEE_BOOKED` loses that gas record, which only affects the operational gas total.
- This only runs on boot. An `unresolved` operation during normal running waits for the next restart.
