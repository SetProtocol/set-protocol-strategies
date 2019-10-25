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

import { BaseTwoAssetStrategyManager } from "./BaseTwoAssetStrategyManager.sol";
import { IAllocationPricer } from "./allocation-pricers/IAllocationPricer.sol";
import { IPriceTrigger } from "./price-triggers/IPriceTrigger.sol";


/**
 * @title BaseTwoAssetStrategyManagerMock
 * @author Set Protocol
 *
 * Mock for testing BaseTwoAssetStrategyManager.
 */
contract TwoAssetWeightedStrategyManager is
    BaseTwoAssetStrategyManager
{
    /* ============ State Variables ============ */
    IPriceTrigger[] public priceTriggers;
    uint8[] public triggerWeights;

    /* ============ Constructors ============ */
    /*
     * TwoAssetStrategyManagerWithConfirmation constructor.
     *
     * @param  _coreInstance                    The address of the Core contract
     * @param  _priceTriggerInstance            The address of the PriceTrigger to be used in the strategy         
     * @param  _allocationPricerInstance        The address of the AllocationPricer to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _auctionTimeToPivot              The amount of time until pivot reached in rebalance
     * @param  _auctionSpeed                    Time, in seconds, where 1% of prices are explored during auction
     */
    constructor(
        ICore _coreInstance,
        IAllocationPricer _allocationPricerInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _auctionTimeToPivot,
        uint256 _auctionSpeed,
        IPriceTrigger[] memory _priceTriggers,
        uint8[] memory _triggerWeights
    )
        public
        BaseTwoAssetStrategyManager(
            _coreInstance,
            _allocationPricerInstance,
            _auctionLibraryInstance,
            _baseAssetAllocation,
            _auctionTimeToPivot,
            _auctionSpeed
        )
    {
        require(
            _priceTriggers.length == _triggerWeights.length,
            "TwoAssetWeightedStrategyManager.constructor: Number of triggers must match, number of weights."
        );

        uint8 weightSum = 0;
        for (uint8 i = 0; i < _priceTriggers.length; i++) {
            weightSum += _triggerWeights[i];
        }

        require(
            weightSum == 100,
            "TwoAssetWeightedStrategyManager.constructor: Weights must sum to 100."
        );        

        priceTriggers = _priceTriggers;
        triggerWeights = _triggerWeights;
    }

    /* ============ External ============ */
    function calculateBaseAssetAllocation()
        public
        view
        returns (uint256)
    {
        uint256 allocationSum = 0;
        for (uint8 i = 0; i < priceTriggers.length; i++) {
            allocationSum += priceTriggers[i].isBullish() ? triggerWeights[i] : 0;
        }

        return allocationSum;
    }

    /* ============ Getters ============ */
    function getPriceTriggers()
        external
        view
        returns (IPriceTrigger[] memory)
    {
        return priceTriggers;
    }

    function getTriggerWeights()
        external
        view
        returns (uint8[] memory)
    {
        return triggerWeights;
    }
}