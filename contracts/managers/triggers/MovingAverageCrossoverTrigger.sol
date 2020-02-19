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
import { IOracle } from "set-protocol-oracles/contracts/meta-oracles/interfaces/IOracle.sol";
import { IMetaOracleV2 } from "set-protocol-oracles/contracts/meta-oracles/interfaces/IMetaOracleV2.sol";

import { ITrigger } from "./ITrigger.sol";


/**
 * @title MovingAverageCrossoverTrigger
 * @author Set Protocol
 *
 * Implementing the ITrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine if the market is in a bullish 
 * state by checking if the the trading pair price is above or below a moving average.
 */
contract MovingAverageCrossoverTrigger is
    ITrigger
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    IMetaOracleV2 public movingAveragePriceFeedInstance;
    IOracle public assetPairOracleInstance;
    uint256 public movingAverageDays;

    /*
     * MovingAverageCrossoverTrigger constructor.
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
        movingAveragePriceFeedInstance = _movingAveragePriceFeedInstance;
        assetPairOracleInstance = _assetPairOracleInstance;
        movingAverageDays = _movingAverageDays;
    }

    /* ============ External ============ */

    /*
     * If asset pair price greater than moving average return true, else return false
     */
    function isBullish() external view returns (bool) {
        uint256 movingAverage = movingAveragePriceFeedInstance.read(movingAverageDays);
        uint256 assetPairPrice = assetPairOracleInstance.read();

        return assetPairPrice > movingAverage;  
    }
}