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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { ILiquidator } from "set-protocol-contracts/contracts/core/interfaces/ILiquidator.sol";
import { IRebalancingSetTokenV3 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV3.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { RebalancingLibrary } from "set-protocol-contracts/contracts/core/lib/RebalancingLibrary.sol";
import { TimeLockUpgradeV2 } from "set-protocol-contract-utils/contracts/lib/TimeLockUpgradeV2.sol";

import { IAllocator } from "./allocators/IAllocator.sol";
import { ITrigger } from "./triggers/ITrigger.sol";


/**
 * @title AssetPairManagerV2
 * @author Set Protocol
 *
 * Manager contract for implementing any trading pair and strategy for RebalancingSetTokenV3. Allocation
 * determinations are made based on output of Trigger contract. bullishBaseAssetAllocation amount is
 * passed in and used when bullish, allocationDenominator - bullishBaseAssetAllocation used when bearish.
 *
 * CHANGELOG:
 * - Support RebalancingSetTokenV3
 * - Remove logic associated with pricing auctions, which has been moved to liquidator contracts
 * - Add abilities to switch liquidator, liquidatorData, fee recipient, and adjust performance fees which is timelocked
 */
contract AssetPairManagerV2 is
    TimeLockUpgradeV2
{
    using SafeMath for uint256;

    /* ============ Events ============ */

    event InitialProposeCalled(
        address indexed rebalancingSetToken
    );

    event NewLiquidatorDataAdded(
        bytes newLiquidatorData,
        bytes oldLiquidatorData
    );

    /* ============ State Variables ============ */
    ICore public core;
    IAllocator public allocator;
    ITrigger public trigger;
    IRebalancingSetTokenV3 public rebalancingSetToken;
    uint256 public baseAssetAllocation;  // Proportion of base asset currently allocated in strategy
    uint256 public allocationDenominator;    
    uint256 public bullishBaseAssetAllocation;
    uint256 public bearishBaseAssetAllocation;

    // Time until start of confirmation period after initialPropose called, in seconds
    uint256 public signalConfirmationMinTime;
    // Time until end of confirmation period after initialPropose called, in seconds
    uint256 public signalConfirmationMaxTime;
    // Timestamp of last successful initialPropose call
    uint256 public recentInitialProposeTimestamp;
    // Bytes data to pass into liquidator
    bytes public liquidatorData;

    /*
     * AssetPairManagerV2 constructor.
     *
     * @param  _core                            The address of the Core contract
     * @param  _allocator                       The address of the Allocator to be used in the strategy
     * @param  _trigger                         The address of the PriceTrigger to be used in the strategy
     * @param  _useBullishAllocation            Bool indicating whether to start in bullish or bearish base asset allocation
     * @param  _allocationDenominator           Precision of allocation (i.e. 100 = percent, 10000 = basis point)
     * @param  _bullishBaseAssetAllocation      Base asset allocation when trigger is bullish
     * @param  _signalConfirmationBounds        The lower and upper bounds of time, in seconds, from initialTrigger to confirm signal
     * @param  _liquidatorData                  Extra parameters passed to the liquidator
     */
    constructor(
        ICore _core,
        IAllocator _allocator,
        ITrigger _trigger,
        bool _useBullishAllocation,
        uint256 _allocationDenominator,
        uint256 _bullishBaseAssetAllocation,
        uint256[2] memory _signalConfirmationBounds,
        bytes memory _liquidatorData
    )
        public
    {
        // Make sure allocation denominator is > 0
        require(
            _allocationDenominator > 0,
            "AssetPairManagerV2.constructor: Allocation denonimator must be nonzero."
        );


        // Make sure confirmation max time is greater than confirmation min time
        require(
            _signalConfirmationBounds[1] >= _signalConfirmationBounds[0],
            "AssetPairManagerV2.constructor: Confirmation max time must be greater than min time."
        );

        // Passed bullish allocation must be less than or equal to allocationDenominator
        require(
            _bullishBaseAssetAllocation <= _allocationDenominator,
            "AssetPairManagerV2.constructor: Passed bullishBaseAssetAllocation must be less than allocationDenominator."
        );

        bullishBaseAssetAllocation = _bullishBaseAssetAllocation;
        bearishBaseAssetAllocation = _allocationDenominator.sub(_bullishBaseAssetAllocation);
        // If bullish flag is true, use bullishBaseAssetAllocation else use bearishBaseAssetAllocation
        baseAssetAllocation = _useBullishAllocation ? _bullishBaseAssetAllocation : bearishBaseAssetAllocation;

        core = _core;
        allocator = _allocator;
        trigger = _trigger;
        allocationDenominator = _allocationDenominator;
        signalConfirmationMinTime = _signalConfirmationBounds[0];
        signalConfirmationMaxTime = _signalConfirmationBounds[1];
        liquidatorData = _liquidatorData;
    }

    /* ============ External ============ */

    /*
     * This function sets the Rebalancing Set Token address that the manager is associated with.
     * This function is only meant to be called once during initialization by the owner
     *
     * @param  _rebalancingSetToken       The address of the rebalancing Set token
     */
    function initialize(
        IRebalancingSetTokenV3 _rebalancingSetToken
    )
        external
        onlyOwner
    {
        // Make sure the rebalancingSetToken is tracked by Core
        require(  // coverage-disable-line
            core.validSets(address(_rebalancingSetToken)),
            "AssetPairManagerV2.initialize: Invalid or disabled RebalancingSetToken address"
        );

        // Make sure rebalancingSetToken is not initialized
        require(
            address(rebalancingSetToken) == address(0),
            "AssetPairManagerV2.initialize: RebalancingSetToken can only be initialized once"
        );

        rebalancingSetToken = _rebalancingSetToken;
    }

    /*
     * When allowed on RebalancingSetToken, anyone can call for a new rebalance proposal. Assuming the criteria
     * have been met, this begins a waiting period before the confirmation window starts where the signal can be
     * confirmed.
     */
    function initialPropose()
        external
    {
        // Make sure Manager has been initialized with RebalancingSetToken
        require(
            address(rebalancingSetToken) != address(0),
            "AssetPairManagerV2.initialPropose: Manager must be initialized with RebalancingSetToken."
        );

        // Check enough time has passed for proposal and RebalancingSetToken in Default state
        require(
            rebalancingSetReady(),
            "AssetPairManagerV2.initialPropose: RebalancingSetToken must be in valid state"
        );

        // Make sure there is not an existing initial proposal underway
        require(
            hasConfirmationWindowElapsed(),
            "AssetPairManagerV2.initialPropose: Not enough time passed from last proposal."
        );

        // Get new baseAsset allocation amount
        uint256 newBaseAssetAllocation = calculateBaseAssetAllocation();

        // Check that new baseAsset allocation amount is different from current allocation amount
        require(
            newBaseAssetAllocation != baseAssetAllocation,
            "AssetPairManagerV2.initialPropose: No change in allocation detected."
        );

        // Set initial trigger timestamp
        recentInitialProposeTimestamp = block.timestamp;

        emit InitialProposeCalled(address(rebalancingSetToken));
    }

    /*
     * When allowed on RebalancingSetToken, anyone can call to start a new rebalance. Assuming the criteria
     * have been met, transition state to rebalance
     */
    function confirmPropose()
        external
    {
        // Make sure Manager has been initialized with RebalancingSetToken
        require(
            address(rebalancingSetToken) != address(0),
            "AssetPairManagerV2.confirmPropose: Manager must be initialized with RebalancingSetToken."
        );

        // Check that enough time has passed for the proposal and RebalancingSetToken is in Default state
        require(
            rebalancingSetReady(),
            "AssetPairManagerV2.confirmPropose: RebalancingSetToken must be in valid state"
        );

        // Make sure in confirmation window
        require(
            inConfirmationWindow(),
            "AssetPairManagerV2.confirmPropose: Confirming signal must be within confirmation window."
        );

        // Get new baseAsset allocation amount
        uint256 newBaseAssetAllocation = calculateBaseAssetAllocation();

        // Check that new baseAsset allocation amount is different from current allocation amount
        require(
            newBaseAssetAllocation != baseAssetAllocation,
            "AssetPairManagerV2.confirmPropose: No change in allocation detected."
        );

        // Get current collateral Set
        ISetToken currentCollateralSet = ISetToken(rebalancingSetToken.currentSet());

        // If price trigger has been met, get next Set allocation. Create new set if price difference is too
        // great to run good auction. Return nextSet address.
        ISetToken nextSet = allocator.determineNewAllocation(
            newBaseAssetAllocation,
            allocationDenominator,
            currentCollateralSet
        );

        // Start rebalance with new allocation on Rebalancing Set Token V3
        rebalancingSetToken.startRebalance(
            address(nextSet),
            liquidatorData
        );

        // Set baseAssetAllocation to new allocation amount
        baseAssetAllocation = newBaseAssetAllocation;
    }

    /*
     * Update liquidator used by Rebalancing Set.
     *
     * @param _newLiquidator      Address of new Liquidator
     */
    function setLiquidator(
        ILiquidator _newLiquidator
    )
        external
        onlyOwner
    {
        rebalancingSetToken.setLiquidator(_newLiquidator);
    }

    /*
     * Update liquidatorData used by Rebalancing Set.
     *
     * @param _newLiquidatorData      New Liquidator data
     */
    function setLiquidatorData(
        bytes calldata _newLiquidatorData
    )
        external
        onlyOwner
    {
        bytes memory oldLiquidatorData = liquidatorData;
        liquidatorData = _newLiquidatorData;
        
        emit NewLiquidatorDataAdded(_newLiquidatorData, oldLiquidatorData);
    }

    /**
     * Allows the owner to update fees on the Set. Fee updates are timelocked.
     *
     * @param _newFeeCallData    Bytestring representing feeData to pass to fee calculator
     */
    function adjustFee(
        bytes calldata _newFeeCallData
    )
        external
        onlyOwner
        timeLockUpgrade
    {
        rebalancingSetToken.adjustFee(_newFeeCallData);
    }

    /*
     * Update fee recipient on the Set.
     *
     * @param _newFeeRecipient      Address of new fee recipient
     */
    function setFeeRecipient(
        address _newFeeRecipient
    )
        external
        onlyOwner
    {
        rebalancingSetToken.setFeeRecipient(_newFeeRecipient);
    }

    /*
     * Function returning whether initialPropose can be called without revert
     *
     * @return       Whether initialPropose can be called without revert
     */
    function canInitialPropose()
        external
        view
        returns (bool)
    {
        // If RebalancingSetToken in valid state and new allocation different from last known allocation
        // then return true, else false
        return rebalancingSetReady()
            && calculateBaseAssetAllocation() != baseAssetAllocation
            && hasConfirmationWindowElapsed();
    }

    /*
     * Function returning whether confirmPropose can be called without revert
     *
     * @return       Whether confirmPropose can be called without revert
     */
    function canConfirmPropose()
        external
        view
        returns (bool)
    {
        // If RebalancingSetToken in valid state and new allocation different from last known allocation
        // then return true, else false
        return rebalancingSetReady()
            && calculateBaseAssetAllocation() != baseAssetAllocation
            && inConfirmationWindow();
    }

    /* ============ Internal ============ */

    /*
     * Calculate base asset allocation given market conditions
     *
     * @return       New base asset allocation
     */
    function calculateBaseAssetAllocation()
        internal
        view
        returns (uint256)
    {
        return trigger.isBullish() ? bullishBaseAssetAllocation : bearishBaseAssetAllocation;
    }

     /*
     * Function returning whether the rebalanceInterval has elapsed and then RebalancingSetToken is in
     * Default state
     *
     * @return       Whether a RebalancingSetToken rebalance is allowed
     */
    function rebalancingSetReady()
        internal
        view
        returns (bool)
    {
        // Get RebalancingSetToken timing info
        uint256 lastRebalanceTimestamp = rebalancingSetToken.lastRebalanceTimestamp();
        uint256 rebalanceInterval = rebalancingSetToken.rebalanceInterval();

        // Require that Rebalancing Set Token is in Default state and rebalanceInterval elapsed
        return rebalancingSetToken.rebalanceState() == RebalancingLibrary.State.Default &&
            block.timestamp.sub(lastRebalanceTimestamp) >= rebalanceInterval;        
    }

    /*
     * Return if enough time passed since last initialTrigger
     *
     * @return       Whether enough time has passed since last initialTrigger
     */
    function hasConfirmationWindowElapsed()
        internal
        view
        returns (bool)
    {
        return block.timestamp.sub(recentInitialProposeTimestamp) > signalConfirmationMaxTime;
    }

    /*
     * Return if currently in confirmation window.
     *
     * @return       Whether in confirmation window
     */
    function inConfirmationWindow()
        internal
        view
        returns (bool)
    {
        uint256 timeSinceInitialPropose = block.timestamp.sub(recentInitialProposeTimestamp);
        return timeSinceInitialPropose >= signalConfirmationMinTime && timeSinceInitialPropose <= signalConfirmationMaxTime;
    }
}
