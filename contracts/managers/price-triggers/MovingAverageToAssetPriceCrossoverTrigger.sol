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
 * RebalancingSetToken Manager to determine the amount of base asset to be
 * allocated to by checking if the the trading pair price is above or below
 * a simple or exponential moving average.
 *
 * Below the moving average means the RebalancingSetToken should be in the
 * quote asset, above the moving average the RebalancingSetToken should be
 * in the base asset.
 */
contract MovingAverageToAssetPriceCrossoverTrigger is
    IPriceTrigger
{
    using SafeMath for uint256;

    /* ============ Constants ============ */
    uint256 constant MAX_BASE_ASSET_ALLOCATION = 100;
    uint256 constant MIN_BASE_ASSET_ALLOCATION = 0;

    /* ============ State Variables ============ */
    IMetaOracleV2 public movingAveragePriceFeedInstance;
    IOracle public assetPairOracleInstance;
    uint256 public movingAverageDays;
    uint256 private lastConfirmedAllocation;

    uint256 public signalConfirmationMinTime;
    uint256 public signalConfirmationMaxTime;
    uint256 public lastInitialTriggerTimestamp;

    /*
     * MovingAverageToAssetPriceCrossoverTrigger constructor.
     *
     * @param  _movingAveragePriceFeedInstance      The address of MA price feed
     * @param  _assetPairOracleInstance             The address of risk asset oracle
     * @param  _movingAverageDays                   The amount of days to use in moving average calculation
     */
    constructor(
        IMetaOracleV2 _movingAveragePriceFeedInstance,
        IOracle _assetPairOracleInstance,
        uint256 _movingAverageDays,
        uint256 _initialAllocation,
        uint256 _signalConfirmationMinTime,
        uint256 _signalConfirmationMaxTime

    )
        public
    {
        // Set all state variables
        movingAveragePriceFeedInstance = _movingAveragePriceFeedInstance;
        assetPairOracleInstance = _assetPairOracleInstance;
        movingAverageDays = _movingAverageDays;
        signalConfirmationMinTime = _signalConfirmationMinTime;
        signalConfirmationMaxTime = _signalConfirmationMaxTime;
        lastConfirmedAllocation = _initialAllocation;
    }

    /* ============ External ============ */

    function initialTrigger()
        external
    {
        require(
            block.timestamp > lastInitialTriggerTimestamp.add(signalConfirmationMaxTime),
            "MovingAverageToAssetPriceCrossoverTrigger.initialTrigger: Not enough time passed from last initial crossover."
        );

        // Get current market allocation and check that it's different from last confirmed allocation
        uint256 currentMarketAllocation = getCurrentMarketAllocation();
        require(
            currentMarketAllocation != lastConfirmedAllocation,
            "MovingAverageToAssetPriceCrossoverTrigger.initialTrigger: Market conditions have not changed since last confirmed allocation."
        );

        lastInitialTriggerTimestamp = block.timestamp;
    }

    function confirmTrigger()
        external
    {
        // Make sure enough time has passed to initiate proposal on Rebalancing Set Token
        require(
            block.timestamp >= lastInitialTriggerTimestamp.add(signalConfirmationMinTime) &&
            block.timestamp <= lastInitialTriggerTimestamp.add(signalConfirmationMaxTime),
            "MACOStrategyManager.confirmPropose: Confirming signal must be within bounds of the initial propose"
        );

        // Get current market allocation and check that it's different from last confirmed allocation
        uint256 currentMarketAllocation = getCurrentMarketAllocation();
        require(
            currentMarketAllocation != lastConfirmedAllocation,
            "MovingAverageToAssetPriceCrossoverTrigger.confirmTrigger: Market conditions have not changed since last confirmed allocation."
        );

        lastConfirmedAllocation = currentMarketAllocation;
    }

    /*
     * Returns the percentage of base asset the calling Manager should allocate the RebalancingSetToken
     * to. If asset pair price is above moving average then should be 100% allocated to base asset, if
     * asset pair price is below moving average then should be 0% allocated to base asset.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function retrieveBaseAssetAllocation()
        external
        returns (uint256)
    {
        return lastConfirmedAllocation;
    }

    /* ============ Internal ============ */

    function getCurrentMarketAllocation()
        internal
        returns(uint256)
    {
        // Query moving average and asset pair oracle
        uint256 movingAveragePrice = movingAveragePriceFeedInstance.read(movingAverageDays);
        uint256 assetPairPrice = assetPairOracleInstance.read();

        // If asset pair price greater than moving average return max allocation of base asset, else return
        // min allocation
        return assetPairPrice > movingAveragePrice ? MAX_BASE_ASSET_ALLOCATION : MIN_BASE_ASSET_ALLOCATION;        
    }
}