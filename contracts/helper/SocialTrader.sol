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

import { Ownable } from "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import { ILiquidator } from "set-protocol-contracts/contracts/core/interfaces/ILiquidator.sol";
import { IRebalancingSetTokenV2 } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetTokenV2.sol";

import { ISocialTradingManagerV2 } from "../managers/interfaces/ISocialTradingManagerV2.sol";
import { ISocialAllocator } from "../managers/allocators/ISocialAllocator.sol";


/**
 * @title SocialTrader
 * @author Set Protocol
 */
contract SocialTrader is Ownable {

    /* ============ State Variables ============ */
    ISocialTradingManagerV2 public manager;

    address public trader; // Account that can initiate allocation changes

    constructor(address _trader, ISocialTradingManagerV2 _manager) public {
        trader = _trader;
        manager = _manager;
    }

    /* ============ Trader Callable Functions ============ */

    function updateAllocation(
        IRebalancingSetTokenV2 _tradingPool,
        uint256 _newAllocation,
        bytes calldata _liquidatorData
    )
        external
    {
        require(msg.sender == trader, "Caller must be trader");

        manager.updateAllocation(_tradingPool, _newAllocation, _liquidatorData);
    }

    /* ============ Owner Callable Functions ============ */

    function setTrader(address _newTrader) public onlyOwner {
        trader = _newTrader;
    }

    function setTrader(IRebalancingSetTokenV2 _tradingPool, address _newTrader) external onlyOwner {
        manager.setTrader(_tradingPool, _newTrader);
    }

    function setLiquidator(IRebalancingSetTokenV2 _tradingPool, ILiquidator _newLiquidator) external onlyOwner {
        manager.setLiquidator(_tradingPool, _newLiquidator);
    }

    function setFeeRecipient(IRebalancingSetTokenV2 _tradingPool, address _newFeeRecipient) external onlyOwner {
        manager.setFeeRecipient(_tradingPool, _newFeeRecipient);
    }

    function initiateEntryFeeChange(IRebalancingSetTokenV2 _tradingPool, uint256 _newEntryFee) external onlyOwner {
        manager.initiateEntryFeeChange(_tradingPool, _newEntryFee);
    }

    function finalizeEntryFeeChange(IRebalancingSetTokenV2 _tradingPool) external onlyOwner {
        manager.finalizeEntryFeeChange(_tradingPool);
    }

    function adjustFee(address _tradingPool, bytes calldata _newFeeCallData) external onlyOwner {
        manager.adjustFee(_tradingPool, _newFeeCallData);
    }

    function removeRegisteredUpgrade(address _tradingPool, bytes32 _upgradeHash) external onlyOwner {
        manager.removeRegisteredUpgrade(_tradingPool, _upgradeHash);
    }
}