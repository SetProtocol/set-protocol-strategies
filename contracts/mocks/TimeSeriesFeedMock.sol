pragma solidity 0.5.7;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IDataSource } from "../meta-oracles/interfaces/IDataSource.sol";
import { TimeSeriesFeed } from "../meta-oracles/TimeSeriesFeed.sol";

// Mock contract implementation of TimeSeriesFeed functions with an external call to DataSource to retrieve value
contract TimeSeriesFeedMock is TimeSeriesFeed {
    constructor(
        uint256 _updateInterval,
        uint256 _maxDataPoints,
        address _dataSourceAddress,
        string memory _dataDescription,
        uint256[] memory _seededValues
    )
        public
        TimeSeriesFeed(
            _updateInterval,
            _maxDataPoints,
            _dataSourceAddress,
            _dataDescription,
            _seededValues
        )
    {}

    function testCallDataSource()
        external
        view
        returns (uint256)
    {
        return IDataSource(dataSource).read();
    }

}
