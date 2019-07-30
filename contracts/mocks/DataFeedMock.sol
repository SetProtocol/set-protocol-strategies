pragma solidity 0.5.7;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IDataSource } from "../meta-oracles/interfaces/IDataSource.sol";
import { LinkedListLibrary } from "../meta-oracles/lib/LinkedListLibrary.sol";

// Mock contract implementation of PriceFeed functions
contract DataFeedMock is LinkedListLibrary {
    uint256 public updatePeriod;
    uint256 public maxDataPoints;
    uint256 public nextAvailableUpdate;
    string public dataDescription;
    IDataSource public dataSource;

    LinkedList public historicalPriceData;

    constructor(
        uint256 _updatePeriod,
        uint256 _maxDataPoints,
        address _dataSourceAddress,
        string memory _dataDescription,
        uint256[] memory _seededValues
    )
        public
    {
        // Set medianizer address, data description, and instantiate medianizer
        updatePeriod = _updatePeriod;
        maxDataPoints = _maxDataPoints;
        dataDescription = _dataDescription;
        dataSource = IDataSource(_dataSourceAddress);

        // Create initial values array from _seededValues and current price
        uint256[] memory initialValues = createInitialValues(_seededValues);

        // Define upper data size limit for linked list and input initial value
        initialize(
            historicalPriceData,
            _maxDataPoints,
            initialValues[0]
        );

        // Cycle through input values array (skipping first value used to initialize LinkedList)
        // and add to historicalPriceData
        for (uint256 i = 1; i < initialValues.length; i++) {
            editList(
                historicalPriceData,
                initialValues[i]
            );
        }

        // Set next available update timestamp
        nextAvailableUpdate = block.timestamp.add(updatePeriod);
    }

    function poke()
        external
    {
        // Make sure block timestamp exceeds nextAvailableUpdate
        require(
            block.timestamp >= nextAvailableUpdate,
            "DataFeed.poke: Not enough time elapsed since last update"
        );

        // Get current price
        uint256 newValue = dataSource.read();

        // Update the nextAvailableUpdate to current block timestamp plus updatePeriod
        nextAvailableUpdate = nextAvailableUpdate.add(updatePeriod);

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

    /* ============ Private ============ */

    /*
     * Create initialValues array from _seededValues.
     * Added to historicalPriceData in constructor.
     *
     * @param  _seededValues        Array of previous days' historical price values to seed
     * @returns                     Array of initial values to add to historicalPriceData                  
     */
    function createInitialValues(
        uint256[] memory _seededValues
    )
        private
        returns (uint256[] memory)
    {
        // Instantiate outputArray
        uint256 seededValuesLength = _seededValues.length;
        uint256[] memory outputArray = new uint256[](seededValuesLength);

        // Take values from _seededValues array and add to outputArray
        for (uint256 i = 0; i < _seededValues.length; i++) {
            outputArray[i] = _seededValues[i];
        }

        return outputArray;
    }
}
