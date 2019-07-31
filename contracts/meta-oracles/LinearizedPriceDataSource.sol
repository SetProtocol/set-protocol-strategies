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
import { ITimeSeriesFeed } from "./interfaces/ITimeSeriesFeed.sol";


/**
 * @title LinearizedPriceDataSource
 * @author Set Protocol
 *
 * This DataSource returns the current value of the Medianizer Oracle. If the interpolationThreshold
 * is reached, then returns a linearly interpolated value.
 * It is intended to be read by a DataFeed smart contract.
 */
contract LinearizedPriceDataSource is
    Ownable
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    uint256 public interpolationThreshold; 
    string public dataDescription;
    IMedian public medianizerInstance;

    /* ============ Events ============ */

    event LogMedianizerUpdated(
        address newMedianizerAddress
    );

    /* ============ Constructor ============ */

    /*
     * Set interpolationThreshold, data description, and instantiate medianizer
     *
     * @param  _interpolationThreshold    The minimum time in seconds where interpolation is enabled
     * @param  _medianizerAddress         The address to read current data from
     * @param  _dataDescription           Description of contract for Etherscan / other applications
     */
    constructor(
        uint256 _interpolationThreshold,
        address _medianizerAddress,
        string memory _dataDescription
    )
        public
    {
        interpolationThreshold = _interpolationThreshold;
        medianizerInstance = IMedian(_medianizerAddress);
        dataDescription = _dataDescription;
    }

    /* ============ External ============ */

    /*
     * Returns the data from the Medianizer contract. If the current timestamp has surpassed
     * the interpolationThreshold, then the current price is retrieved and interpolated based on
     * the previous value and the time that has elapsed since the intended update value.
     * Note: Sender must adhere to ITimeSeriesFeed interface or function will revert
     *
     * Returns with newest data point by querying medianizer. Is eligible to be
     * called after nextAvailableUpdate timestamp has passed. Because the nextAvailableUpdate occurs
     * on a predetermined cadence based on the time of deployment, delays in calling poke do not propogate
     * throughout the whole dataset and the drift caused by previous poke transactions not being mined
     * exactly on nextAvailableUpdate do not compound as they would if it was required that poke is called
     * an updateInterval amount of time after the last poke.
     *
     * @returns                Returns the datapoint from the Medianizer contract
     */
    function read()
        external
        returns (uint256)
    {
        uint256 nextEarliestUpdate = ITimeSeriesFeed(msg.sender).nextEarliestUpdate();

        // Add the interpolationThreshold to the nextEarliestUpdate to get the timestamp after which we linearize
        // the prices.
        uint256 interpolationThresholdTimestamp = nextEarliestUpdate.add(interpolationThreshold);

        // Get current medianizer value
        uint256 medianizerValue = uint256(medianizerInstance.read());

        // If block timestamp is greater than interpolationThresholdTimestamp we linearize the current price to try to
        // reduce error
        if (block.timestamp < interpolationThresholdTimestamp) {
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
     * When the update time has surpassed the currentTime + interpolationThreshold, linearly interpolate the 
     * price between the current time and price and the last updated time and price to reduce potential error. This
     * is done with the following series of equations, modified in this instance to deal unsigned integers:
     *
     * updateTimeFraction = (updateInterval/(block.timestamp - previousUpdateTimestamp))
     *
     * interpolatedPrice = previousLoggedPrice + updateTimeFraction * (currentPrice - previousLoggedPrice)
     *
     * Where updateTimeFraction represents the fraction of time passed between the last update and now spent in
     * the previous update window. It's worth noting that because we consider updates to occur on their update
     * timestamp we can make the assumption that the amount of time spent in the previous update window is equal
     * to the update frequency. 
     * 
     * By way of example, assume updateInterval of 24 hours and a interpolationThreshold of 1 hour. At time 1 the
     * update is missed by one day and when the oracle is finally called the price is 150, the price feed
     * then interpolates this price to imply a price at t1 equal to 125. Time 2 the update is 10 minutes late but
     * since it's within the interpolationThreshold the value isn't interpolated. At time 3 everything 
     * falls back in line.
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
     * +------------------------------------------------------     
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
        ITimeSeriesFeed dataFeed = ITimeSeriesFeed(msg.sender);
        uint256 updateInterval = dataFeed.updateInterval();
        uint256 nextEarliestUpdate = dataFeed.nextEarliestUpdate();

        // Calculate timestamp corresponding to last updated price
        uint256 previousUpdateTimestamp = nextEarliestUpdate.sub(updateInterval);
        // Calculate how much time has passed from timestamp corresponding to last update
        uint256 timeFromLastUpdate = block.timestamp.sub(previousUpdateTimestamp);
        // Calculate how much time has passed from last expected update
        uint256 timeFromExpectedUpdate = block.timestamp.sub(nextEarliestUpdate);

        // Get previous price and put into uint256 format
        uint256[] memory previousLoggedPriceArray = dataFeed.read(1);
        uint256 previousLoggedPrice = previousLoggedPriceArray[0];

        // Linearly interpolate between last updated price (with corresponding timestamp) and current price (with
        // current timestamp) to imply price at the timestamp we are updating
        return _currentPrice.mul(updateInterval)
            .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
            .div(timeFromLastUpdate);      
    }
}