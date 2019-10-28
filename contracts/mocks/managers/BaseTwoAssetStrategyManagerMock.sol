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
import { IAuctionPriceCurve } from "set-protocol-contracts/contracts/core/lib/auction-price-libraries/IAuctionPriceCurve.sol";
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { IRebalancingSetToken } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetToken.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";

import { BaseTwoAssetStrategyManager } from "../../managers/BaseTwoAssetStrategyManager.sol";
import { IAllocationPricer } from "../../managers/allocation-pricers/IAllocationPricer.sol";


/**
 * @title BaseTwoAssetStrategyManagerMock
 * @author Set Protocol
 *
 * Mock for testing BaseTwoAssetStrategyManager.
 */
contract BaseTwoAssetStrategyManagerMock is
    BaseTwoAssetStrategyManager
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    uint256 public allocation;

    /*
     * TwoAssetStrategyManagerWithConfirmation constructor.
     *
     * @param  _coreInstance                    The address of the Core contract
     * @param  _allocationPricerInstance        The address of the AllocationPricer to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _auctionStartPercentage          The amount below fair value, in percent, to start auction
     * @param  _auctionEndPercentage            The amount above fair value, in percent, to end auction
     * @param  _auctionTimeToPivot              The amount of time until pivot reached in rebalance
     */
    constructor(
        ICore _coreInstance,
        IAllocationPricer _allocationPricerInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _allocationPrecision,
        uint256 _auctionStartPercentage,
        uint256 _auctionEndPercentage,
        uint256 _auctionTimeToPivot
    )
        public
        BaseTwoAssetStrategyManager(
            _coreInstance,
            _allocationPricerInstance,
            _auctionLibraryInstance,
            _baseAssetAllocation,
            _allocationPrecision,
            _auctionStartPercentage,
            _auctionEndPercentage,
            _auctionTimeToPivot
        )
    {
        allocation = _baseAssetAllocation;
    }

    function setAllocation(
        uint256 _allocation
    )
        external
    {
        allocation = _allocation;
    }

    function calculateBaseAssetAllocation()
        public
        view
        returns (uint256)
    {
        return allocation;
    }
}