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


/**
 * @title AllocationPricerMathLibrary
 * @author Set Protocol
 *
 * Library containing math helper function for AllocationPricer.
 */
library AllocationPricerMathLibrary {
    using SafeMath for uint256;

    /*
     * Rounds passed value to the nearest power of 2. 
     *
     * @param  _value         Value to be rounded to nearest power of 2
     * @return uint256        Rounded value
     */
    function roundToNearestPowerOfTwo(
        uint256 _value
    )
        internal
        pure
        returns (uint256)
    {
        // Make sure passed value is greater than 0
        require (
            _value > 0,
            "BinaryAllocationPricer.roundToNearestPowerOfTwo: Value must be greater than zero."
        );

        // Multiply by 1.5 to roughly approximate sqrt(2). Needed to round to nearest power of two. 
        uint256 scaledValue = _value.mul(3).div(2);
        uint256 power = 0;

        // Calculate nearest power of two
        if (scaledValue >= 0x100000000000000000000000000000000) { scaledValue >>= 128; power += 128; }
        if (scaledValue >= 0x10000000000000000) { scaledValue >>= 64; power += 64; }
        if (scaledValue >= 0x100000000) { scaledValue >>= 32; power += 32; }
        if (scaledValue >= 0x10000) { scaledValue >>= 16; power += 16; }
        if (scaledValue >= 0x100) { scaledValue >>= 8; power += 8; }
        if (scaledValue >= 0x10) { scaledValue >>= 4; power += 4; }
        if (scaledValue >= 0x4) { scaledValue >>= 2; power += 2; }
        if (scaledValue >= 0x2) power += 1; // No need to shift x anymore

        return 2 ** power;
    }

    /*
     * Gets the rounded up log10 of passed value
     *
     * @param  _value         Value to calculate ceil(log()) on
     * @return uint256        Output value
     */
    function ceilLog10(
        uint256 _value
    )
        internal
        pure 
        returns (uint256)
    {
        // Make sure passed value is greater than 0
        require (
            _value > 0,
            "BinaryAllocationPricer.ceilLog10: Value must be greater than zero."
        );

        // Since log10(1) = 0, if _value = 1 return 0
        if (_value == 1) return 0;

        // Calcualte ceil(log10())
        uint256 x = _value - 1;

        uint256 result = 0;

        if (x >= 10000000000000000000000000000000000000000000000000000000000000000) {
            x /= 10000000000000000000000000000000000000000000000000000000000000000;
            result += 64;
        }
        if (x >= 100000000000000000000000000000000) {
            x /= 100000000000000000000000000000000;
            result += 32;
        }
        if (x >= 10000000000000000) {
            x /= 10000000000000000;
            result += 16;
        }
        if (x >= 100000000) {
            x /= 100000000;
            result += 8;
        }
        if (x >= 10000) {
            x /= 10000;
            result += 4;
        }
        if (x >= 100) {
            x /= 100;
            result += 2;
        }
        if (x >= 10) {
            x /= 10;
            result += 1;
        }

        return result + 1;
    }
}