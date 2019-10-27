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
 * @title TwoAssetWeightedStrategyManager
 * @author Set Protocol
 *
 * Inherits from BaseTwoAssetStrategyManager and implements interface to calculate base asset allocation based on
 * passed in price triggers and the weights assigned to those price triggers.
 */
contract TwoAssetWeightedStrategyManager is
    BaseTwoAssetStrategyManager
{
    /* ============ State Variables ============ */
    IPriceTrigger[] public priceTriggers;
    uint8[] public triggerWeights;
    uint256 public allocationPrecision;

    /* ============ Constructors ============ */
    /*
     * TwoAssetStrategyManagerWithConfirmation constructor.
     *
     * @param  _coreInstance                    The address of the Core contract
     * @param  _priceTriggerInstance            The address of the PriceTrigger to be used in the strategy         
     * @param  _allocationPricerInstance        The address of the AllocationPricer to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _auctionTimeToPivot              The amount of time until pivot reached in rebalance
     * @param  _auctionSpeed                    Time, in seconds, where 1% of prices are explored during auction
     * @param  _priceTriggers                   Addresses of the various priceTriggers used to determine base asset allocation
     * @param  _triggerWeights                  Weight (out of 100) to assign to price trigger in matching slot of priceTriggers array
     */
    constructor(
        ICore _coreInstance,
        IAllocationPricer _allocationPricerInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _allocationPrecision,
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
            _allocationPrecision,
            _auctionTimeToPivot,
            _auctionSpeed
        )
    {
        // Check that priceTriggers and triggerWeights arrays are of equal length
        require(
            _priceTriggers.length == _triggerWeights.length,
            "TwoAssetWeightedStrategyManager.constructor: Number of triggers must match, number of weights."
        );

        // Sum weights of _triggerWeights array
        uint8 weightSum = 0;
        for (uint8 i = 0; i < _priceTriggers.length; i++) {
            weightSum += _triggerWeights[i];
        }

        // Require that weights equal allocation precision
        require(
            weightSum == _allocationPrecision,
            "TwoAssetWeightedStrategyManager.constructor: Weights must sum to 100."
        );        

        priceTriggers = _priceTriggers;
        triggerWeights = _triggerWeights;
    }

    /* ============ External ============ */

    /*
     * Cycles through each price trigger and if returns true adds the weight amount to allocation sum.
     * Returns results after all price triggers have been checked.
     *
     * @return             Base asset allocation amount
     */
    function calculateBaseAssetAllocation()
        public
        view
        returns (uint256)
    {
        uint256 allocationSum = 0;

        // Cycle through price triggers and add their weight if trigger is bullish
        for (uint8 i = 0; i < priceTriggers.length; i++) {
            allocationSum += priceTriggers[i].isBullish() ? triggerWeights[i] : 0;
        }

        return allocationSum;
    }

    /* ============ Getters ============ */

    /*
     * Return array of all price triggers used in base asset allocation calculation
     *
     * @return             Array of price triggers
     */
    function getPriceTriggers()
        external
        view
        returns (IPriceTrigger[] memory)
    {
        return priceTriggers;
    }

    /*
     * Return array of all price trigger weights used in base asset allocation calculation
     *
     * @return             Array of price trigger weights
     */
    function getTriggerWeights()
        external
        view
        returns (uint8[] memory)
    {
        return triggerWeights;
    }
}