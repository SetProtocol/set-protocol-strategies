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
 * @title IPriceTrigger
 * @author Set Protocol
 *
 * Interface for interacting with PriceTrigger contracts
 */
interface ITrigger {

    event TriggerFlipped(
        bool _flipTo,
        uint256 _triggerFlippedIndex,
        uint256 _timestamp
    );

    /*
     * Returns bool indicating whether the current market conditions are bullish.
     *
     * @return             The percentage of base asset to be allocated to
     */
    function isBullish()
        external
        view
        returns (bool);

    /*
     * For triggers that require confirmation, start the confirmation period.
     */
    function initialTrigger()
        external;

    /*
     * Confirm the signal.
     */
    function confirmTrigger()
        external;

    /*
     * Check if initialTrigger can be successfully called.
     */
    function canInitialTrigger()
        external
        view
        returns (bool);

    /*
     * Check if confirmTrigger can be successfully called.
     */
    function canConfirmTrigger()
        external
        view
        returns (bool);
}