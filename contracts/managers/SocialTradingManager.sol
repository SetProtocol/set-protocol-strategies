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
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { ILiquidator } from "set-protocol-contracts/contracts/core/interfaces/ILiquidator.sol";
import { IRebalancingSetTokenV2 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV2.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { RebalancingLibrary } from "set-protocol-contracts/contracts/core/lib/RebalancingLibrary.sol";
import { WhiteList } from "set-protocol-contracts/contracts/lib/WhiteList.sol";

import { ISocialAllocator } from "./allocators/ISocialAllocator.sol";
import { SocialTradingLibrary } from "./lib/SocialTradingLibrary.sol";


/**
 * @title SocialTradingManager
 * @author Set Protocol
 *
 * Singleton manager contract through which all social trading sets are managed. Traders can choose a percentage
 * between 0 and 100 for each rebalance. The trading pair used for each trading pool is defined by the allocator
 * passed in on pool creation. Only compatible with RebalancingSetTokenV2 constracts. All permissioned functions
 * on the RebalancingSetTokenV2 must be called through the administrative functions exposed on this contract.
 *
 * CHANGELOG: As of version 1.1.31 the REBALANCING_SET_NATURAL_UNIT has been changed from 1e6 to 1e8.
 */
contract SocialTradingManager is
    WhiteList
{
    using SafeMath for uint256;

    /* ============ Events ============ */

    event TradingPoolCreated(
        address indexed trader,
        ISocialAllocator indexed allocator,
        address indexed tradingPool,
        uint256 startingAllocation
    );

    event AllocationUpdate(
        address indexed tradingPool,
        uint256 oldAllocation,
        uint256 newAllocation
    );

    event NewTrader(
        address indexed tradingPool,
        address indexed oldTrader,
        address indexed newTrader
    );

    /* ============ Modifier ============ */

    modifier onlyTrader(IRebalancingSetTokenV2 _tradingPool) {
        require(
            msg.sender == trader(_tradingPool),
            "Sender must be trader"
        );
        _;
    }

    /* ============ Constants ============ */

    uint256 public constant REBALANCING_SET_NATURAL_UNIT = 1e8;
    uint public constant ONE_PERCENT = 1e16;
    uint256 constant public MAXIMUM_ALLOCATION = 1e18;

    /* ============ State Variables ============ */

    ICore public core;
    address public factory;
    mapping(address => SocialTradingLibrary.PoolInfo) public pools;

    uint256 public maxEntryFee;
    uint256 public feeUpdateTimelock;

    /*
     * SocialTradingManager constructor.
     *
     * @param  _core                            The address of the Core contract
     * @param  _factory                         Factory to use for RebalancingSetToken creation
     * @param  _whiteListedAllocators           List of allocator addresses to WhiteList
     * @param  _maxEntryFee                     Max entry fee when updating fees in a scaled decimal value
     *                                          (e.g. 1% = 1e16, 1bp = 1e14)
     * @param  _feeUpdateTimelock               Amount of time trader must wait between starting fee update
     *                                          and finalizing fee update
     */
    constructor(
        ICore _core,
        address _factory,
        address[] memory _whiteListedAllocators,
        uint256 _maxEntryFee,
        uint256 _feeUpdateTimelock
    )
        public
        WhiteList(_whiteListedAllocators)
    {
        core = _core;
        factory = _factory;

        maxEntryFee = _maxEntryFee;
        feeUpdateTimelock = _feeUpdateTimelock;
    }

    /* ============ External ============ */

    /*
     * Create a trading pool. Create or select new collateral and create RebalancingSetToken contract to
     * administer pool. Save relevant data to pool's entry in pools state variable under the Rebalancing
     * Set Token address.
     *
     * @param _tradingPairAllocator             The address of the allocator the trader wishes to use
     * @param _startingBaseAssetAllocation      Starting base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     * @param _startingUSDValue                 Starting value of one share of the trading pool to 18 decimals of precision
     * @param _name                             The name of the new RebalancingSetTokenV2
     * @param _symbol                           The symbol of the new RebalancingSetTokenV2
     * @param _rebalancingSetCallData           Byte string containing additional call parameters to pass to factory
     */
    function createTradingPool(
        ISocialAllocator _tradingPairAllocator,
        uint256 _startingBaseAssetAllocation,
        uint256 _startingUSDValue,
        bytes32 _name,
        bytes32 _symbol,
        bytes calldata _rebalancingSetCallData
    )
        external
    {
        // Validate relevant params
        validateCreateTradingPool(_tradingPairAllocator, _startingBaseAssetAllocation, _rebalancingSetCallData);

        // Get collateral Set
        ISetToken collateralSet = _tradingPairAllocator.determineNewAllocation(
            _startingBaseAssetAllocation
        );

        uint256[] memory unitShares = new uint256[](1);

        // Value collateral
        uint256 collateralValue = _tradingPairAllocator.calculateCollateralSetValue(
            collateralSet
        );

        // unitShares is equal to _startingUSDValue divided by colalteral Value
        unitShares[0] = _startingUSDValue.mul(REBALANCING_SET_NATURAL_UNIT).div(collateralValue);

        address[] memory components = new address[](1);
        components[0] = address(collateralSet);

        // Create tradingPool
        address tradingPool = core.createSet(
            factory,
            components,
            unitShares,
            REBALANCING_SET_NATURAL_UNIT,
            _name,
            _symbol,
            _rebalancingSetCallData
        );

        pools[tradingPool].trader = msg.sender;
        pools[tradingPool].allocator = _tradingPairAllocator;
        pools[tradingPool].currentAllocation = _startingBaseAssetAllocation;
        pools[tradingPool].feeUpdateTimestamp = 0;

        emit TradingPoolCreated(
            msg.sender,
            _tradingPairAllocator,
            tradingPool,
            _startingBaseAssetAllocation
        );
    }

    /*
     * Update trading pool allocation. Issue new collateral Set and initiate rebalance on RebalancingSetTokenV2.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newAllocation      New base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     * @param _liquidatorData     Extra parameters passed to the liquidator
     */
    function updateAllocation(
        IRebalancingSetTokenV2 _tradingPool,
        uint256 _newAllocation,
        bytes calldata _liquidatorData
    )
        external
        onlyTrader(_tradingPool)
    {
        // Validate updateAllocation params
        validateAllocationUpdate(_tradingPool, _newAllocation);

        // Create nextSet collateral
        ISetToken nextSet = allocator(_tradingPool).determineNewAllocation(
            _newAllocation
        );

        // Trigger start rebalance on RebalancingSetTokenV2
        _tradingPool.startRebalance(address(nextSet), _liquidatorData);

        emit AllocationUpdate(
            address(_tradingPool),
            currentAllocation(_tradingPool),
            _newAllocation
        );

        // Save new allocation
        pools[address(_tradingPool)].currentAllocation = _newAllocation;
    }

    /*
     * Start fee update process, set fee update timestamp and commit to new fee.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newEntryFee        New entry fee in a scaled decimal value
     *                              (e.g. 100% = 1e18, 1% = 1e16)
     */
    function initiateEntryFeeChange(
        IRebalancingSetTokenV2 _tradingPool,
        uint256 _newEntryFee
    )
        external
        onlyTrader(_tradingPool)
    {
        // Validate new entry fee doesn't exceed max
        validateNewEntryFee(_newEntryFee);

        // Log new entryFee and timestamp to start timelock from
        pools[address(_tradingPool)].feeUpdateTimestamp = block.timestamp.add(feeUpdateTimelock);
        pools[address(_tradingPool)].newEntryFee = _newEntryFee;
    }

    /*
     * Finalize fee update, change fee on RebalancingSetTokenV2 if time lock period has elapsed.
     *
     * @param _tradingPool        The address of the trading pool being updated
     */
    function finalizeEntryFeeChange(
        IRebalancingSetTokenV2 _tradingPool
    )
        external
        onlyTrader(_tradingPool)
    {
        // If feeUpdateTimestamp is equal to 0 indicates initiate wasn't called
        require(
            feeUpdateTimestamp(_tradingPool) != 0,
            "SocialTradingManager.finalizeSetFeeRecipient: Must initiate fee change first."
        );

        // Current block timestamp must exceed feeUpdateTimestamp
        require(
            block.timestamp >= feeUpdateTimestamp(_tradingPool),
            "SocialTradingManager.finalizeSetFeeRecipient: Time lock period must elapse to update fees."
        );

        // Reset timestamp to avoid reentrancy
        pools[address(_tradingPool)].feeUpdateTimestamp = 0;

        // Update fee on RebalancingSetTokenV2
        _tradingPool.setEntryFee(newEntryFee(_tradingPool));

        // Reset newEntryFee
        pools[address(_tradingPool)].newEntryFee = 0;
    }

    /*
     * Update trader allowed to manage trading pool.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newTrader          Address of new traders
     */
    function setTrader(
        IRebalancingSetTokenV2 _tradingPool,
        address _newTrader
    )
        external
        onlyTrader(_tradingPool)
    {
        emit NewTrader(
            address(_tradingPool),
            trader(_tradingPool),
            _newTrader
        );

        pools[address(_tradingPool)].trader = _newTrader;
    }

    /*
     * Update liquidator used by tradingPool.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newLiquidator      Address of new Liquidator
     */
    function setLiquidator(
        IRebalancingSetTokenV2 _tradingPool,
        ILiquidator _newLiquidator
    )
        external
        onlyTrader(_tradingPool)
    {
        _tradingPool.setLiquidator(_newLiquidator);
    }

    /*
     * Update fee recipient of tradingPool.
     *
     * @param _tradingPool          The address of the trading pool being updated
     * @param _newFeeRecipient      Address of new fee recipient
     */
    function setFeeRecipient(
        IRebalancingSetTokenV2 _tradingPool,
        address _newFeeRecipient
    )
        external
        onlyTrader(_tradingPool)
    {
        _tradingPool.setFeeRecipient(_newFeeRecipient);
    }

    /* ============ Internal ============ */

    /*
     * Validate trading pool creation. Make sure allocation is valid, allocator is white listed and
     * manager passed in rebalancingSetCallData is this address.
     *
     * @param _tradingPairAllocator             The address of allocator being used in trading pool
     * @param _startingBaseAssetAllocation      New base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     * @param _rebalancingSetCallData           Byte string containing RebalancingSetTokenV2 call parameters
     */
    function validateCreateTradingPool(
        ISocialAllocator _tradingPairAllocator,
        uint256 _startingBaseAssetAllocation,
        bytes memory _rebalancingSetCallData
    )
        internal
        view
    {
        validateAllocationAmount(_startingBaseAssetAllocation);

        validateManagerAddress(_rebalancingSetCallData);

        require(
            whiteList[address(_tradingPairAllocator)],
            "SocialTradingManager.validateCreateTradingPool: Passed allocator is not valid."
        );
    }

    /*
     * Validate trading pool allocation update. Make sure allocation is valid,
     * and RebalancingSet is in valid state.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newAllocation      New base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     */
    function validateAllocationUpdate(
        IRebalancingSetTokenV2 _tradingPool,
        uint256 _newAllocation
    )
        internal
        view
    {
        validateAllocationAmount(_newAllocation);

        // If current allocation is 0/100%, cannot be the same allocation
        uint256 currentAllocationValue = currentAllocation(_tradingPool);
        require(
            !(currentAllocationValue == MAXIMUM_ALLOCATION && _newAllocation == MAXIMUM_ALLOCATION) &&
            !(currentAllocationValue == 0 && _newAllocation == 0),
            "SocialTradingManager.validateAllocationUpdate: Invalid allocation"
        );

        // Require that enough time has passed from last rebalance
        uint256 lastRebalanceTimestamp = _tradingPool.lastRebalanceTimestamp();
        uint256 rebalanceInterval = _tradingPool.rebalanceInterval();
        require(
            block.timestamp >= lastRebalanceTimestamp.add(rebalanceInterval),
            "SocialTradingManager.validateAllocationUpdate: Rebalance interval not elapsed"
        );

        // Require that Rebalancing Set Token is in Default state, won't allow for re-proposals
        // because malicious actor could prevent token from ever rebalancing
        require(
            _tradingPool.rebalanceState() == RebalancingLibrary.State.Default,
            "SocialTradingManager.validateAllocationUpdate: State must be in Default"
        );
    }

    /*
     * Validate passed allocation amount.
     *
     * @param _allocation      New base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     */
    function validateAllocationAmount(
        uint256 _allocation
    )
        internal
        view
    {
        require(
            _allocation <= MAXIMUM_ALLOCATION,
            "Passed allocation must not exceed 100%."
        );

        require(
            _allocation.mod(ONE_PERCENT) == 0,
            "Passed allocation must be multiple of 1%."
        );
    }

    /*
     * Validate new entry fee.
     *
     * @param _entryFee      New entry fee in a scaled decimal value
     *                          (e.g. 100% = 1e18, 1% = 1e16)
     */
    function validateNewEntryFee(
        uint256 _entryFee
    )
        internal
        view
    {
        require(
            _entryFee <= maxEntryFee,
            "SocialTradingManager.validateNewEntryFee: Passed entry fee must not exceed maxEntryFee."
        );
    }

    /*
     * Validate passed manager in RebalancingSetToken bytes arg matches this address.
     *
     * @param _rebalancingSetCallData       Byte string containing RebalancingSetTokenV2 call parameters
     */
    function validateManagerAddress(
        bytes memory _rebalancingSetCallData
    )
        internal
        view
    {
        address manager;

        assembly {
            manager := mload(add(_rebalancingSetCallData, 32))   // manager slot
        }

        require(
            manager == address(this),
            "SocialTradingManager.validateCallDataArgs: Passed manager address is not this address."
        );
    }

    function allocator(IRebalancingSetTokenV2 _tradingPool) internal view returns (ISocialAllocator) {
        return pools[address(_tradingPool)].allocator;
    }

    function trader(IRebalancingSetTokenV2 _tradingPool) internal view returns (address) {
        return pools[address(_tradingPool)].trader;
    }

    function currentAllocation(IRebalancingSetTokenV2 _tradingPool) internal view returns (uint256) {
        return pools[address(_tradingPool)].currentAllocation;
    }

    function feeUpdateTimestamp(IRebalancingSetTokenV2 _tradingPool) internal view returns (uint256) {
        return pools[address(_tradingPool)].feeUpdateTimestamp;
    }

    function newEntryFee(IRebalancingSetTokenV2 _tradingPool) internal view returns (uint256) {
        return pools[address(_tradingPool)].newEntryFee;
    }
}