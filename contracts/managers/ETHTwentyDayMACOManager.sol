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
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { IRebalancingSetToken } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetToken.sol";

import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { IMetaOracle } from "../meta-oracles/interfaces/IMetaOracle.sol";
import { ManagerLibrary } from "./lib/ManagerLibrary.sol";


/**
 * @title ETHTwentyDayMACOManager
 * @author Set Protocol
 *
 * Rebalancing Manager contract for implementing the Moving Average (MA) Crossover
 * Strategy between ETH 20-day MA and the spot price of ETH. When the spot price
 * dips below the 20-day MA ETH is sold for Dai and vice versa when the spot price
 * exceeds the 20-day MA.
 */
contract ETHTwentyDayMACOManager {
    using SafeMath for uint256;

    /* ============ Constants ============ */
    uint256 constant MOVING_AVERAGE_DAYS = 20;
    uint256 constant AUCTION_LIB_PRICE_DIVISOR = 1000;

    // Equal to $1 
    uint256 constant DAI_PRICE = 10 ** 18;
    uint256 constant DAI_DECIMALS = 18;
    uint256 constant ETH_DECIMALS = 18;

    /* ============ State Variables ============ */
    address public coreAddress;
    address public movingAveragePriceFeed;
    address public setTokenFactory;
    address public auctionLibrary;

    address public daiAddress;
    address public stableCollateralAddress;
    address public riskCollateralAddress;

    uint256 public auctionTimeToPivot;
    bool public riskOn;

    /* ============ Events ============ */

    event LogManagerProposal(
        uint256 ethPrice
    );

    /*
     * ETHTwentyDayMACOManager constructor.
     *
     * @param  _coreAddress                 The address of the Core contract
     * @param  _movingAveragePriceFeed      The address of MA price feed
     * @param  _daiAddress                  The address of the Dai contract
     * @param  _stableCollateralAddress     The address stable collateral 
     *                                      (made of Dai wrapped in a Set Token)
     * @param  _riskCollateralAddress       The address risk collateral 
     *                                      (made of ETH wrapped in a Set Token)
     * @param  _setTokenFactory             The address of the SetTokenFactory
     * @param  _auctionLibrary              The address of auction price curve to use in rebalance
     * @param  _auctionTimeToPivot          The amount of time until pivot reached in rebalance
     */
    constructor(
        address _coreAddress,
        address _movingAveragePriceFeed,
        address _daiAddress,
        address _stableCollateralAddress,
        address _riskCollateralAddress,
        address _setTokenFactory,
        address _auctionLibrary,
        uint256 _auctionTimeToPivot,
        bool _riskOn
    )
        public
    {
        coreAddress = _coreAddress;
        movingAveragePriceFeed = _movingAveragePriceFeed;
        setTokenFactory = _setTokenFactory;
        auctionLibrary = _auctionLibrary;

        daiAddress = _daiAddress;
        stableCollateralAddress = _stableCollateralAddress;
        riskCollateralAddress = _riskCollateralAddress;

        auctionTimeToPivot = _auctionTimeToPivot;
        riskOn = _riskOn;
    }

    /* ============ External ============ */

    /*
     * When allowed on RebalancingSetToken, anyone can call for a new rebalance proposal
     *
     * @param  _rebalancingSetTokenAddress     The address of Rebalancing Set Token to propose new allocation
     */
    function propose(
        address _rebalancingSetTokenAddress
    )
        external
    {
        // Make sure the rebalancingSetToken is tracked by Core
        require(
            ICore(coreAddress).validSets(_rebalancingSetTokenAddress),
            "ETHTwentyDayMACOManager.propose: Invalid or disabled SetToken address"
        );
        
        // Create interface to interact with RebalancingSetToken
        IRebalancingSetToken rebalancingSetInterface = IRebalancingSetToken(_rebalancingSetTokenAddress);

        ManagerLibrary.validateManagerPropose(rebalancingSetInterface);

        // Get raw eth price feed being used by moving average oracle
        address ethPriceFeed = IMetaOracle(movingAveragePriceFeed).getSourceMedianizer();

        // Get current eth price and moving average data
        uint256 ethPrice = ManagerLibrary.queryPriceData(ethPriceFeed);
        uint256 movingAveragePrice = uint256(IMetaOracle(movingAveragePriceFeed).read(MOVING_AVERAGE_DAYS));

        // Check that price signal has been met
        checkSignalTriggered(ethPrice, movingAveragePrice);

        // Get next Set allocation, create new set if price difference is too great to run good auction
        // address nextSetAddress = determineNewAllocation();
        
        // Get current Set allocation address
        // address currentSetAddress = rebalancingSetInterface.currentSet();
    }

    /* ============ Internal ============ */

    function checkSignalTriggered(
        uint256 _ethPrice,
        uint256 _movingAveragePrice
    )
        internal
        view
    {   
        // If currently holding ETH (riskOn) check to see if price is below 20 day MA, otherwise revert.
        // If currently holding Dai (!riskOn) check to see if price is above 20 day MA, otherwise revert.
        if (riskOn) {
            require(
                _movingAveragePrice > _ethPrice,
                "ETHTwentyDayMACOManager.propose: ETH price must be below 20 day MA."
            );
        } else {
            require(
                _ethPrice > _movingAveragePrice,
                "ETHTwentyDayMACOManager.propose: ETH price must be greater than 20 day MA."   
            );
        }
    }

    function determineNewAllocation()
        internal
        view
        returns (address)
    {
        if (riskOn) {
            return stableCollateralAddress;
        } else {
            return riskCollateralAddress;
        }
    }
}

