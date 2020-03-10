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

/**
 * @title IMACOStrategyManagerV2
 * @author Set Protocol
 *
 * Interface for interacting with MACOStrategyManagerV2 contracts
 */
interface IMACOStrategyManagerV2 {
    function crossoverConfirmationMinTime() external view returns (uint256);
    function crossoverConfirmationMaxTime() external view returns (uint256);
}

