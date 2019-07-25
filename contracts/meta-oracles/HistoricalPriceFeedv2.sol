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

import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { ReentrancyGuard } from "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { LinkedListLibrary } from "./lib/LinkedListLibrary.sol";


/**
 * @title HistoricalPriceFeedv2
 * @author Set Protocol
 *
 * Contract used to store Historical price data from an off-chain oracle
 */
contract HistoricalPriceFeedv2 is
    Ownable,
    ReentrancyGuard,
    LinkedListLibrary
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    uint256 public updateFrequency;
    uint256 public updateTolerance;
    uint256 public maxDataPoints;
    uint256 public nextAvailableUpdate;
    string public dataDescription;
    IMedian public medianizerInstance;

    LinkedList public historicalPriceData;

    /* ============ Constructor ============ */

    /*
     * HistoricalPriceFeedv2 constructor.
     * Stores Historical prices according to passed in oracle address. Updates must be 
     * triggered off chain to be stored in this smart contract. This contract negates the probalem
     * of drift by allowing price feed updates on a predetermined cadence based on the time of deployment,
     * this mean delays in calling poke do not propogate throughout the whole dataset and the drift caused
     * by previous poke transactions not being mined exactly on nextAvailableUpdate do not compound
     * as they would if it was required that poke is called an updateFrequency amount of time after
     * the last poke.
     *
     * @param  _updateFrequency           Cadence at which data is allowed to be logged, based off 
                                          deployment timestamp 
     * @param  _updateTolerance           If update time exceeds nextAvailable update by this amount
     *                                    then linearize result, passed in seconds
     * @param  _maxDataPoints             The maximum amount of data points the linkedList will hold
     * @param  _medianizerAddress         The oracle address to read current price from
     * @param  _dataDescription           Description of data in Data Bank
     * @param  _seededValues              Array of previous days' Historical price values to seed
     *                                    initial values in list. Should NOT contain the current
     *                                    days price.
     */
    constructor(
        uint256 _updateFrequency,
        uint256 _updateTolerance,
        uint256 _maxDataPoints,
        address _medianizerAddress,
        string memory _dataDescription,
        uint256[] memory _seededValues
    )
        public
    {
        // Set medianizer address, data description, and instantiate medianizer
        updateFrequency = _updateFrequency;
        updateTolerance = _updateTolerance;
        maxDataPoints = _maxDataPoints;
        dataDescription = _dataDescription;
        medianizerInstance = IMedian(_medianizerAddress);

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
        nextAvailableUpdate = block.timestamp.add(updateFrequency);
    }

    /* ============ External ============ */

    /*
     * Updates linked list with newest data point by querying medianizer. Is eligible to be
     * called after nextAvailableUpdate timestamp has passed. Because the nextAvailableUpdate occurs
     * on a predetermined cadence based on the time of deployment, delays in calling poke do not propogate
     * throughout the whole dataset and the drift caused by previous poke transactions not being mined
     * exactly on nextAvailableUpdate do not compound as they would if it was required that poke is called
     * an updateFrequency amount of time after the last poke.
     *
     * By way of example, assume updateFrequency of 24 hours and a updateTolerance of 1 hour. At time 1 the
     * update is missed by one day and when the oracle is finally called the price is 150, the price feed
     * then linearizes this price to imply a price at t1 equal to 125. Time 2 the update is 10 minutes late but
     * since it's within the updateTolerance the value isn't linearized. At time 3 everything falls back in line.
     *
     * +----------------------+------+-------+-------+-------+
     * |                      | 0    | 1     | 2     | 3     |
     * +----------------------+------+-------+-------+-------+
     * | Expected Update Time | 0:00 | 24:00 | 48:00 | 72:00 |
     * +----------------------+------+-------+-------+-------+
     * | Actual Update Time   | 0:00 | 48:00 | 48:10 | 72:00 |
     * +----------------------+------+-------+-------+-------+
     * | Logged Px            | 100  | 125   | 151   | 130   |
     * +----------------------+------+-------+-------+-------+
     * | Received Oracle Px   | 100  | 150   | 151   | 130   |
     * +----------------------+------+-------+-------+-------+
     * | Actual Price         | 100  | 110   | 151   | 130   |
     * +----------------------+------+-------+-------+-------+
     */
    function poke()
        external
        nonReentrant
    {
        // Make sure block timestamp exceeds nextAvailableUpdate
        require(
            block.timestamp >= nextAvailableUpdate,
            "HistoricalPriceFeed.poke: Not enough time elapsed since last update"
        );

        // Get current price
        uint256 newValue = determineUpdatePrice();

        // Update the nextAvailableUpdate to current block timestamp plus updateFrequency
        nextAvailableUpdate = nextAvailableUpdate.add(updateFrequency);

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

    /*
     * Change medianizer in case current one fails or is deprecated. Only contract
     * owner is allowed to change.
     *
     * @param  _newMedianizerAddress       Address of new medianizer to pull data from
     */
    function changeMedianizer(
        address _newMedianizerAddress
    )
        external
        onlyOwner
    {
        medianizerInstance = IMedian(_newMedianizerAddress);
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
        // Get current value from medianizer
        uint256 currentValue = uint256(medianizerInstance.read());

        // Instantiate outputArray
        uint256 seededValuesLength = _seededValues.length;
        uint256[] memory outputArray = new uint256[](seededValuesLength.add(1));

        // Take values from _seededValues array and add to outputArray
        for (uint256 i = 0; i < _seededValues.length; i++) {
            outputArray[i] = _seededValues[i];
        }

        // Add currentValue to outputArray
        outputArray[seededValuesLength] = currentValue;

        return outputArray;
    }

    /*
     * Determine price to update LinkedList with. If within time tolerance then we take raw value from oracle,
     * otherwise linearize current oracle price with last logged price to attempt to reduce potential error.
     *
     * @returns                     Price to update LinkedList with                  
     */
    function determineUpdatePrice()
        private
        returns (uint256)
    {
        // Get current medianizer value
        uint256 medianizerValue = uint256(medianizerInstance.read());

        // Add the updateTolerance to the nextAvailableTimestamp to get the timestamp after which we linearize
        // the prices.
        uint256 updateToleranceTimestamp = nextAvailableUpdate.add(updateTolerance);

        // If block timestamp is greater than updateToleranceTimestamp we linearize the current price to try to
        // reduce error
        if (block.timestamp < updateToleranceTimestamp) {
            return medianizerValue;
        } else {
            return linearizeDelayedPriceUpdate(medianizerValue);
        }
    }

    /*
     * When price update is delayed past the updateTolerance in order to attempt to reduce potential error
     * linearize the price between the current time and price and the last updated time and price. This is 
     * done with the following series of equations, modified in this instance to deal handle unsigned integers:
     *
     * updateTimeFraction = (updateFrequency/(block.timestamp - previousUpdateTimestamp))
     *
     * linearizedPrice = previousLoggedPrice + updateTimeFraction * (currentPrice - previousLoggedPrice)
     *
     * Where updateTimeFraction represents the fraction of time passed between the last update and now, spent in
     * the previous update window. It's worth noting that because we consider updates to occur on their update
     * timestamp we can make the assumption that the amount of time spent in the previous update window is equal
     * to the update frequency. 
     *
     * @param  _currentPrice        Current price returned by medianizer
     * @returns                     Linearized price value                  
     */
    function linearizeDelayedPriceUpdate(
        uint256 _currentPrice
    )
        private
        returns(uint256)
    {
        // Calculate the previous update's timestamp
        uint256 previousUpdateTimestamp = nextAvailableUpdate.sub(updateFrequency);
        // Calculate how much time has passed from last update
        uint256 timeFromLastUpdate = block.timestamp.sub(previousUpdateTimestamp);

        // Get previous price and put into uint256 format
        uint256[] memory previousLoggedPriceArray = readList(historicalPriceData, 1);
        uint256 previousLoggedPrice = previousLoggedPriceArray[0];
        uint256 priceDifference;

        // Because we use unsigned integers we must switch in case the previous price is greater than the current
        // price. What follows is the implementation of the series of equations defined in javadoc.
        if (_currentPrice > previousLoggedPrice) {
            priceDifference = _currentPrice.sub(previousLoggedPrice);
            return previousLoggedPrice.add(updateFrequency.mul(priceDifference).div(timeFromLastUpdate));
        } else {
            priceDifference = previousLoggedPrice.sub(_currentPrice);
            return previousLoggedPrice.sub(updateFrequency.mul(priceDifference).div(timeFromLastUpdate));
        }       
    }
}