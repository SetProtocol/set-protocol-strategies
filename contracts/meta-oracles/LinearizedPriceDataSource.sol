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
import { IDataFeed } from "./interfaces/IDataFeed.sol";


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

    /* ============ Events ============ */

    event LogMedianizerUpdated(
        address newMedianizerAddress
    );

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
        dataDescription = _dataDescription;
    }

    /* ============ External ============ */

    /*
     * The sender must be a DataSource
     *
     * @returns                Returns 
     */
    function read()
        external
        returns (uint256)
    {
        // Add the updateTolerance to the nextAvailableTimestamp to get the timestamp after which we linearize
        // the prices.
        uint256 nextAvailableUpdate = IDataFeed(msg.sender).nextAvailableUpdate();

        // Make sure block timestamp exceeds nextAvailableUpdate
        require(
            block.timestamp >= nextAvailableUpdate,
            "LinearizedPriceDataSource.read: Not enough time elapsed since last update"
        );

        uint256 updateToleranceTimestamp = nextAvailableUpdate.add(updateTolerance);

        // Get current medianizer value
        uint256 medianizerValue = uint256(medianizerInstance.read());

        // If block timestamp is greater than updateToleranceTimestamp we linearize the current price to try to
        // reduce error
        if (block.timestamp < updateToleranceTimestamp) {
            return medianizerValue;
        } else {
            return interpolateDelayedPriceUpdate(medianizerValue);
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

        emit LogMedianizerUpdated(_newMedianizerAddress);
    }

    /*
     * When price update is delayed past the updateTolerance in order to attempt to reduce potential error
     * linearly interpolate the price between the current time and price and the last updated time and price. This 
     * is done with the following series of equations, modified in this instance to deal handle unsigned integers:
     *
     * updateTimeFraction = (updatePeriod/(block.timestamp - previousUpdateTimestamp))
     *
     * interpolatedPrice = previousLoggedPrice + updateTimeFraction * (currentPrice - previousLoggedPrice)
     *
     * Where updateTimeFraction represents the fraction of time passed between the last update and now, spent in
     * the previous update window. It's worth noting that because we consider updates to occur on their update
     * timestamp we can make the assumption that the amount of time spent in the previous update window is equal
     * to the update frequency. 
     *
     * @param  _currentPrice        Current price returned by medianizer
     * @returns                     Interpolated price value                  
     */
    function interpolateDelayedPriceUpdate(
        uint256 _currentPrice
    )
        private
        view
        returns(uint256)
    {
        IDataFeed dataFeed = IDataFeed(msg.sender);
        uint256 updatePeriod = dataFeed.updatePeriod();
        uint256 nextAvailableUpdate = dataFeed.nextAvailableUpdate();

        // Calculate timestamp corresponding to last updated price
        uint256 previousUpdateTimestamp = nextAvailableUpdate.sub(updatePeriod);
        // Calculate how much time has passed from timestamp corresponding to last update
        uint256 timeFromLastUpdate = block.timestamp.sub(previousUpdateTimestamp);
        // Calculate how much time has passed from last expected update
        uint256 timeFromExpectedUpdate = block.timestamp.sub(nextAvailableUpdate);

        // Get previous price and put into uint256 format
        uint256[] memory previousLoggedPriceArray = dataFeed.read(1);
        uint256 previousLoggedPrice = previousLoggedPriceArray[0];

        // Linearly interpolate between last updated price (with corresponding timestamp) and current price (with
        // current timestamp) to imply price at the timestamp we are updating
        return _currentPrice.mul(updatePeriod)
            .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
            .div(timeFromLastUpdate);      
    }
}