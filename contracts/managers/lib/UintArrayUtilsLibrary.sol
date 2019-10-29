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
 * @title UintArrayUtilsLibrary
 * @author Set Protocol
 *
 * Library of utility functions for uint arrays.
 */
library UintArrayUtilsLibrary {
    using SafeMath for uint256;
    
    /*
     * Calculate the sum of values in an uint256 array.
     *
     * @param  _array        Array of uint256 values
     * @return uint256       Sum of array values
     */
    function sumArrayValues(
        uint256[] calldata _array
    )
        external
        pure
        returns (uint256)
    {
        uint256 weightSum = 0;
        for (uint8 i = 0; i < _array.length; i++) {
            weightSum = weightSum.add(_array[i]);
        }

        return weightSum;
    }
}