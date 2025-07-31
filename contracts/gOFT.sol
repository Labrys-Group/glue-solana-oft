// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";

contract gOFT is OFT {
    bool canEmergencyMint = true;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate,
        uint8 _decimals
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    function decimals() public pure override returns (uint8) {
        // NOTE: Update this to the correct decimals for the token
        return 6;
    }

    function disableEmergencyMint() external onlyOwner {
        canEmergencyMint = false;
    }

    struct BatchMint {
        address to;
        uint256 amount;
    }

    function mint(BatchMint[] calldata mints) external onlyOwner {
        if (canEmergencyMint == false) {
            revert("Emergency minting is disabled");
        }

        for (uint256 i = 0; i < mints.length; i++) {
            _mint(mints[i].to, mints[i].amount);
        }
    }
}
