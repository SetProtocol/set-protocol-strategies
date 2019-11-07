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

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { IOracle } from "../interfaces/IOracle.sol";
import { ITimeSeriesFeed } from "../interfaces/ITimeSeriesFeed.sol";


/**
 * @title LastValueOracle
 * @author Set Protocol
 *
 * Oracle built to adhere to IOracle interface and returns the most recent data point
 * in a time series feed
 */
contract LastValueOracle is
    IOracle
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    ITimeSeriesFeed public timeSeriesFeedInstance;
    string public dataDescription;

    /* ============ Constructor ============ */
    /*
     * Set price oracle is made to return
     *
     * @param  _timeSeriesFeedInstance    The address of base asset price feed
     */
    constructor(
        ITimeSeriesFeed _timeSeriesFeedInstance,
        string memory _dataDescription
    )
        public
    {
        timeSeriesFeedInstance = _timeSeriesFeedInstance;
        dataDescription = _dataDescription;
    }

    /**
     * Returns the most recent price in the price feed
     *
     * @return   Most recent price in uint256
     */
    function read()
        external
        view
        returns (uint256)
    {
        // Return most recent data from time series feed
        return timeSeriesFeedInstance.read(1)[0];
    }
} 