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
import { RebalancingLibrary } from "set-protocol-contracts/contracts/core/lib/RebalancingLibrary.sol";

import { FlexibleTimingManagerLibrary } from "./lib/FlexibleTimingManagerLibrary.sol";
import { IAllocator } from "./allocators/IAllocator.sol";


/**
 * @title TwoAssetStrategyManager
 * @author Set Protocol
 *
 * Base Rebalancing Manager contract for implementing any trading pair strategy. Allocation determinations
 * are implemented in a contract that inherits the functionality of this contract. Additionally, all allocations are
 * priced using the base contracts's Allocator contract.
 */
contract TwoAssetStrategyManager {
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    ICore public coreInstance;
    IAuctionPriceCurve public auctionLibraryInstance;
    IAllocator public allocatorInstance;
    IRebalancingSetToken public rebalancingSetTokenInstance;
    uint256 public baseAssetAllocation;  // Percent of base asset currently allocated in strategy
    uint256 public allocationPrecision;
    uint256 public auctionStartPercentage;
    uint256 public auctionEndPercentage;
    uint256 public auctionTimeToPivot;
    address public initializerAddress;

    /*
     * TwoAssetStrategyManager constructor.
     *
     * @param  _coreInstance                    The address of the Core contract       
     * @param  _allocatorInstance               The address of the Allocator to be used in the strategy        
     * @param  _auctionLibraryInstance          The address of auction price curve to use in rebalance
     * @param  _baseAssetAllocation             Starting allocation of the Rebalancing Set in baseAsset amount
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _auctionStartPercentage          The amount below fair value, in percent, to start auction
     * @param  _auctionEndPercentage            The amount above fair value, in percent, to end auction
     * @param  _auctionTimeToPivot              Time, in seconds, spent between start and pivot price
     */
    constructor(
        ICore _coreInstance,
        IAllocator _allocatorInstance,
        IAuctionPriceCurve _auctionLibraryInstance,
        uint256 _baseAssetAllocation,
        uint256 _allocationPrecision,
        uint256 _auctionStartPercentage,
        uint256 _auctionEndPercentage,
        uint256 _auctionTimeToPivot
    )
        public
    {
        coreInstance = _coreInstance;
        allocatorInstance = _allocatorInstance;
        auctionLibraryInstance = _auctionLibraryInstance;
        baseAssetAllocation = _baseAssetAllocation;
        allocationPrecision = _allocationPrecision;
        auctionStartPercentage = _auctionStartPercentage;
        auctionEndPercentage = _auctionEndPercentage;
        auctionTimeToPivot = _auctionTimeToPivot;
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
            "TwoAssetStrategyManager.initialize: Only the contract deployer can initialize"
        );

        // Make sure the rebalancingSetToken is tracked by Core
        require(
            coreInstance.validSets(address(_rebalancingSetTokenInstance)),
            "TwoAssetStrategyManager.initialize: Invalid or disabled RebalancingSetToken address"
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
            "TwoAssetStrategyManager.propose: No change in allocation detected."
        );

        // Get current collateral Set
        address currentCollateralSetAddress = rebalancingSetTokenInstance.currentSet();        

        // If price trigger has been met, get next Set allocation. Create new set if price difference is too
        // great to run good auction. Return nextSet address.
        address nextSetAddress = allocatorInstance.determineNewAllocation(
            newBaseAssetAllocation,
            allocationPrecision,
            ISetToken(currentCollateralSetAddress)
        );

        // Get current and next Set dollar values
        uint256 currentSetDollarValue = allocatorInstance.calculateCollateralSetValue(
            ISetToken(currentCollateralSetAddress)
        );

        uint256 nextSetDollarValue = allocatorInstance.calculateCollateralSetValue(
            ISetToken(nextSetAddress)
        );

        // Get auction price divisor
        uint256 auctionPriceDivisor = auctionLibraryInstance.priceDivisor();

        // Calculate the price parameters for auction
        (
            uint256 auctionStartPrice,
            uint256 auctionPivotPrice
        ) = calculateAuctionPriceParameters(
            currentSetDollarValue,
            nextSetDollarValue,
            auctionPriceDivisor
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
     * Function returning whether rebalance is ready to go ahead
     *
     * @return       Whether rebalance is ready to go be proposed
     */
    function isReadyToRebalance()
        external
        view
        returns (bool)
    {
        // If RebalancingSetToken in valid state and new allocation different from last known allocation
        // then return true, else false
        return rebalancingSetTokenInValidState() && calculateBaseAssetAllocation() != baseAssetAllocation;        
    } 

     /*
     * Unimplemented in this base contract but is used to translate price triggers outputs (boolean)
     * into an ideal base asset allocation.
     */
    function calculateBaseAssetAllocation()
        public
        view
        returns (uint256);   

    /* ============ Internal ============ */

    /*
     * Calculates the auction price parameters, targetting 1% slippage every 10 minutes. Range is
     * defined by subtracting auctionStartPercentage * onePercentSlippage from fairValue and adding
     * auctionEndPercentage * onePercentSlippage to fairValue
     *
     * @param  _currentSetDollarAmount      The 18 decimal value of one currenSet
     * @param  _nextSetDollarAmount         The 18 decimal value of one nextSet
     * @param  _auctionLibraryPriceDivisor  The auction library price divisor
     * @return uint256                      The auctionStartPrice for rebalance auction
     * @return uint256                      The auctionPivotPrice for rebalance auction
     */
    function calculateAuctionPriceParameters(
        uint256 _currentSetDollarAmount,
        uint256 _nextSetDollarAmount,
        uint256 _auctionLibraryPriceDivisor
    )
        internal
        view
        returns (uint256, uint256)
    {
        // Determine fair value of nextSet/currentSet and put in terms of auction library price divisor
        uint256 fairValue = _nextSetDollarAmount.mul(_auctionLibraryPriceDivisor).div(_currentSetDollarAmount);
        // Calculate how much one percent slippage from fair value is
        uint256 onePercentSlippage = fairValue.div(100);

        // Auction start price is fair value minus half price range to center the auction at fair value
        uint256 auctionStartPrice = fairValue.sub(
            auctionStartPercentage.mul(onePercentSlippage)
        );
        // Auction pivot price is fair value plus half price range to center the auction at fair value
        uint256 auctionPivotPrice = fairValue.add(
            auctionEndPercentage.mul(onePercentSlippage)
        );

        return (auctionStartPrice, auctionPivotPrice);
    }

     /*
     * Function returning whether the rebalanceInterval has elapsed and then RebalancingSetToken is in 
     * Default state
     *
     * @return       Whether RebalancingSetToken is in valid state for rebalance
     */
    function rebalancingSetTokenInValidState()
        internal
        view
        returns (bool)
    {
        // Get RebalancingSetToken timing info
        uint256 lastRebalanceTimestamp = rebalancingSetTokenInstance.lastRebalanceTimestamp();
        uint256 rebalanceInterval = rebalancingSetTokenInstance.rebalanceInterval();

        // Require that Rebalancing Set Token is in Default state and rebalanceInterval elapsed
        return block.timestamp >= lastRebalanceTimestamp.add(rebalanceInterval) &&
            rebalancingSetTokenInstance.rebalanceState() == RebalancingLibrary.State.Default;        
    }
}