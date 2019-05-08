/*
    Copyright 2018 Set Labs Inc.

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

import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { LinkedListLibrary } from "./lib/LinkedListLibrary.sol";


/**
 * @title DailyPriceDataBank
 * @author Set Protocol
 *
 * Contract used to store daily price data from an off-chain oracle
 */
contract DailyPriceDataBank {

    using LinkedListLibrary for LinkedListLibrary.LinkedList;

    /* ============ Constants ============ */
    uint256 constant TWENTY_FOUR_HOURS_IN_SECONDS = 86400;
    uint256 constant DAYS_IN_DATASET = 200;

    /* ============ State Variables ============ */
    address public medianizerAddress;
    uint256 public lastUpdatedAt;
    string public dataDescription;

    LinkedListLibrary.LinkedList private dailyPriceData;
    IMedian private medianizerInstance;

    /* ============ Constructor ============ */

    /*
     * Daily Price Data Bank constructor.
     * Stores daily prices according to passed in oracle address. Updates must be 
     * triggered off chain to be stored in this smart contract.
     *
     * @param  _medianizerAddress         The oracle address to read daily data from
     * @param  _dataDescription           Description of data in Data Bank
     */

    constructor(
        address _medianizerAddress,
        string memory _dataDescription
    )
        public
    {
        // Set medianizer address, data description, and instantiate medianizer
        medianizerAddress = _medianizerAddress;
        dataDescription = _dataDescription;
        medianizerInstance = IMedian(_medianizerAddress);

        // Define upper data size limit for linked list and input initial value
        uint256 initalValue = uint256(medianizerInstance.read());
        dailyPriceData.initialize(
            DAYS_IN_DATASET,
            initalValue
        );

        // Set last updated timestamp
        lastUpdatedAt = block.timestamp;
    }
}