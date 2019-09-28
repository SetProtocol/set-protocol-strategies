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
    /* ============ Constants ============ */
    uint256 constant MAX_BASE_ASSET_ALLOCATION = 100;
    uint256 constant MIN_BASE_ASSET_ALLOCATION = 0;

    /* ============ State Variables ============ */
    IMetaOracleV2 public movingAveragePriceFeedInstance;
    IOracle public assetPairOracleInstance;
    uint256 public movingAverageDays;

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
        uint256 _movingAverageDays
    )
        public
    {
        // Set all state variables
        movingAveragePriceFeedInstance = _movingAveragePriceFeedInstance;
        assetPairOracleInstance = _assetPairOracleInstance;
        movingAverageDays = _movingAverageDays;
    }

    /*
     * Returns the percentage of base asset the calling Manager should allocate the RebalancingSetToken
     * to. If asset pair price is above moving average then should be 100% allocated to base asset, if
     * asset pair price is below moving average then should be 0% allocated to base asset.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function getBaseAssetAllocation()
        external
        view
        returns (uint256)
    {
        // Query moving average and asset pair oracle
        uint256 movingAveragePrice = movingAveragePriceFeedInstance.read(movingAverageDays);
        uint256 assetPairPrice = assetPairOracleInstance.read();

        // If asset pair price greater than moving average return max allocation of base asset, else return
        // min allocation
        return assetPairPrice > movingAveragePrice ? MAX_BASE_ASSET_ALLOCATION : MIN_BASE_ASSET_ALLOCATION;
    }
}