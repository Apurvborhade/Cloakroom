// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscapeHatch} from "../src/EscapeHatch.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function chainId(uint256 chainId) external;
    function etch(address target, bytes calldata code) external;
}

contract ClaimReceiver {
    EscapeHatch private immutable hatch;
    bytes32 private immutable code;
    bool public reject = true;
    bool public tryReenter;
    bool public reentered;

    constructor(EscapeHatch target, bytes32 secret) {
        hatch = target;
        code = secret;
    }

    function configure(bool rejectTransfer, bool reenter) external {
        reject = rejectTransfer;
        tryReenter = reenter;
    }

    function redeem() external {
        hatch.claim(code);
    }

    receive() external payable {
        require(!reject, "reject");
        if (tryReenter) {
            (reentered,) = address(hatch).call(abi.encodeCall(EscapeHatch.claim, (code)));
        }
    }
}

contract EscapeHatchTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant SIGNER = address(0xBEEF);
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);
    bytes32 private constant CODE = bytes32(uint256(123));
    uint256 private constant TIMEOUT = 60;
    EscapeHatch private hatch;

    function setUp() public {
        vm.warp(100);
        hatch = new EscapeHatch(SIGNER, TIMEOUT);
        vm.deal(address(hatch), 10 ether);
    }

    function register(address owner, bytes32 code, uint256 amount) private {
        bytes32 id = keccak256(abi.encode(block.chainid, address(hatch), owner, code));
        vm.prank(SIGNER);
        hatch.registerClaim(id, amount);
    }

    function testConfigurationAndInitialState() public {
        require(hatch.enclaveSigner() == SIGNER && hatch.timeout() == TIMEOUT);
        require(!hatch.started() && !hatch.expired());
        require(hatch.totalReserved() == 0 && hatch.lastHeartbeat() == 0);
        vm.expectRevert(EscapeHatch.InvalidConfiguration.selector);
        new EscapeHatch(address(0), TIMEOUT);
        vm.expectRevert(EscapeHatch.InvalidConfiguration.selector);
        new EscapeHatch(SIGNER, 0);
        vm.expectRevert(EscapeHatch.NotStarted.selector);
        vm.prank(SIGNER);
        hatch.heartbeat();
    }

    function testAcceptsEthFunding() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(hatch).call{value: 1 ether}("");
        require(sent && address(hatch).balance == 11 ether);
        require(!hatch.started());
    }

    function testOnlySignerRegistersAndHeartbeats() public {
        bytes32 id = hatch.claimId(OWNER, CODE);
        vm.expectRevert(EscapeHatch.Unauthorized.selector);
        hatch.registerClaim(id, 1 ether);
        register(OWNER, CODE, 1 ether);
        vm.expectRevert(EscapeHatch.Unauthorized.selector);
        hatch.heartbeat();
    }

    function testRegistrationIsBackedAndCannotBeOverwritten() public {
        bytes32 id = hatch.claimId(OWNER, CODE);
        register(OWNER, CODE, 6 ether);
        require(hatch.claims(id) == 6 ether && hatch.registered(id));
        require(hatch.totalReserved() == 6 ether);
        vm.expectRevert(EscapeHatch.AlreadyRegistered.selector);
        register(OWNER, CODE, 1 ether);
        vm.expectRevert(EscapeHatch.InsufficientReserve.selector);
        register(OTHER, CODE, 4 ether + 1);
        require(!hatch.registered(hatch.claimId(OTHER, CODE)));
        register(OTHER, CODE, 4 ether);
        require(hatch.totalReserved() == address(hatch).balance);
    }

    function testRejectsEmptyClaimsWithoutStartingTimer() public {
        vm.expectRevert(EscapeHatch.InvalidClaim.selector);
        register(OWNER, CODE, 0);
        vm.expectRevert(EscapeHatch.InvalidClaim.selector);
        vm.prank(SIGNER);
        hatch.registerClaim(bytes32(0), 1);
        require(!hatch.started());
    }

    function testLaterRegistrationDoesNotRefreshHeartbeat() public {
        register(OWNER, CODE, 1 ether);
        require(hatch.started() && hatch.lastHeartbeat() == 100);
        vm.warp(130);
        register(OTHER, CODE, 1 ether);
        require(hatch.lastHeartbeat() == 100);
        vm.warp(161);
        require(hatch.expired());
    }

    function testHeartbeatExtendsOnlyBeforeExpiry() public {
        register(OWNER, CODE, 1 ether);
        vm.warp(160);
        require(!hatch.expired());
        vm.expectRevert(EscapeHatch.NotExpired.selector);
        vm.prank(OWNER);
        hatch.claim(CODE);
        vm.prank(SIGNER);
        hatch.heartbeat();
        require(hatch.lastHeartbeat() == 160);
        vm.warp(220);
        require(!hatch.expired());
        vm.warp(221);
        require(hatch.expired());
        vm.expectRevert(EscapeHatch.Expired.selector);
        vm.prank(SIGNER);
        hatch.heartbeat();
        vm.expectRevert(EscapeHatch.Expired.selector);
        register(OTHER, CODE, 1 ether);
        require(hatch.lastHeartbeat() == 160);
    }

    function testClaimNeedsOwnerAndCodeAndPaysOnlyOnce() public {
        register(OWNER, CODE, 1 ether);
        vm.expectRevert(EscapeHatch.NotExpired.selector);
        vm.prank(OWNER);
        hatch.claim(CODE);
        vm.warp(161);
        vm.expectRevert(EscapeHatch.InvalidClaim.selector);
        vm.prank(OTHER);
        hatch.claim(CODE);
        vm.expectRevert(EscapeHatch.InvalidClaim.selector);
        vm.prank(OWNER);
        hatch.claim(bytes32(uint256(124)));
        vm.prank(OWNER);
        hatch.claim(CODE);
        require(OWNER.balance == 1 ether && hatch.totalReserved() == 0);
        require(hatch.claims(hatch.claimId(OWNER, CODE)) == 0);
        require(hatch.registered(hatch.claimId(OWNER, CODE)));
        vm.expectRevert(EscapeHatch.InvalidClaim.selector);
        vm.prank(OWNER);
        hatch.claim(CODE);
        vm.expectRevert(EscapeHatch.Expired.selector);
        vm.prank(SIGNER);
        hatch.heartbeat();
    }

    function testRejectedTransferPreservesClaimAndOtherClaimsRemainPayable() public {
        ClaimReceiver receiver = new ClaimReceiver(hatch, CODE);
        register(address(receiver), CODE, 3 ether);
        register(OTHER, CODE, 2 ether);
        vm.warp(161);
        vm.expectRevert(EscapeHatch.TransferFailed.selector);
        receiver.redeem();
        require(hatch.claims(hatch.claimId(address(receiver), CODE)) == 3 ether);
        require(hatch.totalReserved() == 5 ether && address(hatch).balance == 10 ether);
        vm.prank(OTHER);
        hatch.claim(CODE);
        receiver.configure(false, false);
        receiver.redeem();
        require(address(receiver).balance == 3 ether && OTHER.balance == 2 ether);
        require(hatch.totalReserved() == 0 && address(hatch).balance == 5 ether);
    }

    function testReentryCannotClaimTwice() public {
        ClaimReceiver receiver = new ClaimReceiver(hatch, CODE);
        receiver.configure(false, true);
        register(address(receiver), CODE, 3 ether);
        register(OTHER, CODE, 2 ether);
        vm.warp(161);
        receiver.redeem();
        require(!receiver.reentered() && address(receiver).balance == 3 ether);
        require(hatch.totalReserved() == 2 ether && address(hatch).balance == 7 ether);
        vm.prank(OTHER);
        hatch.claim(CODE);
        require(OTHER.balance == 2 ether && hatch.totalReserved() == 0);
    }

    function testRegistrationAtTimestampZeroStartsTimer() public {
        vm.warp(0);
        register(OWNER, CODE, 1 ether);
        require(hatch.started() && !hatch.expired());
        vm.warp(61);
        require(hatch.expired());
    }

    function testClaimIdMatchesSharedVectorAndBindsChainContractAndOwner() public {
        address target = 0x1111111111111111111111111111111111111111;
        address owner = 0x2222222222222222222222222222222222222222;
        bytes32 code = 0x3333333333333333333333333333333333333333333333333333333333333333;
        vm.chainId(11155111);
        vm.etch(target, address(hatch).code);
        bytes32 id = EscapeHatch(payable(target)).claimId(owner, code);
        require(id == 0xcd55a817adf29b3f66bc70dabd43f0c9289462fa05aa797701f9ef31e0f05743);
        require(hatch.claimId(owner, code) != id);
        require(EscapeHatch(payable(target)).claimId(OTHER, code) != id);
        vm.chainId(1);
        require(EscapeHatch(payable(target)).claimId(owner, code) != id);
    }

    function testFuzzAllRegisteredClaimsStayBacked(uint96 first, uint96 second) public {
        uint256 a = uint256(first) % (5 ether) + 1;
        uint256 b = uint256(second) % (5 ether) + 1;
        register(OWNER, CODE, a);
        register(OTHER, CODE, b);
        require(hatch.totalReserved() == a + b && hatch.totalReserved() <= address(hatch).balance);
        vm.warp(161);
        vm.prank(OWNER);
        hatch.claim(CODE);
        require(OWNER.balance == a && hatch.totalReserved() == b);
        require(hatch.totalReserved() <= address(hatch).balance);
        vm.prank(OTHER);
        hatch.claim(CODE);
        require(OTHER.balance == b && hatch.totalReserved() == 0);
    }
}
