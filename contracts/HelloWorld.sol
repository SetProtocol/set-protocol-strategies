pragma solidity 0.5.7;

import { CommonMath } from "set-protocol-contracts/contracts/lib/CommonMath.sol";


contract HelloWorld {
    function testMaxUInt256 ()
        external
        pure
        returns (uint256) {

        uint256 maxUint = CommonMath.maxUInt256();

        return maxUint;
    }
}
