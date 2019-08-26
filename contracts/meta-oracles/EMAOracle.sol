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
import { TimeLockUpgrade } from "set-protocol-contracts/contracts/lib/TimeLockUpgrade.sol";

import { ITimeSeriesFeed } from "./interfaces/ITimeSeriesFeed.sol";
import { IMetaOracleV2 } from "./interfaces/IMetaOracleV2.sol";


/**
 * @title EMAOracle
 * @author Set Protocol
 *
 */
contract EMAOracle is
    TimeLockUpgrade,
    IMetaOracleV2
{

    using SafeMath for uint256;

    /* ============ Events ============ */

    event FeedAdded(
        address indexed newFeedAddress,
        uint256 indexed emaDays
    );

    /* ============ Events ============ */

    event FeedRemoved(
        address indexed newFeedAddress,
        uint256 indexed emaDays
    );

    /* ============ State Variables ============ */
    string public dataDescription;

    // Mapping of EMA Days to Time Series Feeds
    mapping(uint256 => ITimeSeriesFeed) public emaTimeSeriesFeeds;

    /* ============ Constructor ============ */

    /*
     * EMAOracle constructor.
     * Contract used calculate moving average of data points provided by other on-chain
     * price feed and return to querying contract
     *
     * @param  _timeSeriesFeed          TimeSeriesFeed to get list of data from
     * @param  _dataDescription         Description of data
     */
    constructor(
        ITimeSeriesFeed[] memory _timeSeriesFeeds,
        uint256[] memory _timeSeriesFeedDays,
        string memory _dataDescription
    )
        public
    {
        dataDescription = _dataDescription;

        // Require that the feeds inputted and days are the same
        require(_timeSeriesFeeds.length == _timeSeriesFeedDays.length, 'Len must be the same');

        // Loop through the feeds and add to the mapping
        for (uint256 i = 0; i < _timeSeriesFeeds.length; i++) {
            uint256 emaDay = _timeSeriesFeedDays[i];
            emaTimeSeriesFeeds[emaDay] = _timeSeriesFeeds[i];
        }
    }

    /*
     * Get moving average over defined amount of data points by querying price feed and
     * averaging returned data. Returns uint256.
     *
     * @param  _emaDays          Number of data points to create average from
     * @returns                  Moving average for passed number of _emaDays
     */
    function read(
        uint256 _emaDays    
    )
        external
        view
        returns (uint256)
    {
        ITimeSeriesFeed emaFeedInstance = emaTimeSeriesFeeds[_emaDays];

        // EMA Feed must be added
        require(address(emaFeedInstance) != address(0));

        // Get the current EMA value
        return emaFeedInstance.read(1)[0];
    }

    function addFeed(ITimeSeriesFeed _feedAddress, uint256 _emaDays)
        external
        onlyOwner
    {
        require(address(emaTimeSeriesFeeds[_emaDays]) == address(0));

        emaTimeSeriesFeeds[_emaDays] = _feedAddress;

        emit FeedAdded(address(_feedAddress), _emaDays);
    }

    function removeFeed(uint256 _emaDays)
        external
        onlyOwner
    {
        address emaTimeSeriesFeed = address(emaTimeSeriesFeeds[_emaDays]);

        require(emaTimeSeriesFeed != address(0));

        emaTimeSeriesFeeds[_emaDays] = ITimeSeriesFeed(address(0));

        emit FeedRemoved(emaTimeSeriesFeed, _emaDays);
    }
}