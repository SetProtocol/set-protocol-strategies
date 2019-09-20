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


/**
 * @title RSILibrary
 * @author Set Protocol
 *
 * Library for calculating the Relative Strength Index
 * 
 */
library RSILibrary{

    using SafeMath for uint256;

    /*
     * Calculates the new relative strength index value using
     * RSI time period, and the time series feed instance.
     *
     * RSI = 100 − 100 / 
     *       (1 + (Daily Average Gain / Daily Average Loss)
     *
     * Daily Price Difference = Price(N) - Price(N-1) where N is number of days
     * Daily Average Gain = Sum(Positive Daily Price Difference) / N 
     * Daily Average Loss = -1 * Sum(Positive Daily Price Difference) / N 
     * 
     *
     * Our implementation is simplified to the following for efficiency
     * RSI = 100 - (100 * SUM(Loss) / ((SUM(Loss) + SUM(Gain)))
     * 
     *
     * @param  _dataArray               Array of daily prices used to calculate the RSI
     * @returns                         The RSI value
     */
    function calculate(
        uint256[] memory _dataArray
    )
        internal
        view
        returns (uint256)
    {   
        uint256 positiveDataSum = 0;
        uint256 negativeDataSum = 0;

        for (uint256 i = 1; i < _dataArray.length; i++) {
            // If current day price is greater than previous day's
            if (_dataArray[i - 1] > _dataArray[i]) {
                positiveDataSum = positiveDataSum.add(_dataArray[i - 1]).sub(_dataArray[i]);
            }
            else {
                negativeDataSum = negativeDataSum.add(_dataArray[i]).sub(_dataArray[i - 1]);
            }
        }

        // Get rid of divide by 0
        if (negativeDataSum == 0 && positiveDataSum == 0) {
            negativeDataSum = 1;
        }
        
        uint256 hundred = 100;
        uint256 a = hundred.mul(negativeDataSum);
        uint256 b = positiveDataSum.add(negativeDataSum);
        uint256 c = a.div(b);

        return hundred.sub(c);
    }
}