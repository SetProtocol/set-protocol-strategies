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

import { IRebalancingSetTokenV2 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV2.sol";
import { IRebalancingSetTokenV3 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV3.sol";
import { UnrestrictedTimeLockUpgrade } from "set-protocol-contracts/contracts/lib/UnrestrictedTimeLockUpgrade.sol";

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
    UnrestrictedTimeLockUpgrade
{

    function adjustFee(
        address _tradingPool,
        bytes calldata _newFeeCallData
    )
        external
        onlyTrader(IRebalancingSetTokenV2(_tradingPool))
        timeLockUpgrade
    {
        IRebalancingSetTokenV3(_tradingPool).adjustFee(_newFeeCallData);
    }

    // /**
    //  * External function to remove upgrade. Modifiers should be added to restrict usage.
    //  *
    //  * @param  _upgradeHash    Keccack256 hash that uniquely identifies function called and arguments
    //  */
    // function removeRegisteredUpgrade(
    //     address _tradingPool,
    //     bytes32 _upgradeHash
    // )
    //     external
    //     onlyTrader(IRebalancingSetTokenV2(_tradingPool))
    // {
    //     UnrestrictedTimeLockUpgrade.removeRegisteredUpgradeInternal(_upgradeHash);
    // }
}