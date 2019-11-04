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
 * @title TriggerMock
 * @author Set Protocol
 *
 * Mock implementing ITrigger
 */
contract TriggerMock {

    bool private currentTrendState;

    /*
     * RSITrendingTrigger constructor.
     *
     * @param  _initialTrendState       Boolean indiciating if currently in bullish state
     */
    constructor(
        bool _initialTrendState
    )
        public
    {
        // Set all state variables
        currentTrendState = _initialTrendState;
    }

    /*
     * Returns bool indicating whether the current market conditions are bullish.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function isBullish()
        external
        view
        returns (bool)
    {
        return currentTrendState;
    }

    /*
     * For triggers that require confirmation, start the confirmation period.
     */
    function initialTrigger()
        external
    {}

    /*
     * For triggers that require confirmation, confirm the signal.
     */
    function confirmTrigger()
        external
    {
        currentTrendState = !currentTrendState;
    }
}