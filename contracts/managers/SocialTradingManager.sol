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

import { ISocialAllocator } from "./allocators/ISocialAllocator.sol";


/**
 * @title SocialTradingManager
 * @author Set Protocol
 *
 * Singleton manager contract through which all social trading sets are managed. Traders can choose a percentage
 * between 0 and 100 for each rebalance. The trading pair used for each trading pool is defined by the allocator
 * passed in on pool creation. Only compatible with RebalancingSetTokenV2 constracts. All permissioned functions
 * on the RebalancingSetTokenV2 must be called through the administrative functions exposed on this contract.
 */
contract SocialTradingManager {
    using SafeMath for uint256;

    /* ============ Structs ============ */
    struct PoolInfo {
        address trader;
        ISocialAllocator allocator;
        uint256 currentAllocation;
    }

    /* ============ Events ============ */

    event TradingPoolCreated(
        address indexed _trader,
        ISocialAllocator indexed _allocator,
        address _tradingPool,
        uint256 _startingAllocation
    );

    event AllocationUpdate(
        address indexed _tradingPool,
        uint256 _oldAllocation,
        uint256 _newAllocation
    );

    event NewTrader(
        address indexed _tradingPool,
        address _oldTrader,
        address _newTrader
    );

    /* ============ Modifier ============ */

    modifier onlyTrader(IRebalancingSetTokenV2 _tradingPool) {
        require(
            msg.sender == pools[address(_tradingPool)].trader,
            "Sender must be trader"
        );
        _;
    }

    /* ============ Constants ============ */

    uint256 public constant REBALANCING_SET_NATURAL_UNIT = 10 ** 6;
    uint256 public constant SCALE_FACTOR = 10 ** 18;

    /* ============ State Variables ============ */

    ICore public core;
    mapping(address => PoolInfo) public pools;

    /*
     * SocialTradingManager constructor.
     *
     * @param  _core                            The address of the Core contract
     */
    constructor(
        ICore _core
    )
        public
    {
        core = _core;
    }

    /* ============ External ============ */

    /*
     * Create a trading pool. Create or select new collateral and create RebalancingSetToken contract to
     * administer pool. Save relevant data to pool's entry in pools state variable under the Rebalancing
     * Set Token address.
     *
     * @param _tradingPairAllocator             The address of the allocator the trader wishes to use
     * @param _factory                          Factory to use for RebalancingSetToken creation
     * @param _startingBaseAssetAllocation      Starting base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     * @param _startingValue                    Starting value of one share of the trading pool to 18 decimals of precision
     * @param _name                             The name of the new RebalancingSetTokenV2
     * @param _symbol                           The symbol of the new RebalancingSetTokenV2
     * @param _rebalancingSetCallData           Byte string containing additional call parameters to pass to factory
     */
    function createTradingPool(
        ISocialAllocator _tradingPairAllocator,
        address _factory,
        uint256 _startingBaseAssetAllocation,
        uint256 _startingValue,
        bytes32 _name,
        bytes32 _symbol,
        bytes calldata _rebalancingSetCallData
    )
        external
    {
        require(
            _startingBaseAssetAllocation <= SCALE_FACTOR,
            "SocialTradingManager.createTradingPool: Starting allocation is not valid."
        );

        ISetToken collateralSet = _tradingPairAllocator.determineNewAllocation(
            _startingBaseAssetAllocation,
            SCALE_FACTOR
        );
        
        uint256[] memory units = new uint256[](1);

        uint256 collateralValue = _tradingPairAllocator.calculateCollateralSetValue(
            collateralSet
        );

        units[0] = _startingValue.mul(REBALANCING_SET_NATURAL_UNIT).div(collateralValue);

        address[] memory components = new address[](1);
        components[0] = address(collateralSet);

        address tradingPool = core.createSet(
            _factory,
            components,
            units,
            REBALANCING_SET_NATURAL_UNIT,
            _name,
            _symbol,
            _rebalancingSetCallData
        );

        pools[tradingPool].trader = msg.sender;
        pools[tradingPool].allocator = _tradingPairAllocator;
        pools[tradingPool].currentAllocation = _startingBaseAssetAllocation;

        emit TradingPoolCreated(
            msg.sender,
            _tradingPairAllocator,
            tradingPool,
            _startingBaseAssetAllocation
        );
    }

    /*
     * Update trading pool allocation. Issue new collateral Set and pass on to RebalancingSetTokenV2.
     *
     * @param _tradingPool        The address of the trading pool being updated
     * @param _newAllocation      New base asset allocation in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     */
    function updateAllocation(
        IRebalancingSetTokenV2 _tradingPool,
        uint256 _newAllocation
    )
        external
        onlyTrader(_tradingPool)
    {
        validateAllocationUpdate(_tradingPool, _newAllocation);

        ISetToken nextSet = pools[address(_tradingPool)].allocator.determineNewAllocation(
            _newAllocation,
            SCALE_FACTOR
        );

        _tradingPool.startRebalance(address(nextSet));

        emit AllocationUpdate(
            address(_tradingPool),
            pools[address(_tradingPool)].currentAllocation,
            _newAllocation
        );

        pools[address(_tradingPool)].currentAllocation = _newAllocation;
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
            pools[address(_tradingPool)].trader,
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
     * Validate trading pool allocation update. Make sure trader is caller, allocation is valid,
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
        require(
            _newAllocation <= SCALE_FACTOR,
            "SocialTradingManager.validateAllocationUpdate: New allocation is not valid."
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
}