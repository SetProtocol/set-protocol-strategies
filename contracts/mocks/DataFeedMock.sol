pragma solidity 0.5.7;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IDataSource } from "../meta-oracles/interfaces/IDataSource.sol";
import { LinkedListLibrary } from "../meta-oracles/lib/LinkedListLibrary.sol";

// Mock contract implementation of PriceFeed functions
contract DataFeedMock is LinkedListLibrary {
    uint256 public updateInterval;
    uint256 public maxDataPoints;
    uint256 public nextEarliestUpdate;
    string public dataDescription;
    IDataSource public dataSource;

    LinkedList public historicalPriceData;

    constructor(
        uint256 _updateInterval,
        uint256 _maxDataPoints,
        address _dataSourceAddress,
        string memory _dataDescription,
        uint256[] memory _seededValues
    )
        public
    {
        // Set medianizer address, data description, and instantiate medianizer
        updateInterval = _updateInterval;
        maxDataPoints = _maxDataPoints;
        dataDescription = _dataDescription;
        dataSource = IDataSource(_dataSourceAddress);

        // Define upper data size limit for linked list and input initial value
        initialize(
            historicalPriceData,
            _maxDataPoints,
            _seededValues[0]
        );

        // Cycle through input values array (skipping first value used to initialize LinkedList)
        // and add to historicalPriceData
        for (uint256 i = 1; i < _seededValues.length; i++) {
            editList(
                historicalPriceData,
                _seededValues[i]
            );
        }

        // Set next available update timestamp
        nextEarliestUpdate = block.timestamp.add(updateInterval);
    }

    function poke()
        external
    {
        // Make sure block timestamp exceeds nextEarliestUpdate
        require(
            block.timestamp >= nextEarliestUpdate,
            "DataFeed.poke: Not enough time elapsed since last update"
        );

        // Get current price
        uint256 newValue = dataSource.read();

        // Update the nextEarliestUpdate to current block timestamp plus updateInterval
        nextEarliestUpdate = nextEarliestUpdate.add(updateInterval);

        // Update linkedList with new price
        editList(
            historicalPriceData,
            newValue
        );
    }

    /*
     * Query linked list for specified days of data. Will revert if number of days
     * passed exceeds amount of days collected. Will revert if not enough days of
     * data logged.
     *
     * @param  _dataDays       Number of days of data being queried
     * @returns                Array of historical price data of length _dataDays                   
     */
    function read(
        uint256 _dataDays
    )
        external
        view
        returns (uint256[] memory)
    {
        return readList(
            historicalPriceData,
            _dataDays
        );
    }

    function testCallDataSource()
        external
        view
        returns (uint256)
    {
        return IDataSource(dataSource).read();
    }
}
