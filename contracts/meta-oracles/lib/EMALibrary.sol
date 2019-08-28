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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

import { CommonMath } from "set-protocol-contracts/contracts/lib/CommonMath.sol";


/**
 * @title EMALibrary
 * @author Set Protocol
 *
 * Library for calculate the Exponential Moving Average
 * 
 */
library EMALibrary{

    using SafeMath for uint256;
    using CommonMath for uint256;

    /*
     * Calculates the new exponential moving average value using the previous value,
     * EMA time period, and the current asset price.
     *
     * Weighted Multiplier = 2 / (timePeriod + 1)
     *
     * EMA = Price(Today) x Weighted Multiplier +
     *       EMA(Yesterday) - 
     *       EMA(Yesterday) x Weighted Multiplier
     *
     * @param  _previousEMAValue         The previous Exponential Moving average value         
     * @param  _timePeriod               The number of days the calculate the EMA with         
     * @param  _currentAssetPrice        The current asset price                
     * @returns                          The exponential moving average
     */
    function calculate(
        uint256 _previousEMAValue,
        uint256 _timePeriod,
        uint256 _currentAssetPrice
    )
        internal
        view
        returns (uint256)
    {
        uint256 weightedMultiplierNumerator = 2;
        uint256 weightedMultiplierDenominator = _timePeriod.add(1);

        uint256 currentWeightedValue = _currentAssetPrice.getPartialAmount(
            weightedMultiplierNumerator,
            weightedMultiplierDenominator
        );

        uint256 previousWeightedValue = _previousEMAValue.getPartialAmount(
            weightedMultiplierNumerator,
            weightedMultiplierDenominator
        );

        return currentWeightedValue.add(_previousEMAValue).sub(previousWeightedValue);
    }
}