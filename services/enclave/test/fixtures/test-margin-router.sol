// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Local fixtures only: fixed-price swaps, ERC20 approvals, Permit2 allowance and WETH withdrawal logs.
contract TestMarginToken {
    event Transfer(address indexed from, address indexed to, uint256 value);
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ERC20_ALLOWANCE");
        if (approved != type(uint256).max) allowance[from][msg.sender] -= amount;
        move(from, to, amount);
        return true;
    }

    function move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract TestMarginPermit2 {
    struct Allowance { uint160 amount; uint48 expiration; uint48 nonce; }
    mapping(address => mapping(address => mapping(address => Allowance))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        allowance[msg.sender][token][spender] = Allowance(amount, expiration, 0);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        Allowance storage approved = allowance[from][token][msg.sender];
        require(approved.amount >= amount && approved.expiration >= block.timestamp, "PERMIT2_ALLOWANCE");
        if (approved.amount != type(uint160).max) approved.amount -= amount;
        require(TestMarginToken(token).transferFrom(from, to, amount), "TRANSFER");
    }
}

contract TestMarginWeth {
    event Withdrawal(address indexed src, uint256 wad);
    mapping(address => uint256) public balanceOf;

    function deposit() external payable { balanceOf[msg.sender] += msg.value; }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        emit Withdrawal(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "UNWRAP");
    }
}

contract TestMarginRouter {
    TestMarginToken public immutable token = new TestMarginToken();
    TestMarginWeth public immutable weth = new TestMarginWeth();
    TestMarginPermit2 private constant PERMIT2 = TestMarginPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    uint256 public price = 2_000_000_000; // USDC base units per ETH.
    bool public shouldRevert;

    receive() external payable {}

    function configure(uint256 nextPrice, bool fail) external {
        require(nextPrice > 0, "PRICE");
        price = nextPrice;
        shouldRevert = fail;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        require(block.timestamp <= deadline && !shouldRevert, "REVERTED");
        require(inputs.length == 3, "INPUTS");
        if (msg.value > 0) {
            require(keccak256(commands) == keccak256(hex"0b0004"), "COMMANDS");
            (address output, address recipient, uint256 minimum) = abi.decode(inputs[2], (address, address, uint256));
            require(output == address(token), "TOKEN");
            uint256 amountOut = msg.value * price / 1 ether;
            require(amountOut >= minimum, "MINIMUM");
            token.mint(recipient, amountOut);
        } else {
            require(keccak256(commands) == keccak256(hex"000c04"), "COMMANDS");
            buy(inputs[0], inputs[1]);
        }
    }

    function buy(bytes calldata swap, bytes calldata unwrap) private {
        (address output, uint256 amountIn, uint256 swapMinimum,, bool payer) = abi.decode(swap, (address, uint256, uint256, bytes, bool));
        require(output == address(2) && payer && amountIn <= type(uint160).max, "SWAP");
        (address recipient, uint256 minimum) = abi.decode(unwrap, (address, uint256));
        uint256 amountOut = amountIn * 1 ether / price;
        require(amountOut >= minimum && amountOut >= swapMinimum, "MINIMUM");
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amountIn), address(token));
        weth.deposit{value: amountOut}();
        weth.withdraw(amountOut);
        (bool ok,) = recipient.call{value: amountOut}("");
        require(ok, "PAYOUT");
    }
}
