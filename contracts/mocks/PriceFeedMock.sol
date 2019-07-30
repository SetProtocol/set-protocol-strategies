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
        view
        returns (uint256)
    {
        IPriceFeed source = IPriceFeed(priceFeed);
        return uint256(source.read());
    }
}
