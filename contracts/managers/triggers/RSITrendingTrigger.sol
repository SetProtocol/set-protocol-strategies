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
import { Oscillator } from "../lib/Oscillator.sol";


/**
 * @title RSITrending
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
    IMetaOracleV2 public rsiOracle;
    Oscillator.Bounds public bounds;
    uint256 public rsiTimePeriod;

    /*
     * RSITrendingTrigger constructor.
     *
     * @param  _rsiOracle               The address of RSI oracle
     * @param  _lowerBound              Lower bound of RSI to trigger a rebalance
     * @param  _upperBound              Upper bound of RSI to trigger a rebalance
     * @param  _rsiTimePeriod           The amount of days to use in RSI calculation
     */
    constructor(
        IMetaOracleV2 _rsiOracle,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint256 _rsiTimePeriod
    )
        public
    {
        require(
            _upperBound >= _lowerBound,
            "RSITrendingTrigger.constructor: Upper bound must be greater than lower bound."
        );

        // If upper bound less than 100 and above inequality holds then lowerBound
        // also guaranteed to be between 0 and 100.
        require(
            _upperBound < 100,
            "RSITrendingTrigger.constructor: Bounds must be between 0 and 100."
        );

        // RSI time period must be greater than 0
        require(
            _rsiTimePeriod > 0,
            "RSITrendingTrigger.constructor: RSI time period must be greater than 0."
        );

        rsiOracle = _rsiOracle;
        rsiTimePeriod = _rsiTimePeriod;
        bounds = Oscillator.Bounds({
            lower: _lowerBound,
            upper: _upperBound
        });
    }

    /* ============ External ============ */

    /*
     * If RSI is above upper bound then should be true, if RSI is below lower bound
     * then should be false. If in between bounds then revert.
     */
    function isBullish()
        external
        view
        returns (bool)
    {
        uint256 rsiValue = rsiOracle.read(rsiTimePeriod);
        Oscillator.State rsiState = Oscillator.getState(bounds, rsiValue);
        
        require(
            rsiState != Oscillator.State.NEUTRAL,
            "Oscillator: State must not be neutral"
        );

        return rsiState == Oscillator.State.UPPER;
    }
}