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
 * @title TwoAssetLastPeriodPriceOracle
 * @author Set Protocol
 *
 * Oracle built to adhere to IOracle interface and returns the ratio of a base
 * to quote asset for the most recent data point in a time series feed
 */
contract TwoAssetLastPeriodPriceOracle is
    IOracle
{
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    ITimeSeriesFeed public baseTimeSeriesFeedInstance;
    ITimeSeriesFeed public quoteTimeSeriesFeedInstance;
    string public dataDescription;

    /* ============ Constructor ============ */
    /*
     * Set price oracle is made to return
     *
     * @param  _baseTimeSeriesFeedInstance    The address of base asset price feed
     * @param  _quoteTimeSeriesFeedInstance   The address of quote asset price feed
     */
    constructor(
        ITimeSeriesFeed _baseTimeSeriesFeedInstance,
        ITimeSeriesFeed _quoteTimeSeriesFeedInstance,
        string memory _dataDescription
    )
        public
    {
        baseTimeSeriesFeedInstance = _baseTimeSeriesFeedInstance;
        quoteTimeSeriesFeedInstance = _quoteTimeSeriesFeedInstance;
        dataDescription = _dataDescription;
    }

    /**
     * Returns the most recent price in the price feeds and calculate
     * the ratio of base asset / quote asset. Multiply by 10 ** 18 for precision
     *
     * @return  Ratio of base / quote asset represented in uint256
     */
    function read()
        external
        view
        returns (uint256)
    {
        // Get most recent data from base asset price feed
        uint256 baseCurrentPrice = baseTimeSeriesFeedInstance.read(1)[0];

        // Get most recent data from quote asset price feed
        uint256 quoteCurrentPrice = quoteTimeSeriesFeedInstance.read(1)[0];

        // Return base / quote with 10 ** 18 precision
        return baseCurrentPrice.mul(10 ** 18).div(quoteCurrentPrice);
    }
}