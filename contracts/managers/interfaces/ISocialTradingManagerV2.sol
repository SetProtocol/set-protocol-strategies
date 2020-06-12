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

import { ILiquidator } from "set-protocol-contracts/contracts/core/interfaces/ILiquidator.sol";
import { IRebalancingSetTokenV2 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV2.sol";

import { ISocialAllocator } from "../allocators/ISocialAllocator.sol";
import { SocialTradingLibrary } from "../lib/SocialTradingLibrary.sol";

/**
 * @title ISocialTradingManagerV2
 * @author Set Protocol
 *
 * Interface for interacting with SocialTradingManager contracts
 */
interface ISocialTradingManagerV2 {

    /*
     * Get trading pool info.
     *
     * @param _tradingPool        The address of the trading pool being queried
     *
     * @return                    PoolInfo struct of trading pool
     */
    function pools(address _tradingPool) external view returns (SocialTradingLibrary.PoolInfo memory);

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
        external;

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
        external;

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
        external;

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
        external;

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
        external;


    /**
     * Allows traders to update fees on their Set. Only one fee update allowed at a time and timelocked.
     *
     * @param _tradingPool       The address of the trading pool being updated
     * @param _newFeeCallData    Bytestring representing feeData to pass to fee calculator
     */
    function adjustFee(
        address _tradingPool,
        bytes calldata _newFeeCallData
    )
        external;

    /**
     * External function to remove upgrade. Modifiers should be added to restrict usage.
     *
     * @param _tradingPool      The address of the trading pool being updated
     * @param _upgradeHash      Keccack256 hash that uniquely identifies function called and arguments
     */
    function removeRegisteredUpgrade(
        address _tradingPool,
        bytes32 _upgradeHash
    )
        external;

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
        external;

    /*
     * Finalize fee update, change fee on RebalancingSetTokenV2 if time lock period has elapsed.
     *
     * @param _tradingPool        The address of the trading pool being updated
     */
    function finalizeEntryFeeChange(
        IRebalancingSetTokenV2 _tradingPool
    )
        external;
}