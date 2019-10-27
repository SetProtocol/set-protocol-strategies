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

import { IPriceTrigger } from "./IPriceTrigger.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";
import { IMetaOracleV2 } from "../../meta-oracles/interfaces/IMetaOracleV2.sol";


/**
 * @title MovingAverageToAssetPriceCrossoverTrigger
 * @author Set Protocol
 *
 * Implementing the IPriceTrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine if the market is in a bullish 
 * state by checking if the the trading pair price is above or below a simple
 * or exponential moving average.
 *
 * Below the moving average means the RebalancingSetToken should be in the
 * quote asset, above the moving average the RebalancingSetToken should be
 * in the base asset.
 */
contract MovingAverageToAssetPriceCrossoverTrigger is
    IPriceTrigger
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    IMetaOracleV2 public movingAveragePriceFeedInstance;
    IOracle public assetPairOracleInstance;
    uint256 public movingAverageDays;
    bool private lastConfirmedState;

    // Time to start of confirmation period in seconds
    uint256 public signalConfirmationMinTime;
    // Time to end of confirmation period in seconds
    uint256 public signalConfirmationMaxTime;
    uint256 public lastInitialTriggerTimestamp;

    /*
     * MovingAverageToAssetPriceCrossoverTrigger constructor.
     *
     * @param  _movingAveragePriceFeedInstance      The address of MA price feed
     * @param  _assetPairOracleInstance             The address of risk asset oracle
     * @param  _movingAverageDays                   The amount of days to use in moving average calculation
     * @param  _signalConfirmationMinTime           The amount of time, in seconds, until start of confirmation period
     * @param  _signalConfirmationMaxTime           The amount of time, in seconds, until end of confirmation period
     * @param  _initialState                        The trigger market state upond deployment
     */
    constructor(
        IMetaOracleV2 _movingAveragePriceFeedInstance,
        IOracle _assetPairOracleInstance,
        uint256 _movingAverageDays,
        uint256 _signalConfirmationMinTime,
        uint256 _signalConfirmationMaxTime,
        bool _initialState

    )
        public
    {
        // Set all state variables
        movingAveragePriceFeedInstance = _movingAveragePriceFeedInstance;
        assetPairOracleInstance = _assetPairOracleInstance;
        movingAverageDays = _movingAverageDays;
        signalConfirmationMinTime = _signalConfirmationMinTime;
        signalConfirmationMaxTime = _signalConfirmationMaxTime;
        lastConfirmedState = _initialState;
    }

    /* ============ External ============ */

    /*
     * If enough time has passed since last initial confirmation the current market state is
     * calculated then compared to the last confirmed market state. If current state differs
     * from last confirmed state then timestamp is logged to be used in calculating the start
     * and end of the confirmation period.
     */
    function initialTrigger()
        external
    {
        require(
            block.timestamp > lastInitialTriggerTimestamp.add(signalConfirmationMaxTime),
            "MovingAverageToAssetPriceCrossoverTrigger.initialTrigger: Not enough time passed from last initial crossover."
        );

        // Get current market state and check that it's different from last confirmed state
        bool currentMarketState = getCurrentMarketState();
        require(
            currentMarketState != lastConfirmedState,
            "MovingAverageToAssetPriceCrossoverTrigger.initialTrigger: Market conditions have not changed since last confirmed state."
        );

        lastInitialTriggerTimestamp = block.timestamp;
    }

    /*
     * If within the confirmation time period, the current market state is calculated then
     * compared to the last confirmed market state. If current state differs from last confirmed
     * state then the last confirmed state is updated to the current market state.
     */
    function confirmTrigger()
        external
    {
        // Make sure enough time has passed to initiate proposal on Rebalancing Set Token
        require(
            block.timestamp >= lastInitialTriggerTimestamp.add(signalConfirmationMinTime) &&
            block.timestamp <= lastInitialTriggerTimestamp.add(signalConfirmationMaxTime),
            "MovingAverageToAssetPriceCrossoverTrigger.confirmPropose: Confirming signal must be within bounds of the confirm propose."
        );

        // Get current market state and check that it's different from last confirmed state
        bool currentMarketState = getCurrentMarketState();
        require(
            currentMarketState != lastConfirmedState,
            "MovingAverageToAssetPriceCrossoverTrigger.confirmTrigger: Market conditions have not changed since last confirmed state."
        );

        lastConfirmedState = currentMarketState;
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
        return lastConfirmedState;
    }

    /* ============ Internal ============ */

    /*
     * Queries asset and moving average oracle then returns true if asset price exceeds moving
     * average otherwise returns false.
     *
     * @return             Whether market conditions are bullish (asset price is over MA)
     */
    function getCurrentMarketState()
        internal
        returns(bool)
    {
        // Query moving average and asset pair oracle
        uint256 movingAveragePrice = movingAveragePriceFeedInstance.read(movingAverageDays);
        uint256 assetPairPrice = assetPairOracleInstance.read();

        // If asset pair price greater than moving average return true, else return false
        return assetPairPrice > movingAveragePrice;        
    }
}