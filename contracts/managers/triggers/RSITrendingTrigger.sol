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

import { ITrigger } from "./ITrigger.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";
import { IMetaOracleV2 } from "../../meta-oracles/interfaces/IMetaOracleV2.sol";


/**
 * @title RSITrendingTrigger
 * @author Set Protocol
 *
 * Implementing the ITrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine the whether the current market state for
 * the RSI Trending trigger is bullish.
 *
 * This trigger is for trend trading strategies which sets upperBound as resistance
 * and lowerBound as support. When RSI level crosses above upperBound the indicator
 * is bullish. When RSI level crosses below lowerBound the indicator is bearish.
 *
 */
contract RSITrendingTrigger is
    ITrigger
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    IMetaOracleV2 public rsiOracleInstance;
    // RSI Bound under which strategy indicates bearish market
    uint256 public lowerBound;
    // RSI Bound over which strategy indicates bullish market
    uint256 public upperBound;
    uint256 public rsiTimePeriod;
    uint256 public triggerFlippedIndex;
    bool private lastConfirmedTrendState;
    
    bool public requiresConfirmation = false;

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
        lastConfirmedTrendState = _initialTrendState;
        triggerFlippedIndex = 0;
    }

    /* ============ External ============ */

    /*
     * Since RSI does not require a confirmation leave initialTrigger function unimplemented.
     */
    function initialTrigger()
        external
    {}

    /*
     * If RSI is above upper bound then should be true, if RSI is below lower bound
     * then should be false. If in between bounds then returns the state of the current trend.
     */
    function confirmTrigger()
        external
    {
        // Query RSI oracle
        uint256 rsiValue = rsiOracleInstance.read(rsiTimePeriod);

        // Check RSI trend is different from last confirmed trend state 
        require(
            isNewRSIState(rsiValue),
            "RSITrendingTrigger.confirmTrigger: Current RSI value does not change trend state."
        );

        lastConfirmedTrendState = rsiValue >= upperBound ? true : false;
        triggerFlippedIndex = triggerFlippedIndex.add(1);

        emit TriggerFlipped(lastConfirmedTrendState, triggerFlippedIndex, block.timestamp);
    }

    /*
     * Returns if trigger is in bullish state.
     *
     * @return             Whether market conditions are bullish
     */
    function isBullish()
        external
        view
        returns (bool)
    {
        return lastConfirmedTrendState;
    }

    /*
     * Since RSI does not require a confirmation leave canInitialTrigger function unimplemented.
     */
    function canInitialTrigger()
        external
        view
        returns (bool)
    {}

    /*
     * Returns if confirmTrigger could be successfully called without a revert.
     *
     * @return             Whether confirmTrigger can be called
     */
    function canConfirmTrigger()
        external
        view
        returns (bool)
    {
        // Query RSI oracle
        uint256 rsiValue = rsiOracleInstance.read(rsiTimePeriod);

        // Check if current RSI value would cause trend state change
        return isNewRSIState(rsiValue);       
    }

    /* ============ External ============ */

    /*
     * Returns if current RSI value would lead to a trend state change
     *
     * @param  _rsiValue    Current RSI value
     * @return              Whether RSI value changes trend state
     */
    function isNewRSIState(
        uint256 _rsiValue
    )
        internal
        view
        returns (bool)
    {
        // If RSI value outside bounds evaluate further, else return false
        if (_rsiValue >= upperBound || _rsiValue < lowerBound) {
            // Analyze current market state
            bool currentMarketState = _rsiValue >= upperBound ? true : false;

            // If market state is different from last confirmed state then return true, else false
            return currentMarketState != lastConfirmedTrendState;
        } else {
            return false;
        }         
    }
}