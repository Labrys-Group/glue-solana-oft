// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

contract gOFT is OFT {

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate,
        uint8 _decimals
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {
    }

    function decimals() public pure override returns (uint8) {
        // NOTE: Update this to the correct decimals for the token
        return 5;
    }

    function sharedDecimals() public pure override returns (uint8) {
        // NOTE: Update this to the correct decimals for the token
        return 5;
    }
}
