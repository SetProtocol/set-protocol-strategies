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

import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { IRebalancingSetTokenV2 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV2.sol";
import { IRebalancingSetTokenV3 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV3.sol";
import { LimitOneUpgrade } from "set-protocol-contracts/contracts/lib/LimitOneUpgrade.sol";

import { SocialTradingManager } from "./SocialTradingManager.sol";


/**
 * @title SocialTradingManagerV2
 * @author Set Protocol
 *
 * Singleton manager contract through which all social trading v2 sets are managed. Inherits from SocialTradingManager
 * and adds functionality to adjust performance based fees.
 */
contract SocialTradingManagerV2 is
    SocialTradingManager,
    LimitOneUpgrade
{
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
        SocialTradingManager(
            _core,
            _factory,
            _whiteListedAllocators,
            _maxEntryFee,
            _feeUpdateTimelock
        )
    {}

    /* ============ External ============ */

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
        external
        onlyTrader(IRebalancingSetTokenV2(_tradingPool))
        limitOneUpgrade(_tradingPool)
        timeLockUpgrade
    {
        IRebalancingSetTokenV3(_tradingPool).adjustFee(_newFeeCallData);
    }

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
        external
        onlyTrader(IRebalancingSetTokenV2(_tradingPool))
    {
        removeRegisteredUpgradeInternal(_upgradeHash);

        upgradeInProgress[_tradingPool] = false;
    }
}