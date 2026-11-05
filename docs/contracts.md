# Smart contracts

**No custom contract is required for the core flow.** Custody accounts are plain EOAs, and the ledger lives inside the enclave. That is the point of the design, and it also means Solidity work is close to zero. Most on-chain work is in the watcher, inventory and executor: see [chain-logic.md](chain-logic.md).

| Contract | Needed? | Purpose |
| --- | --- | --- |
| Custom privacy-pool contract | No, by design | Removing it is the whole idea |
| Uniswap Universal Router, Permit2, WETH, pool | External, already deployed | Swap execution. Take addresses from the Uniswap docs for the chosen chain |
| Test ERC-20 (for example MockUSDC) | Only if the chosen network has no liquid pair | Not needed on a mainnet fork |
| Chainlink ETH/USD data feed | External, optional | Second price source for the enclave's cross-check |
| EnclaveRegistry | Optional | Publishes the enclave public key and build hash so anyone can look up which enclave is current. Holds no user data |
| Operator staking and slashing | No, out of scope for v1 | Multi-node work |
| Paymaster or account abstraction | No | Custody EOAs pay their own gas |

## Optional EnclaveRegistry

Unaudited sketch, about 15 lines. It cannot verify a TEE quote on-chain and is only a public pointer, so skip it if time is short.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EnclaveRegistry {
    struct Entry { bytes32 buildHash; bytes pubKey; uint64 publishedAt; }
    address public immutable operator;
    Entry public current;
    event EnclavePublished(bytes32 indexed buildHash, bytes pubKey);

    constructor() { operator = msg.sender; }

    function publish(bytes32 buildHash, bytes calldata pubKey) external {
        require(msg.sender == operator, "not operator");
        current = Entry(buildHash, pubKey, uint64(block.timestamp));
        emit EnclavePublished(buildHash, pubKey);
    }
}
```

## Prize note

If a contract-heavy project is wanted, this design is not it. Prizes that expect your own contracts, such as 1inch Aqua or ENSv2, would need a different build.
