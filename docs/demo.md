# Demo script

3 minutes or less, which the CROPS prize requires. Pradnyesh owns the video; everyone joins the rehearsal.

For the Anon-RPC prize, the video must also show chain reads going through Anon-RPC. Show this during steps 3 and 6.

1. Show the attestation page and state the trust model in one sentence.
2. Alice and Bob deposit from different wallets. The explorer shows two plain transfers to two EOAs.
3. The app shows each user's confidential balance.
4. Alice signs a conditional swap. The enclave's next price check triggers it.
5. The explorer shows the swap sent from an EOA that neither user funded.
6. Alice withdraws to a fresh wallet and receives a normal transfer.
7. Run the replay, wrong-destination and double-spend attacks. All are rejected.
8. Close on the known-leaks slide: amounts and timing, the visible payout edge, gas funding, and the enclave's own RPC reads.

## Rehearsing

`pnpm demo:local` and `pnpm demo:sepolia` run these steps from the command line, with real core components but a stand-in signer and intent store, and no API or UI. See [scripts/README.md](../scripts/README.md).

## Say out loud

- The inventory was operator-seeded before the demo.
- Testnet pools do not track the market, so the trigger price follows the Sepolia pool price, not the real ETH price.
- The set of 4 to 6 EOAs is small, and we claim no anonymity.
- Out of scope: key handover, multi-node or threshold custody, slashing, general DeFi execution, ZK proofs.
- If running on a fork, call it a fork-based demonstration. If outside a TEE, call it TEE-simulated and make no confidentiality claim.
