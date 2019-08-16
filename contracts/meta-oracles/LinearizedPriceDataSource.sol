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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { TimeLockUpgrade } from "set-protocol-contracts/contracts/lib/TimeLockUpgrade.sol";

import { IOracle } from "./interfaces/IOracle.sol";
import { IDataSource } from "./interfaces/IDataSource.sol";
import { TimeSeriesStateLibrary } from "./lib/TimeSeriesStateLibrary.sol";


/**
 * @title LinearizedPriceDataSource
 * @author Set Protocol
 *
 * This DataSource returns the current value of the oracle. If the interpolationThreshold
 * is reached, then returns a linearly interpolated value.
 * It is intended to be read by a TimeSeriesFeed smart contract.
 */
contract LinearizedPriceDataSource is
    TimeLockUpgrade,
    IDataSource
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    // Amount of time after which read interpolates price result, in seconds
    uint256 public interpolationThreshold; 
    string public dataDescription;
    IOracle public oracleInstance;

    /* ============ Events ============ */

    event LogOracleUpdated(
        address indexed newOracleAddress
    );

    /* ============ Constructor ============ */

    /*
     * Set interpolationThreshold, data description, and instantiate oracle
     *
     * @param  _interpolationThreshold    The minimum time in seconds where interpolation is enabled
     * @param  _oracleAddress         The address to read current data from
     * @param  _dataDescription           Description of contract for Etherscan / other applications
     */
    constructor(
        uint256 _interpolationThreshold,
        IOracle _oracleAddress,
        string memory _dataDescription
    )
        public
    {
        interpolationThreshold = _interpolationThreshold;
        oracleInstance = _oracleAddress;
        dataDescription = _dataDescription;
    }

    /* ============ External ============ */

    /*
     * Returns the data from the oracle contract. If the current timestamp has surpassed
     * the interpolationThreshold, then the current price is retrieved and interpolated based on
     * the previous value and the time that has elapsed since the intended update value.
     *
     * Returns with newest data point by querying oracle. Is eligible to be
     * called after nextAvailableUpdate timestamp has passed. Because the nextAvailableUpdate occurs
     * on a predetermined cadence based on the time of deployment, delays in calling poke do not propogate
     * throughout the whole dataset and the drift caused by previous poke transactions not being mined
     * exactly on nextAvailableUpdate do not compound as they would if it was required that poke is called
     * an updateInterval amount of time after the last poke.
     *
     * @param  _timeSeriesState         Struct of TimeSeriesFeed state
     * @returns                         Returns the datapoint from the oracle contract
     */
    function read(
        TimeSeriesStateLibrary.State calldata _timeSeriesState
    )
        external
        view
        returns (uint256)
    {
        // Validate that nextEarliest update timestamp is less than current block timestamp
        require(
            block.timestamp >= _timeSeriesState.nextEarliestUpdate,
            "LinearizedPriceDataSource.read: current timestamp must be greater than nextAvailableUpdate."
        );

        // Calculate how much time has passed from last expected update
        uint256 timeFromExpectedUpdate = block.timestamp.sub(_timeSeriesState.nextEarliestUpdate);

        // Get previously logged price
        uint256 previousLoggedPrice = _timeSeriesState.timeSeriesDataArray[0];

        // Get current oracle value
        uint256 oracleValue = uint256(oracleInstance.read());

        // If block timeFromExpectedUpdate is greater than interpolationThreshold we linearize
        // the current price to try to reduce error
        if (timeFromExpectedUpdate < interpolationThreshold) {
            return oracleValue;
        } else {
            return interpolateDelayedPriceUpdate(
                oracleValue,
                _timeSeriesState.updateInterval,
                timeFromExpectedUpdate,
                previousLoggedPrice
            );
        }
    }

    /*
     * Change oracle in case current one fails or is deprecated. Only contract
     * owner is allowed to change.
     *
     * @param  _newOracleAddress       Address of new oracle to pull data from
     */
    function changeOracle(
        IOracle _newOracleAddress
    )
        external
        onlyOwner
        timeLockUpgrade
    {
        // Check to make sure new oracle address is passed
        require(
            address(_newOracleAddress) != address(oracleInstance),
            "LinearizedPriceDataSource.changeOracle: Must give new oracle address."
        );

        oracleInstance = _newOracleAddress;

        emit LogOracleUpdated(address(_newOracleAddress));
    }

    /*
     * When the update time has surpassed the currentTime + interpolationThreshold, linearly interpolate the 
     * price between the current time and price and the last updated time and price to reduce potential error. This
     * is done with the following series of equations, modified in this instance to deal unsigned integers:
     *
     * price = (currentPrice * updateInterval + previousLoggedPrice * timeFromExpectedUpdate) / timeFromLastUpdate 
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
     * @param  _currentPrice                Current price returned by oracle
     * @param  _updateInterval              Update interval of TimeSeriesFeed
     * @param  _timeFromExpectedUpdate      Time passed from expected update
     * @param  _previousLoggedPrice         Previously logged price from TimeSeriesFeed
     * @returns                             Interpolated price value                  
     */
    function interpolateDelayedPriceUpdate(
        uint256 _currentPrice,
        uint256 _updateInterval,
        uint256 _timeFromExpectedUpdate,
        uint256 _previousLoggedPrice
    )
        private
        pure
        returns(uint256)
    {
        // Calculate how much time has passed from timestamp corresponding to last update
        uint256 timeFromLastUpdate = _timeFromExpectedUpdate.add(_updateInterval);

        // Linearly interpolate between last updated price (with corresponding timestamp) and current price (with
        // current timestamp) to imply price at the timestamp we are updating
        return _currentPrice.mul(_updateInterval)
            .add(_previousLoggedPrice.mul(_timeFromExpectedUpdate))
            .div(timeFromLastUpdate);      
    }
}