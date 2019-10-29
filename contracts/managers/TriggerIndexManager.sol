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

import { TwoAssetStrategyManager } from "./TwoAssetStrategyManager.sol";
import { IAllocator } from "./allocators/IAllocator.sol";
import { ITrigger } from "./triggers/ITrigger.sol";
import { UintArrayUtilsLibrary } from "./lib/UintArrayUtilsLibrary.sol";


/**
 * @title TriggerIndexManager
 * @author Set Protocol
 *
 * Inherits from TwoAssetStrategyManager and implements interface to calculate base asset allocation based on
 * passed in price triggers and the weights assigned to those price triggers.
 */
contract TriggerIndexManager is
    TwoAssetStrategyManager
{
    using SafeMath for uint256;
    using UintArrayUtilsLibrary for uint256[];

    /* ============ State Variables ============ */
    ITrigger[] public triggers;
    uint256[] public triggerWeights;
    uint256 public allocationPrecision;

    /* ============ Constructors ============ */
    /*
     * TriggerIndexManager constructor.
     *
     * @param  _coreInstance                    The address of the Core contract
     * @param  _priceTriggerInstance            The address of the PriceTrigger to be used in the strategy         
     * @param  _allocatorInstance               The address of the Allocator to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _auctionStartPercentage          The amount below fair value, in percent, to start auction
     * @param  _auctionEndPercentage            The amount above fair value, in percent, to end auction
     * @param  _auctionTimeToPivot              Time, in seconds, spent between start and pivot price
     * @param  _triggers                        Addresses of the various triggers used to determine base asset allocation
     * @param  _triggerWeights                  Weight (out of 100) to assign to price trigger in matching slot of triggers array
     */
    constructor(
        ICore _coreInstance,
        IAllocator _allocatorInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _allocationPrecision,
        uint256 _auctionStartPercentage,
        uint256 _auctionEndPercentage,
        uint256 _auctionTimeToPivot,
        ITrigger[] memory _triggers,
        uint256[] memory _triggerWeights
    )
        public
        TwoAssetStrategyManager(
            _coreInstance,
            _allocatorInstance,
            _auctionLibraryInstance,
            _baseAssetAllocation,
            _allocationPrecision,
            _auctionStartPercentage,
            _auctionEndPercentage,
            _auctionTimeToPivot
        )
    {
        // Check that triggers and triggerWeights arrays are of equal length
        require(
            _triggers.length == _triggerWeights.length,
            "TriggerIndexManager.constructor: Number of triggers must match, number of weights."
        );

        // Sum weights of _triggerWeights array
        uint256 weightSum = _triggerWeights.sumArrayValues();

        // Require that weights equal allocation precision
        require(
            weightSum == _allocationPrecision,
            "TriggerIndexManager.constructor: Weights must sum to 100."
        );        
        // uint256 test = _auctionStartPercentage.add(_auctionEndPercentage);
        triggers = _triggers;
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
        for (uint8 i = 0; i < triggers.length; i++) {
            uint256 addedAllocation = triggers[i].isBullish() ? triggerWeights[i] : 0;
            allocationSum = allocationSum.add(addedAllocation);
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
        returns (ITrigger[] memory)
    {
        return triggers;
    }

    /*
     * Return array of all price trigger weights used in base asset allocation calculation
     *
     * @return             Array of price trigger weights
     */
    function getTriggerWeights()
        external
        view
        returns (uint256[] memory)
    {
        return triggerWeights;
    }
}