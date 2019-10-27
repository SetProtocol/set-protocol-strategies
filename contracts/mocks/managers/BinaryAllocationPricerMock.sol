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

import { IAllocationPricer } from "../../managers/allocation-pricers/IAllocationPricer.sol";

/**
 * @title BinaryAllocationPricerMock
 * @author Set Protocol
 *
 * Mock of BinaryAllocationPricer used to test BaseTwoAssetStrategyManager.
 */
contract BinaryAllocationPricerMock is
     IAllocationPricer
{
    ISetToken public baseAssetCollateralInstance;
    ISetToken public quoteAssetCollateralInstance;
    uint256 public baseAssetCollateralValue;
    uint256 public quoteAssetCollateralValue;

    constructor(
        ISetToken _baseAssetCollateralInstance,
        ISetToken _quoteAssetCollateralInstance,
        uint256 _baseAssetCollateralValue,
        uint256 _quoteAssetCollateralValue
    )
        public
    {
        baseAssetCollateralInstance = _baseAssetCollateralInstance;
        quoteAssetCollateralInstance = _quoteAssetCollateralInstance;

        baseAssetCollateralValue = _baseAssetCollateralValue;
        quoteAssetCollateralValue = _quoteAssetCollateralValue;
    }

    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision,
        ISetToken _currentCollateralSet
    )
        external
        returns (address, uint256, uint256)
    {
        if (_targetBaseAssetAllocation == _allocationPrecision) {
            return (address(baseAssetCollateralInstance), quoteAssetCollateralValue, baseAssetCollateralValue);
        } else {
            return (address(quoteAssetCollateralInstance), baseAssetCollateralValue, quoteAssetCollateralValue);
        }
    }
}