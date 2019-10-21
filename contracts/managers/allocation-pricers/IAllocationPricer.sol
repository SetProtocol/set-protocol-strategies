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

import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";

/**
 * @title IAllocationPricer
 * @author Set Protocol
 *
 * Interface for interacting with AllocationPricer contracts
 */
interface IAllocationPricer {

    /*
     * Determine the next allocation to rebalance into.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @return address                          The address of the proposed nextSet
     * @return uint256                          The USD value of current Set
     * @return uint256                          The USD value of next Set
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        ISetToken _currentCollateralSet
    )
        external
        returns (address, uint256, uint256);
}