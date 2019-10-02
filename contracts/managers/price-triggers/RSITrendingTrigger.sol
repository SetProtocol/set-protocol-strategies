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
    /* ============ Constants ============ */
    uint256 constant MAX_BASE_ASSET_ALLOCATION = 100;
    uint256 constant MIN_BASE_ASSET_ALLOCATION = 0;

    /* ============ State Variables ============ */
    IMetaOracleV2 public rsiOracleInstance;
    uint256 public lowerBound;
    uint256 public upperBound;
    uint256 public rsiTimePeriod;
    uint256 public currentTrendAllocation;

    /*
     * RSITrendingTrigger constructor.
     *
     * @param  _rsiOracleInstance           The address of RSI oracle
     * @param  _lowerBound                  Lower bound of RSI to trigger a rebalance
     * @param  _upperBound                  Upper bound of RSI to trigger a rebalance
     * @param  _rsiTimePeriod               The amount of days to use in RSI calculation
     * @param  _initialTrendAllocation      Starting allocation based on current trend
     */
    constructor(
        IMetaOracleV2 _rsiOracleInstance,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint256 _rsiTimePeriod,
        uint256 _initialTrendAllocation
    )
        public
    {
        // Check that upper bound value must be greater than lower bound value
        require(
            _upperBound >= _lowerBound,
            "RSITrendingTrigger.constructor: Upper bound must be greater than lower bound"
        );

        // Check that initial trend allocation matches one of the allocation constants
        require(
            _initialTrendAllocation == MAX_BASE_ASSET_ALLOCATION || _initialTrendAllocation == MIN_BASE_ASSET_ALLOCATION,
            "RSITrendingTrigger.constructor: Initial trend allocation must match either min or max allocation values."
        );

        // Set all state variables
        rsiOracleInstance = _rsiOracleInstance;
        lowerBound = _lowerBound;
        upperBound = _upperBound;
        rsiTimePeriod = _rsiTimePeriod;
        currentTrendAllocation = _initialTrendAllocation;
    }

    /*
     * Returns the percentage of base asset the calling Manager should allocate the RebalancingSetToken
     * to. If RSI is above upper bound then should be 100% allocated to base asset, if
     * RSI is below lower bound then should be 0% allocated to base asset. If in between bounds then
     * returns the allocation of the current trend.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function getBaseAssetAllocation()
        external
        returns (uint256)
    {
        // Query RSI oracle
        uint256 rsiValue = rsiOracleInstance.read(rsiTimePeriod);

        // Check RSI value is above upper bound or below lower bound
        bool isOutsideBounds = rsiValue >= upperBound || rsiValue < lowerBound;

        // If outside bounds trigger a change to currentTrendAllocation
        if (isOutsideBounds) {
            // If RSI greater than upper bound return max allocation of base asset
            // Else RSI less than lower bound return min allocation of base asset
            uint256 trendAllocation = rsiValue >= upperBound ? MAX_BASE_ASSET_ALLOCATION : MIN_BASE_ASSET_ALLOCATION;

            // Set currentTrendAllocation if trend has changed
            if (trendAllocation != currentTrendAllocation) {
                currentTrendAllocation = trendAllocation;
            }
        }

        // If rsi is inside bounds then just return currentTrendAllocation
        return currentTrendAllocation;
    }
}