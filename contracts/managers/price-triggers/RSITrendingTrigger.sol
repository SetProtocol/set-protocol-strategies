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

import { IPriceTrigger } from "./IPriceTrigger.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";
import { IMetaOracleV2 } from "../../meta-oracles/interfaces/IMetaOracleV2.sol";


/**
 * @title RSITrendingTrigger
 * @author Set Protocol
 *
 * Implementing the IPriceTrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine the amount of base asset to be
 * allocated to by checking if the the RSI is above or below certain values.
 *
 * This trigger is for trend trading strategies which sets upperBound as resistance
 * and lowerBound as support. When RSI level crosses above upperBound the 
 * RebalancingSetToken should be in the base asset. When RSI level crosses below
 * lowerBound the RebalancingSetToken should be in the quote asset.
 *
 */
contract RSITrendingTrigger is
    IPriceTrigger
{
    /* ============ State Variables ============ */
    IMetaOracleV2 public rsiOracleInstance;
    // RSI Bound under which strategy goes to the quote asset
    uint256 public lowerBound;
    // RSI Bound over which strategy goes to the base asset
    uint256 public upperBound;
    uint256 public rsiTimePeriod;
    bool private currentTrendState;

    /*
     * RSITrendingTrigger constructor.
     *
     * @param  _rsiOracleInstance       The address of RSI oracle
     * @param  _lowerBound              Lower bound of RSI to trigger a rebalance
     * @param  _upperBound              Upper bound of RSI to trigger a rebalance
     * @param  _rsiTimePeriod           The amount of days to use in RSI calculation
     * @param  _initialTrendState       Starting state based on current trend
     */
    constructor(
        IMetaOracleV2 _rsiOracleInstance,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint256 _rsiTimePeriod,
        bool _initialTrendState
    )
        public
    {
        // Check that upper bound value must be greater than lower bound value
        require(
            _upperBound >= _lowerBound,
            "RSITrendingTrigger.constructor: Upper bound must be greater than lower bound"
        );

        // Set all state variables
        rsiOracleInstance = _rsiOracleInstance;
        lowerBound = _lowerBound;
        upperBound = _upperBound;
        rsiTimePeriod = _rsiTimePeriod;
        currentTrendState = _initialTrendState;
    }

    /*
     * Since RSI does not require a confirmation leave initialTrigger function unimplemented.
     */
    function initialTrigger()
        external
    {}

    /*
     * Sets if RSI state is bullish. If RSI is above upper bound then should be true,
     * if RSI is below lower bound then should be false. If in between bounds then
     * returns the state of the current trend.
     */
    function confirmTrigger()
        external
    {
        // Query RSI oracle
        uint256 rsiValue = rsiOracleInstance.read(rsiTimePeriod);

        // If RSI greater than upper bound return true
        // Else if RSI less than lower bound return false
        // Else return currentTrendState
        bool trendState = rsiValue >= upperBound ? true : rsiValue < lowerBound ?
            false : currentTrendState;

        // Set currentTrendState if trend has changed
        if (trendState != currentTrendState) {
            currentTrendState = trendState;
        }
    }

    /*
     * Returns if RSI state is bullish If RSI is above upper bound then should be true,
     * if RSI is below lower bound then should be false. If in between bounds then
     * returns the state of the current trend.
     *
     * @return             Whether indicator is bullish or bearish
     */
    function isBullish()
        external
        view
        returns (bool)
    {
        return currentTrendState;
    }
}