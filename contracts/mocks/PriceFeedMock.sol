pragma solidity 0.5.7;

import { IPriceFeed } from "../external/DappHub/interfaces/IPriceFeed.sol";

// Mock contract implementation of PriceFeed functions
contract PriceFeedMock {
    address public priceFeed;

    constructor(
        address _priceFeed
    )
        public
    {
        priceFeed = _priceFeed;
    }

    function read()
        external
        returns (uint256)
    {
        return uint256(IPriceFeed(priceFeed).read());
    }
}
