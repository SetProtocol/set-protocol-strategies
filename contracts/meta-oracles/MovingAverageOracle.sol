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
import { IDailyPriceFeed } from "./interfaces/IDailyPriceFeed.sol";


/**
 * @title MovingAverageOracle
 * @author Set Protocol
 *
 * Contract used calculate moving average of data points provided by other on-chain
 * price feed and return to querying contract
 */
contract MovingAverageOracle {

    using SafeMath for uint256;

    /* ============ State Variables ============ */
    address public priceFeedAddress;
    uint256 public dataPoints;
    string public dataDescription;

    IDailyPriceFeed private priceFeedInterface;

    /* ============ Constructor ============ */

    /*
     * MovingAverageOracle constructor.
     * Contract used calculate moving average of data points provided by other on-chain
     * price feed and return to querying contract
     *
     * @param  _priceFeed               Price Feed to get list of data from
     * @param  _dataPoints              Number of data points to create average from
     * @param  _dataDescription         Description of data (i.e. 200DailyMA or 24HourMA)
     */
    constructor(
        address _priceFeed,
        uint256 _dataPoints,
        string memory _dataDescription
    )
        public
    {
        priceFeedAddress = _priceFeed;
        priceFeedInterface = IDailyPriceFeed(_priceFeed);

        dataPoints = _dataPoints;
        dataDescription = _dataDescription;
    }

    /*
     * Get moving average over defined amount of data points by querying price feed and
     * averaging returned data.
     */
    function read()
        public
        view
        returns (bytes32)
    {
        // Get data from price feed
        uint256[] memory dataArray = priceFeedInterface.read(dataPoints);

        // Sum data retrieved from daily price feed
        uint256 dataSumTotal = 0;
        for (uint256 i = 0; i < dataArray.length; i++) {
            dataSumTotal = dataSumTotal.add(dataArray[i]);
        }

        // Return average price
        return bytes32(dataSumTotal.div(dataPoints));
    }
}