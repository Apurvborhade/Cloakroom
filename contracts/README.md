# Escape hatch

`EscapeHatch` holds a separate ETH reserve for one-time, enclave-authorized claims. It does not recover custody keys or cover trading, lending, USDC or margin balances.

The first registration starts the timer. Only the immutable custody signer may register claims or heartbeat. Later registrations do not refresh the timer. Once `block.timestamp > lastHeartbeat + timeout`, claims open permanently and registration and heartbeats stop. The contract has no operator withdrawal, signer replacement or reset.

Each registration must fit within the unreserved ETH balance. `claims(id)` is the remaining amount; `registered(id)` stays true after payment. Claims pay only the calling wallet and cannot be repeated. The enclave must reserve the corresponding ledger balance before registering it.

```text
claimId = keccak256(abi.encode(chainId, hatchAddress, ownerAddress, code))
```

The random 32-byte code stays private until claiming. Registration amounts and claim payouts are public. The configured signer is trusted; the contract does not verify Nitro attestations.

## Test

Requires Foundry (tested with v1.9.0). No Solidity libraries are needed.

```sh
forge test --root contracts
pnpm test:escape
```

## Deploy and verify

The contract test and full local API roundtrip above run from the repository root. The roundtrip uses Anvil and simulated sealed storage; it does not verify Nitro hardware.

For deployment, run from `contracts/`. Obtain the signer from `/escape/identity` and deploy with `ESCAPE_SIGNER` and `ESCAPE_TIMEOUT_SEC`. This address is initially unverified: leave the reserve empty, configure `ESCAPE_HATCH_ADDRESS`, then verify the new image's fresh attestation against the contract signer before funding or accepting claims. Keep RPC credentials and the Etherscan API key outside Git. Use an encrypted Foundry keystore for the deployment account.

```sh
forge script script/DeployEscapeHatch.s.sol:DeployEscapeHatch \
  --rpc-url "$DEPLOY_RPC_URL" --account demo-deployer --broadcast --verify
```

Source verification uses `ETHERSCAN_API_KEY`. Check that the deployment, reserve transfer and source verification succeeded before registering claims. Funding alone does not start the timeout. The signer also needs ETH for registration and heartbeat transactions.

To claim after the timeout, open the verified contract on the network's Etherscan, connect the same owner wallet and call `claim(code)` under **Write Contract**. An independent RPC can be used if the application is unavailable. The owner wallet pays transaction gas.
