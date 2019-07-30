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
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { IHistoricalPriceFeed } from "./interfaces/IHistoricalPriceFeed.sol";


/**
 * @title LinearizedPriceDataSource
 * @author Set Protocol
 *
 */
contract LinearizedPriceDataSource is
    Ownable
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    uint256 public updateTolerance;
    string public dataDescription;
    IMedian public medianizerInstance;

    /* ============ Constructor ============ */

    constructor(
        uint256 _updateTolerance,
        address _medianizerAddress,
        string memory _dataDescription
    )
        public
    {
        // Set medianizer address, data description, and instantiate medianizer
        updateTolerance = _updateTolerance;
        medianizerInstance = IMedian(_medianizerAddress);
    }

    /* ============ External ============ */

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
        returns (uint256)
    {
        // Get current medianizer value
        uint256 medianizerValue = uint256(medianizerInstance.read());

        // Add the updateTolerance to the nextAvailableTimestamp to get the timestamp after which we linearize
        // the prices.
        uint256 nextAvailableUpdate = IHistoricalPriceFeed(msg.sender).nextAvailableUpdate();
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
        IHistoricalPriceFeed dataFeed = IHistoricalPriceFeed(msg.sender);
        uint256 updateFrequency = dataFeed.updateFrequency();

        uint256 previousUpdateTimestamp = dataFeed.nextAvailableUpdate().sub(updateFrequency);
        // Calculate how much time has passed from last update
        uint256 timeFromLastUpdate = block.timestamp.sub(previousUpdateTimestamp);

        // Get previous price and put into uint256 format
        uint256[] memory previousLoggedPriceArray = dataFeed.read(1);
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