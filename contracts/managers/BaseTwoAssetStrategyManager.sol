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
 * @title BaseTwoAssetStrategyManager
 * @author Set Protocol
 *
 * Base Rebalancing Manager contract for implementing any trading pair strategy. Allocation determinations
 * are implemented in a contract that inherits the functionality of this contract. Additionally, all allocations are
 * priced using the base contracts's AllocationPricer contract.
 */
contract BaseTwoAssetStrategyManager {
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    ICore public coreInstance;
    IAuctionPriceCurve public auctionLibraryInstance;
    IAllocationPricer public allocationPricerInstance;
    IRebalancingSetToken public rebalancingSetTokenInstance;
    uint256 public baseAssetAllocation;  // Percent of base asset currently allocated in strategy
    uint256 public allocationPrecision;
    uint256 public auctionTimeToPivot;
    uint256 public auctionSpeed;  // The amount of seconds to explore 1% of prices
    address public initializerAddress;

    /*
     * TwoAssetStrategyManagerWithConfirmation constructor.
     *
     * @param  _coreInstance                    The address of the Core contract       
     * @param  _allocationPricerInstance        The address of the AllocationPricer to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _auctionTimeToPivot              The amount of time until pivot reached in rebalance
     * @param  _auctionSpeed                    Time, in seconds, where 1% of prices are explored during auction
     */
    constructor(
        ICore _coreInstance,
        IAllocationPricer _allocationPricerInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _allocationPrecision,
        uint256 _auctionTimeToPivot,
        uint256 _auctionSpeed
    )
        public
    {
        coreInstance = _coreInstance;
        allocationPricerInstance = _allocationPricerInstance;
        auctionLibraryInstance = _auctionLibraryInstance;
        baseAssetAllocation = _baseAssetAllocation;
        auctionTimeToPivot = _auctionTimeToPivot;
        auctionSpeed = _auctionSpeed;
        allocationPrecision = _allocationPrecision;
        initializerAddress = msg.sender;
    }

    /* ============ External ============ */

    /*
     * This function sets the Rebalancing Set Token address that the manager is associated with.
     * This function is only meant to be called once during initialization by the contract deployer.
     *
     * @param  _rebalancingSetTokenInstance       The address of the rebalancing Set token
     */
    function initialize(
        IRebalancingSetToken _rebalancingSetTokenInstance
    )
        external
    {
        // Check that the initializer address is calling function
        require(
            msg.sender == initializerAddress,
            "BaseTwoAssetStrategyManager.initialize: Only the contract deployer can initialize"
        );

        // Make sure the rebalancingSetToken is tracked by Core
        require(
            coreInstance.validSets(address(_rebalancingSetTokenInstance)),
            "BaseTwoAssetStrategyManager.initialize: Invalid or disabled RebalancingSetToken address"
        );

        rebalancingSetTokenInstance = _rebalancingSetTokenInstance;
        // Set initializer address to 0 so that no one can update RebalancingSetTokenInstance state
        initializerAddress = address(0);
    }

     /*
     * When allowed on RebalancingSetToken, anyone can call for a new rebalance proposal. Assuming the criteria
     * have been met, determine parameters for the rebalance
     */
    function propose()
        external
    {
        // Check that enough time has passed for the proposal and RebalancingSetToken is in Default state
        FlexibleTimingManagerLibrary.validateManagerPropose(rebalancingSetTokenInstance);
        
        // Get new baseAsset allocation amount
        uint256 newBaseAssetAllocation = calculateBaseAssetAllocation();

        // Check that new baseAsset allocation amount is different from current allocation amount
        require(
            newBaseAssetAllocation != baseAssetAllocation,
            "BaseTwoAssetStrategyManager.propose: No change in allocation detected."
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
            allocationPrecision,
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

     /*
     * Function returning whether the ideal base asset allocation is different from the current
     * base asset allocation.
     */
    function isReadyToRebalance()
        external
        view
        returns (bool)
    {
        return calculateBaseAssetAllocation() != baseAssetAllocation;        
    }    

    /* ============ Internal ============ */

     /*
     * Unimplemented in this base contract but is used to translate price triggers outputs (boolean)
     * into an ideal base asset allocation.
     */
    function calculateBaseAssetAllocation()
        public
        view
        returns (uint256);
}