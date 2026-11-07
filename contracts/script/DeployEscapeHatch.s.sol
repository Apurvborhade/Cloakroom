// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscapeHatch} from "../src/EscapeHatch.sol";

interface DeployVm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployEscapeHatch {
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (EscapeHatch hatch) {
        address signer = vm.envAddress("ESCAPE_SIGNER");
        uint256 timeout = vm.envUint("ESCAPE_TIMEOUT_SEC");
        uint256 reserve = vm.envOr("ESCAPE_INITIAL_RESERVE_WEI", uint256(0));
        vm.startBroadcast();
        hatch = new EscapeHatch(signer, timeout);
        if (reserve != 0) {
            (bool funded,) = address(hatch).call{value: reserve}("");
            require(funded, "funding failed");
        }
        vm.stopBroadcast();
    }
}
