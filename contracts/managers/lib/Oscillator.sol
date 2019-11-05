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


/**
 * @title Oscillator
 * @author Set Protocol
 *
 * Library of utility functions to deal with oscillator-related functionality.
 */
library Oscillator {
    
    enum State { UPPER, LOWER, NEUTRAL }

    // Oscillator bounds typically between 0 and 100
    struct Bounds {
        uint256 lower;
        uint256 upper;
    }

    /*
     * Returns upper of value is greater or equal to upper bound.
     * Returns lower if lower than lower bound, and neutral if in between.
     */
    function getState(
        Bounds storage _bounds,
        uint256 _value
    )
        internal
        view
        returns(State)
    {
        return _value >= _bounds.upper ? State.UPPER : 
            _value < _bounds.lower ? State.LOWER : State.NEUTRAL;
    }
}