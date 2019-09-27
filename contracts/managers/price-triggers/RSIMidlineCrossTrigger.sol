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
 * @title RSIMidlineCrossTrigger
 * @author Set Protocol
 *
 * Implementing the IPriceTrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine the amount of base asset to be
 * allocated to by checking if the the RSI is above or below certain values.
 *
 * Below the RSI level of lowerBound means the RebalancingSetToken should be in the
 * quote asset, above the upperBound the RebalancingSetToken should be
 * in the base asset.
 */
contract RSIMidlineCrossTrigger is
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

    /*
     * RSIMidlineCrossTrigger constructor.
     *
     * @param  _rsiOracleInstance        The address of RSI oracle
     * @param  _lowerBound               Lower bound of RSI to trigger a rebalance
     * @param  _upperBound               Upper bound of RSI to trigger a rebalance
     * @param  _rsiTimePeriod            The amount of days to use in RSI calculation
     */
    constructor(
        IMetaOracleV2 _rsiOracleInstance,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint256 _rsiTimePeriod
    )
        public
    {
        // Check that upper bound value must be greater than lower bound value
        require(
            _upperBound > _lowerBound,
            "RSIMidlineCrossTrigger.constructor: Upper bound must be greater than lower bound"
        );

        // Set all state variables
        rsiOracleInstance = _rsiOracleInstance;
        lowerBound = _lowerBound;
        upperBound = _upperBound;
        rsiTimePeriod = _rsiTimePeriod;
    }

    /*
     * Returns the percentage of base asset the calling Manager should allocate the RebalancingSetToken
     * to. If RSI is above upper bound then should be 100% allocated to base asset, if
     * RSI is below lower bound then should be 0% allocated to base asset. Else function reverts.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function checkPriceTrigger()
        external
        view
        returns (uint256)
    {
        // Query RSI oracle
        uint256 rsiValue = rsiOracleInstance.read(rsiTimePeriod);

        // Check RSI value is above upper bound or below lower bound to trigger a rebalance
        require(
            rsiValue >= upperBound || rsiValue <= lowerBound,
            "RSIMidlineCrossTrigger.checkPriceTrigger: RSI must be below lower bound or above upper bound"
        );

        // If RSI greater than upper bound return max allocation of base asset
        // Else RSI less than lower bound return min allocation of base asset
        return rsiValue >= upperBound ? MAX_BASE_ASSET_ALLOCATION : MIN_BASE_ASSET_ALLOCATION;
    }
}