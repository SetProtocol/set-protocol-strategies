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
import { ITimeSeriesFeed } from "./interfaces/ITimeSeriesFeed.sol";


/**
 * @title TwoAssetRatioMovingAverageOracle
 * @author Set Protocol
 *
 * Contract used calculate simple moving average of the ratio of base to quote 
 * asset using on-chain price feeds and return to querying contract.
 */
contract TwoAssetRatioMovingAverageOracle {

    using SafeMath for uint256;

    /* ============ State Variables ============ */
    string public dataDescription;
    ITimeSeriesFeed public baseTimeSeriesFeedInstance;
    ITimeSeriesFeed public quoteTimeSeriesFeedInstance;

    /* ============ Constructor ============ */

    /*
     * TwoAssetRatioMovingAverageOracle constructor.
     * Contract used calculate simple moving average of the ratio of two assets using on-chain
     * price feeds and return to querying contract.
     *
     * @param  _baseTimeSeriesFeed      TimeSeriesFeed for base asset to get list of data from
     * @param  _quoteTimeSeriesFeed     TimeSeriesFeed for quote asset to get list of data from
     * @param  _dataDescription         Description of data
     */
    constructor(
        ITimeSeriesFeed _baseTimeSeriesFeed,
        ITimeSeriesFeed _quoteTimeSeriesFeed,
        string memory _dataDescription
    )
        public
    {
        baseTimeSeriesFeedInstance = _baseTimeSeriesFeed;

        quoteTimeSeriesFeedInstance = _quoteTimeSeriesFeed;

        dataDescription = _dataDescription;
    }

    /*
     * Get moving average over defined amount of data points by querying price feeds and
     * averaging returned data. For price granularity, prices are multiplied by 10 ** 18
     * Returns uint256.
     *
     * @param  _dataPoints       Number of data points to create average from
     * @returns                  Moving average for passed number of _dataPoints
     */
    function read(
        uint256 _dataPoints    
    )
        external
        view
        returns (uint256)
    {
        // Get data from base asset price feed
        uint256[] memory baseDataArray = baseTimeSeriesFeedInstance.read(_dataPoints);

        // Get data from quote asset price feed
        uint256[] memory quoteDataArray = quoteTimeSeriesFeedInstance.read(_dataPoints);

        // Calculate ratio and sum data from price feeds
        uint256 dataSum = 0;
        for (uint256 i = 0; i < baseDataArray.length; i++) {
            uint256 ratio = baseDataArray[i].mul(10 ** 18).div(quoteDataArray[i]);
            dataSum = dataSum.add(ratio);
        }

        // Return average price
        return dataSum.div(_dataPoints);
    }
}