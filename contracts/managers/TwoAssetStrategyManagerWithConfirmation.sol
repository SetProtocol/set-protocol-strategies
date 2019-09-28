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

import { FlexibleTimingManagerLibrary } from "./lib/FlexibleTimingManagerLibrary.sol";
import { IAllocationPricer } from "./allocation-pricers/IAllocationPricer.sol";
import { IPriceTrigger } from "./price-triggers/IPriceTrigger.sol";


/**
 * @title TwoAssetStrategyManagerWithConfirmation
 * @author Set Protocol
 *
 * Rebalancing Manager contract for implementing any trading pair strategy based on arbitrarily defined
 * price triggers represented by the manager's PriceTrigger contract. Additionally, all allocations are
 * chosen using the manager's AllocationPricer contract. This manager requires confirmation for all
 * potential rebalances, the confirmation window is defined on deployment of the manager contract.
 */
contract TwoAssetStrategyManagerWithConfirmation {
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    ICore public coreInstance;
    IAuctionPriceCurve public auctionLibraryInstance;
    IPriceTrigger public priceTriggerInstance;
    IAllocationPricer public allocationPricerInstance;
    IRebalancingSetToken public rebalancingSetTokenInstance;
    uint256 public baseAssetAllocation;
    uint256 public auctionTimeToPivot;
    uint256 public auctionSpeed;
    uint256 public signalConfirmationMinTime;
    uint256 public signalConfirmationMaxTime;
    uint256 public lastCrossoverConfirmationTimestamp;
    address public contractDeployer;

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
     * @param  _signalConfirmationMinTime       The minimum time, in seconds, confirm signal an be called after the
     *                                          last initial crossover confirmation
     * @param  _signalConfirmationMaxTime       The maximum time, in seconds, confirm signal an be called after the
     *                                          last initial crossover confirmation
     */
    constructor(
        ICore _coreInstance,
        IPriceTrigger _priceTriggerInstance,
        IAllocationPricer _allocationPricerInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _auctionTimeToPivot,
        uint256 _auctionSpeed,
        uint256 _signalConfirmationMinTime,
        uint256 _signalConfirmationMaxTime
    )
        public
    {
        coreInstance = _coreInstance;
        priceTriggerInstance = _priceTriggerInstance;
        allocationPricerInstance = _allocationPricerInstance;
        auctionLibraryInstance = _auctionLibraryInstance;
        baseAssetAllocation = _baseAssetAllocation;
        auctionTimeToPivot = _auctionTimeToPivot;
        auctionSpeed = _auctionSpeed;
        signalConfirmationMinTime = _signalConfirmationMinTime;
        signalConfirmationMaxTime = _signalConfirmationMaxTime;
        contractDeployer = msg.sender;
    }

    /* ============ External ============ */

    /*
     * This function sets the Rebalancing Set Token address that the manager is associated with.
     * Since the rebalancing set token must first specify the address of the manager before deployment,
     * we cannot know what the rebalancing set token is in advance. This function is only meant to be called 
     * once during initialization by the contract deployer.
     *
     * @param  _rebalancingSetTokenInstance       The address of the rebalancing Set token
     */
    function initialize(
        IRebalancingSetToken _rebalancingSetTokenInstance
    )
        external
    {
        // Check that contract deployer is calling function
        require(
            msg.sender == contractDeployer,
            "MACOStrategyManager.initialize: Only the contract deployer can initialize"
        );

        // Make sure the rebalancingSetToken is tracked by Core
        require(
            coreInstance.validSets(address(_rebalancingSetTokenInstance)),
            "MACOStrategyManager.initialize: Invalid or disabled RebalancingSetToken address"
        );

        address currentCollateralSet = _rebalancingSetTokenInstance.currentSet();

        ISetToken expectedCollateral = baseAssetAllocation == 100 ? allocationPricerInstance.baseAssetCollateralInstance() :
            allocationPricerInstance.quoteAssetCollateralInstance();

        require(
            currentCollateralSet == address(expectedCollateral),
            "MACOStrategyManager.initialize: Rebalancing Set collateral must match collateral on allocation pricer."
        );

        rebalancingSetTokenInstance = _rebalancingSetTokenInstance;
        contractDeployer = address(0);
    }

    /*
     * When allowed on RebalancingSetToken, anyone can call for a new rebalance proposal. Assuming the criteria
     * have been met, this begins a six hour period where the signal can be confirmed before moving ahead with
     * the rebalance.
     *
     */
    function initialPropose()
        external
    {
        // Make sure propose in manager hasn't already been initiated
        require(
            block.timestamp > lastCrossoverConfirmationTimestamp.add(signalConfirmationMaxTime),
            "MACOStrategyManager.initialPropose: Not enough time passed from last proposal."
        );
        
        // Create interface to interact with RebalancingSetToken and check enough time has passed for proposal
        FlexibleTimingManagerLibrary.validateManagerPropose(rebalancingSetTokenInstance);
        
        // Get new baseAsset allocation amount
        uint256 newBaseAssetAllocation = priceTriggerInstance.getBaseAssetAllocation();

        // Check that new baseAsset allocation amount is different from current allocation amount
        require(
            newBaseAssetAllocation != baseAssetAllocation,
            "TwoAssetStrategyManagerWithConfirmation.initialPropose: Price trigger not met."
        );     

        // Set crossover confirmation timestamp
        lastCrossoverConfirmationTimestamp = block.timestamp;
    }

    /*
     * After initial propose is called, confirm the signal has been met and determine parameters for the rebalance
     *
     */
    function confirmPropose()
        external
    {
        // Make sure enough time has passed to initiate proposal on Rebalancing Set Token
        require(
            block.timestamp >= lastCrossoverConfirmationTimestamp.add(signalConfirmationMinTime) &&
            block.timestamp <= lastCrossoverConfirmationTimestamp.add(signalConfirmationMaxTime),
            "MACOStrategyManager.confirmPropose: Confirming signal must be within bounds of the initial propose"
        );

        // Create interface to interact with RebalancingSetToken and check enough time has passed for proposal
        FlexibleTimingManagerLibrary.validateManagerPropose(rebalancingSetTokenInstance);
        
        // Get new baseAsset allocation amount
        uint256 newBaseAssetAllocation = priceTriggerInstance.getBaseAssetAllocation();

        // Check that new baseAsset allocation amount is different from current allocation amount
        require(
            newBaseAssetAllocation != baseAssetAllocation,
            "TwoAssetStrategyManagerWithConfirmation.confirmPropose: Price trigger not met."
        );

        // Get current collateral Set
        address currentCollateralSetAddress = rebalancingSetTokenInstance.currentSet();        

        // If price trigger has been met, get next Set allocation. Create new set if price difference is too
        // great to run good auction. Return nextSet address and dollar value of current and next set
        (
            address nextSetAddress,
            uint256 currentSetDollarValue,
            uint256 nextSetDollarValue
        ) = allocationPricerInstance.determineNewAllocation(
            newBaseAssetAllocation,
            ISetToken(currentCollateralSetAddress)
        );

        // Get auction price divisor
        uint256 auctionPriceDivisor = auctionLibraryInstance.priceDivisor();

        // Calculate the price parameters for auction
        (
            uint256 auctionStartPrice,
            uint256 auctionPivotPrice
        ) = FlexibleTimingManagerLibrary.calculateAuctionPriceParameters(
            currentSetDollarValue,
            nextSetDollarValue,
            auctionSpeed,
            auctionPriceDivisor,
            auctionTimeToPivot
        );

        // Propose new allocation to Rebalancing Set Token
        rebalancingSetTokenInstance.propose(
            nextSetAddress,
            address(auctionLibraryInstance),
            auctionTimeToPivot,
            auctionStartPrice,
            auctionPivotPrice
        );

        // Set baseAssetAllocation to new allocation amount
        baseAssetAllocation = newBaseAssetAllocation;
    }
}