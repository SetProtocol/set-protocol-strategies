pragma solidity 0.5.7;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IDataSource } from "../meta-oracles/interfaces/IDataSource.sol";
import { DataFeed } from "../meta-oracles/DataFeed.sol";

// Mock contract implementation of DataFeed functions with an external call to DataSource to retrieve value
contract DataFeedMock is DataFeed {
    constructor(
        uint256 _updateInterval,
        uint256 _maxDataPoints,
        address _dataSourceAddress,
        string memory _dataDescription,
        uint256[] memory _seededValues
    )
        public
        DataFeed(
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
