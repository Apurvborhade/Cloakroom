// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One-time ETH claims backed by a separate reserve, unlocked after custody stops heartbeating.
contract EscapeHatch {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidClaim();
    error AlreadyRegistered();
    error InsufficientReserve();
    error NotStarted();
    error NotExpired();
    error Expired();
    error TransferFailed();
    error ReentrantCall();

    event ClaimRegistered(bytes32 indexed claimId, uint256 amountWei);
    event Heartbeat(uint256 timestamp);
    event Claimed(bytes32 indexed claimId, address indexed owner, uint256 amountWei);

    address public immutable enclaveSigner;
    uint256 public immutable timeout;
    uint256 public totalReserved;
    uint256 public lastHeartbeat;
    bool public started;
    mapping(bytes32 => uint256) public claims;
    mapping(bytes32 => bool) public registered;
    bool private entering;

    constructor(address signer, uint256 timeoutSeconds) {
        if (signer == address(0) || timeoutSeconds == 0) revert InvalidConfiguration();
        enclaveSigner = signer;
        timeout = timeoutSeconds;
    }

    receive() external payable {}

    function expired() public view returns (bool) {
        return started && block.timestamp > lastHeartbeat && block.timestamp - lastHeartbeat > timeout;
    }

    function claimId(address owner, bytes32 code) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), owner, code));
    }

    function registerClaim(bytes32 id, uint256 amountWei) external {
        if (msg.sender != enclaveSigner) revert Unauthorized();
        if (expired()) revert Expired();
        if (id == bytes32(0) || amountWei == 0) revert InvalidClaim();
        if (registered[id]) revert AlreadyRegistered();
        if (amountWei > address(this).balance - totalReserved) revert InsufficientReserve();

        registered[id] = true;
        claims[id] = amountWei;
        totalReserved += amountWei;
        if (!started) {
            started = true;
            lastHeartbeat = block.timestamp;
            emit Heartbeat(block.timestamp);
        }
        emit ClaimRegistered(id, amountWei);
    }

    function heartbeat() external {
        if (msg.sender != enclaveSigner) revert Unauthorized();
        if (!started) revert NotStarted();
        if (expired()) revert Expired();
        lastHeartbeat = block.timestamp;
        emit Heartbeat(block.timestamp);
    }

    function claim(bytes32 code) external {
        if (entering) revert ReentrantCall();
        if (!expired()) revert NotExpired();
        bytes32 id = claimId(msg.sender, code);
        uint256 amountWei = claims[id];
        if (amountWei == 0) revert InvalidClaim();

        entering = true;
        claims[id] = 0;
        totalReserved -= amountWei;
        (bool sent,) = payable(msg.sender).call{value: amountWei}("");
        if (!sent) revert TransferFailed();
        entering = false;
        emit Claimed(id, msg.sender, amountWei);
    }
}
