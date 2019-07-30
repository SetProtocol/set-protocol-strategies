/*
    Copyright 2019 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;
pragma experimental "ABIEncoderV2";

import { ReentrancyGuard } from "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IDataSource } from "./interfaces/IDataSource.sol";
import { LinkedListLibrary } from "./lib/LinkedListLibrary.sol";


/**
 * @title DataFeed
 * @author Set Protocol
 *
 * Contract used to store Historical price data from an off-chain oracle
 */
contract DataFeed is
    ReentrancyGuard,
    LinkedListLibrary
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    uint256 public updatePeriod;
    uint256 public maxDataPoints;
    uint256 public nextAvailableUpdate;
    string public dataDescription;
    IDataSource public dataSource;

    LinkedList public historicalPriceData;

    /* ============ Constructor ============ */

    /*
     * DataFeed constructor.
     * Stores Historical prices according to passed in oracle address. Updates must be 
     * triggered off chain to be stored in this smart contract.
     *
     * @param  _updatePeriod           Cadence at which data is allowed to be logged, based off 
                                          deployment timestamp 
     * @param  _maxDataPoints             The maximum amount of data points the linkedList will hold
     * @param  _dataSourceAddress         The oracle address to read current price from
     * @param  _dataDescription           Description of data in Data Bank
     * @param  _seededValues              Array of previous days' Historical price values to seed
     *                                    initial values in list. Should NOT contain the current
     *                                    days price.
     */
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

    /* ============ External ============ */

    function poke()
        external
        nonReentrant
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


    /* ============ Private ============ */

    /*
     * Create initialValues array from _seededValues and the current medianizer price.
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
        uint256[] memory outputArray = new uint256[](seededValuesLength.add(1));

        // Take values from _seededValues array and add to outputArray
        for (uint256 i = 0; i < _seededValues.length; i++) {
            outputArray[i] = _seededValues[i];
        }

        // Get current value from dataSource
        uint256 currentValue = uint256(dataSource.read());

        // Add currentValue to outputArray
        outputArray[seededValuesLength] = currentValue;

        return outputArray;
    }
}