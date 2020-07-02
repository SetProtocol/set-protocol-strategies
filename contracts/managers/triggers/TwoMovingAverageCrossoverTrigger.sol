/*
    Copyright 2020 Set Labs Inc.

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
import { IMetaOracleV2 } from "set-protocol-oracles/contracts/meta-oracles/interfaces/IMetaOracleV2.sol";

import { ITrigger } from "./ITrigger.sol";


/**
 * @title TwoMovingAverageCrossoverTrigger
 * @author Set Protocol
 *
 * Implementing the ITrigger interface, this contract is queried by a
 * RebalancingSetToken Manager to determine if the market is in a bullish 
 * state by checking if the shorter term moving average is above the longer term
 * moving average. 
 * Note: The MA oracles can be the same or different contracts to allow flexbility of timeframes
 * and types of moving averages (EMA, SMA)
 */
contract TwoMovingAverageCrossoverTrigger is
    ITrigger
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    IMetaOracleV2 public shortTermMAOracle;
    IMetaOracleV2 public longTermMAOracle;
    uint256 public shortTermMATimePeriod;
    uint256 public longTermMATimePeriod;

    /*
     * TwoMovingAverageCrossoverTrigger constructor.
     *
     * @param  _longTermMAOracle          The instance of longer term MA oracle
     * @param  _shortTermMAOracle         The instance of shorter term MA oracle
     * @param  _longTermMATimePeriod      The time period in the longer term MA oracle to use in the calculation
     * @param  _shortTermMATimePeriod     The time period in the shorter term MA oracle to use in the calculation
     */
    constructor(
        IMetaOracleV2 _longTermMAOracle,
        IMetaOracleV2 _shortTermMAOracle,
        uint256 _longTermMATimePeriod,
        uint256 _shortTermMATimePeriod
    )
        public
    {
        longTermMAOracle = _longTermMAOracle;
        shortTermMAOracle = _shortTermMAOracle;
        longTermMATimePeriod = _longTermMATimePeriod;
        shortTermMATimePeriod = _shortTermMATimePeriod;
    }

    /* ============ External ============ */

    /*
     * If shorter term MA is greater than longer term MA return true, else return false
     */
    function isBullish() external view returns (bool) {
        uint256 longTermMovingAverage = longTermMAOracle.read(longTermMATimePeriod);
        uint256 shortTermMovingAverage = shortTermMAOracle.read(shortTermMATimePeriod);

        return shortTermMovingAverage > longTermMovingAverage;
    }
}