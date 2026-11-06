// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A token that emits Transfer, so settlement can read real logs. For tests only.
contract TestSwapToken {
    event Transfer(address indexed from, address indexed to, uint256 value);

    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}

/// Stands in for Universal Router: pays a set amount to the caller, or reverts. For tests only.
contract TestSwapRouter {
    TestSwapToken public immutable token = new TestSwapToken();
    uint256 public amountOut;
    bool public shouldRevert;

    function configure(uint256 newAmountOut, bool newShouldRevert) external {
        amountOut = newAmountOut;
        shouldRevert = newShouldRevert;
    }

    function execute(bytes calldata, bytes[] calldata, uint256) external payable {
        require(!shouldRevert, "reverted");
        token.mint(msg.sender, amountOut);
    }
}
