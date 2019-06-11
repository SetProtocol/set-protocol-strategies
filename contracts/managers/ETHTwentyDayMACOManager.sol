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
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { SetTokenLibrary } from "set-protocol-contracts/contracts/core/lib/SetTokenLibrary.sol";

import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { IMetaOracle } from "../meta-oracles/interfaces/IMetaOracle.sol";
import { FlexibleTimingManagerLibrary } from "./lib/FlexibleTimingManagerLibrary.sol";


/**
 * @title ETHTwentyDayMACOManager
 * @author Set Protocol
 *
 * Rebalancing Manager contract for implementing the Moving Average (MA) Crossover
 * Strategy between ETH 20-day MA and the spot price of ETH. When the spot price
 * dips below the 20-day MA ETH is sold for USDC and vice versa when the spot price
 * exceeds the 20-day MA.
 */
contract ETHTwentyDayMACOManager {
    using SafeMath for uint256;

    /* ============ Constants ============ */
    uint256 constant AUCTION_LIB_PRICE_DIVISOR = 1000;
    uint256 constant ALLOCATION_PRICE_RATIO_LIMIT = 4;

    uint256 constant TEN_MINUTES_IN_SECONDS = 600;
    uint256 constant SIX_HOURS_IN_SECONDS = 21600;
    uint256 constant TWELVE_HOURS_IN_SECONDS = 43200;

    // Equal to $1 since token prices are passed with 18 decimals
    uint256 constant USDC_PRICE = 10 ** 18;
    uint256 constant USDC_DECIMALS = 6;
    uint256 constant ETH_DECIMALS = 18;

    /* ============ State Variables ============ */
    address public contractDeployer;
    address public rebalancingSetTokenAddress;
    address public coreAddress;
    address public movingAveragePriceFeed;
    address public setTokenFactory;
    address public auctionLibrary;

    address public usdcAddress;
    address public wethAddress;
    address public stableCollateralAddress;
    address public riskCollateralAddress;

    uint256 public auctionTimeToPivot;
    uint256 public movingAverageDays;
    uint256 public lastProposalTimestamp;

    /* ============ Events ============ */

    event LogManagerProposal(
        uint256 ethPrice,
        uint256 movingAveragePrice
    );

    /*
     * ETHTwentyDayMACOManager constructor.
     *
     * @param  _coreAddress                         The address of the Core contract
     * @param  _movingAveragePriceFeed              The address of MA price feed
     * @param  _usdcAddress                         The address of the USDC contract
     * @param  _wethAddress                         The address of the WETH contract
     * @param  _initialStableCollateralAddress      The address stable collateral 
     *                                              (made of USDC wrapped in a Set Token)
     * @param  _initialRiskCollateralAddress        The address risk collateral 
     *                                              (made of ETH wrapped in a Set Token)
     * @param  _setTokenFactory                     The address of the SetTokenFactory
     * @param  _auctionLibrary                      The address of auction price curve to use in rebalance
     * @param  _auctionTimeToPivot                  The amount of time until pivot reached in rebalance
     */
    constructor(
        address _coreAddress,
        address _movingAveragePriceFeed,
        address _usdcAddress,
        address _wethAddress,
        address _initialStableCollateralAddress,
        address _initialRiskCollateralAddress,
        address _setTokenFactory,
        address _auctionLibrary,
        uint256 _movingAverageDays,
        uint256 _auctionTimeToPivot
    )
        public
    {
        contractDeployer = msg.sender;
        coreAddress = _coreAddress;
        movingAveragePriceFeed = _movingAveragePriceFeed;
        setTokenFactory = _setTokenFactory;
        auctionLibrary = _auctionLibrary;

        usdcAddress = _usdcAddress;
        wethAddress = _wethAddress;
        stableCollateralAddress = _initialStableCollateralAddress;
        riskCollateralAddress = _initialRiskCollateralAddress;

        auctionTimeToPivot = _auctionTimeToPivot;
        movingAverageDays = _movingAverageDays;
        lastProposalTimestamp = 0;
    }

    /* ============ External ============ */

    /*
     * This function sets the Rebalancing Set Token address that the manager is associated with.
     * Since, the rebalancing set token must first specify the address of the manager before deployment,
     * we cannot know what the rebalancing set token is in advance. This function is only meant to be called 
     * once during initialization by the contract deployer.
     *
     * @param  _rebalancingSetTokenAddress       The address of the rebalancing Set token
     */
    function initialize(
        address _rebalancingSetTokenAddress
    )
        external
    {
        require(
            msg.sender == contractDeployer,
            "ETHTwentyDayMACOManager.initialize: Only the contract deployer can initialize"
        );

        require(
            rebalancingSetTokenAddress == address(0),
            "ETHTwentyDayMACOManager.initialize: Rebalancing SetToken Address must be empty"
        );

        // Make sure the rebalancingSetToken is tracked by Core
        require(
            ICore(coreAddress).validSets(_rebalancingSetTokenAddress),
            "ETHTwentyDayMACOManager.initialize: Invalid or disabled RebalancingSetToken address"
        );

        rebalancingSetTokenAddress = _rebalancingSetTokenAddress;
        contractDeployer = address(0);
    }

    /*
     * When allowed on RebalancingSetToken, anyone can call for a new rebalance proposal. This begins a six
     * hour period where the signal can be confirmed before moving ahead with rebalance.
     *
     */
    function initialPropose()
        external
    {
        // Make sure propose in manager hasn't already been initiated
        require(
            block.timestamp > lastProposalTimestamp.add(TWELVE_HOURS_IN_SECONDS),
            "ETHTwentyDayMACOManager.initialPropose: 12 hours must pass before new proposal initiated"
        );
        
        // Create interface to interact with RebalancingSetToken and check enough time has passed for proposal
        FlexibleTimingManagerLibrary.validateManagerPropose(IRebalancingSetToken(rebalancingSetTokenAddress));
        
        // Get price data from oracles
        (
            uint256 ethPrice,
            uint256 movingAveragePrice
        ) = getPriceData();

        // Make sure price trigger has been reached
        checkPriceTriggerMet(ethPrice, movingAveragePrice);      

        lastProposalTimestamp = block.timestamp;
    }

    /*
     * After initial propose is called, confirm the signal has been met and determine parameters for the rebalance
     *
     */
    function confirmPropose()
        external
    {
        // Make sure enough time has passed to initiate proposal on Rebalancing Set Token
        require(
            block.timestamp >= lastProposalTimestamp.add(SIX_HOURS_IN_SECONDS) &&
            block.timestamp <= lastProposalTimestamp.add(TWELVE_HOURS_IN_SECONDS),
            "ETHTwentyDayMACOManager.confirmPropose: Confirming signal must be 6-12 hours from initial propose"
        );

        // Create interface to interact with RebalancingSetToken and check enough time has passed for proposal
        FlexibleTimingManagerLibrary.validateManagerPropose(IRebalancingSetToken(rebalancingSetTokenAddress));

        // Get price data from oracles
        (
            uint256 ethPrice,
            uint256 movingAveragePrice
        ) = getPriceData();

        // Make sure price trigger has been reached
        checkPriceTriggerMet(ethPrice, movingAveragePrice);          

        // If price trigger has been met, get next Set allocation. Create new set if price difference is too
        // great to run good auction. Return nextSet address and dollar value of current and next set
        (
            address nextSetAddress,
            uint256 currentSetDollarValue,
            uint256 nextSetDollarValue
        ) = determineNewAllocation(
            ethPrice,
            movingAveragePrice
        );

        // Calculate the price parameters for auction
        (
            uint256 auctionStartPrice,
            uint256 auctionPivotPrice
        ) = FlexibleTimingManagerLibrary.calculateAuctionPriceParameters(
            currentSetDollarValue,
            nextSetDollarValue,
            TEN_MINUTES_IN_SECONDS,
            AUCTION_LIB_PRICE_DIVISOR,
            auctionTimeToPivot
        );

        // Propose new allocation to Rebalancing Set Token
        IRebalancingSetToken(rebalancingSetTokenAddress).propose(
            nextSetAddress,
            auctionLibrary,
            auctionTimeToPivot,
            auctionStartPrice,
            auctionPivotPrice
        );

        emit LogManagerProposal(
            ethPrice,
            movingAveragePrice
        );
    }

    /* ============ Internal ============ */

    /*
     * Determine if risk collateral is currently collateralizing the rebalancing set, if so return true,
     * else return false.
     *
     * @return boolean              True if risk collateral in use, false otherwise
     */
    function usingRiskCollateral()
        internal
        view
        returns (bool)
    {
        // Get set currently collateralizing rebalancing set token
        address[] memory currentCollateralComponents = ISetToken(rebalancingSetTokenAddress).getComponents();

        // If collateralized by riskCollateral set return true, else to false
        return (currentCollateralComponents[0] == riskCollateralAddress);
    }

    /*
     * Get the ETH and moving average prices from respective oracles. Price returned have 18 decimals so 
     * 10 ** 18 = $1.
     *
     * @return uint256              USD Price of ETH
     * @return uint256              20 day moving average USD Price of ETH
     */
    function getPriceData()
        internal
        view
        returns(uint256, uint256)
    {
        // Get raw eth price feed being used by moving average oracle
        address ethPriceFeed = IMetaOracle(movingAveragePriceFeed).getSourceMedianizer();

        // Get current eth price and moving average data
        uint256 ethPrice = FlexibleTimingManagerLibrary.queryPriceData(ethPriceFeed);
        uint256 movingAveragePrice = uint256(IMetaOracle(movingAveragePriceFeed).read(movingAverageDays));

        return (ethPrice, movingAveragePrice);        
    }

    /*
     * Check to make sure that the necessary price changes have occured to allow a rebalance.
     *
     * @param  _ethPrice                Current Ethereum price as found on oracle
     * @param  _movingAveragePrice      Current 20 day MA price from Meta Oracle
     */
    function checkPriceTriggerMet(
        uint256 _ethPrice,
        uint256 _movingAveragePrice
    )
        internal
        view
    {
        if (usingRiskCollateral()) {
            // If currently holding ETH (riskOn) check to see if price is below 20 day MA, otherwise revert.
            require(
                _movingAveragePrice > _ethPrice,
                "ETHTwentyDayMACOManager.checkPriceTriggerMet: ETH Price must be below moving average price"
            );
        } else {
            // If currently holding USDC (not riskOn) check to see if price is above 20 day MA, otherwise revert.
            require(
                _movingAveragePrice < _ethPrice,
                "ETHTwentyDayMACOManager.checkPriceTriggerMet: ETH Price must be above moving average price"
            );
        }        
    }

    /*
     * Check to make sure that the necessary price changes have occured to allow a rebalance.
     * Determine the next allocation to rebalance into. If the dollar value of the two collateral sets is more
     * than 5x different from each other then create a new collateral set. If currently riskOn then a new
     * stable collateral set is created, if !riskOn then a new risk collateral set is created.
     *
     * @param  _ethPrice                Current Ethereum price as found on oracle
     * @param  _movingAveragePrice      Current 20 day MA price from Meta Oracle
     * @return address                  The address of the proposed nextSet
     * @return uint256                  The USD value of current Set
     * @return uint256                  The USD value of next Set
     */
    function determineNewAllocation(
        uint256 _ethPrice,
        uint256 _movingAveragePrice
    )
        internal
        returns (address, uint256, uint256)
    {
        // Check to see if new collateral must be created in order to keep collateral price ratio in line.
        // If not just return the dollar value of current collateral sets
        (
            uint256 stableCollateralDollarValue,
            uint256 riskCollateralDollarValue
        ) = checkForNewAllocation(_ethPrice);

        (
            address nextSetAddress,
            uint256 currentSetDollarValue,
            uint256 nextSetDollarValue
        ) = usingRiskCollateral() ? (stableCollateralAddress, riskCollateralDollarValue, stableCollateralDollarValue) : 
            (riskCollateralAddress, stableCollateralDollarValue, riskCollateralDollarValue);

        return (nextSetAddress, currentSetDollarValue, nextSetDollarValue);
    }

    /*
     * Check to see if a new collateral set needs to be created. If the dollar value of the two collateral sets is more
     * than 5x different from each other then create a new collateral set.
     *
     * @param  _ethPrice                Current Ethereum price as found on oracle
     * @return uint256                          The USD value of stable collateral
     * @return uint256                          The USD value of risk collateral
     */
    function checkForNewAllocation(
        uint256 _ethPrice
    )
        internal
        returns(uint256, uint256)
    {
        // Get details of both collateral sets
        SetTokenLibrary.SetDetails memory stableCollateralDetails = SetTokenLibrary.getSetDetails(
            stableCollateralAddress
        );
        SetTokenLibrary.SetDetails memory riskCollateralDetails = SetTokenLibrary.getSetDetails(
            riskCollateralAddress
        );

        // Value both Sets
        uint256 stableCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            USDC_PRICE,
            stableCollateralDetails.naturalUnit,
            stableCollateralDetails.units[0],
            USDC_DECIMALS
        );
        uint256 riskCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            _ethPrice,
            riskCollateralDetails.naturalUnit,
            riskCollateralDetails.units[0],
            ETH_DECIMALS
        );
        
        // If value of one Set is 5 times greater than the other, create a new collateral Set
        if (riskCollateralDollarValue.mul(ALLOCATION_PRICE_RATIO_LIMIT) <= stableCollateralDollarValue ||
            riskCollateralDollarValue >= stableCollateralDollarValue.mul(ALLOCATION_PRICE_RATIO_LIMIT)) {
            //Determine the new collateral parameters
            return determineNewCollateralParameters(
                _ethPrice,
                stableCollateralDollarValue,
                riskCollateralDollarValue,
                stableCollateralDetails,
                riskCollateralDetails
            );
        } else {
            return (stableCollateralDollarValue, riskCollateralDollarValue);
        }
    }

    /*
     * Create new collateral Set for the occasion where the dollar value of the two collateral 
     * sets is more than 5x different from each other. The new collateral set address is then
     * assigned to the correct state variable (risk or stable collateral) 
     *
     * @param  _ethPrice                        Current Ethereum price as found on oracle
     * @param  _stableCollateralValue           Value of current stable collateral set in USD
     * @param  _riskCollateralValue             Value of current risk collateral set in USD
     * @param  _stableCollateralDetails         Set details of current stable collateral set
     * @param  _riskCollateralDetails           Set details of current risk collateral set
     * @return uint256                          The USD value of stable collateral
     * @return uint256                          The USD value of risk collateral
     */
    function determineNewCollateralParameters(
        uint256 _ethPrice,
        uint256 _stableCollateralValue,
        uint256 _riskCollateralValue,
        SetTokenLibrary.SetDetails memory _stableCollateralDetails,
        SetTokenLibrary.SetDetails memory _riskCollateralDetails
    )
        internal
        returns (uint256, uint256)
    {
        uint256 stableCollateralDollarValue;
        uint256 riskCollateralDollarValue;

        if (usingRiskCollateral()) {
            // Create static components and units array
            address[] memory nextSetComponents = new address[](1);
            nextSetComponents[0] = usdcAddress;
            uint256[] memory nextSetUnits = getNewCollateralSetUnits(
                _riskCollateralValue,
                USDC_PRICE,
                USDC_DECIMALS,
                _stableCollateralDetails
            );

            // Create new stable collateral set with units and naturalUnit as calculated above
            stableCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                _stableCollateralDetails.naturalUnit,
                bytes32("USDCETH"),
                bytes32("USDCETH"),
                ""
            );
            // Calculate dollar value of new stable collateral
            stableCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                USDC_PRICE,
                _stableCollateralDetails.naturalUnit,
                nextSetUnits[0],
                USDC_DECIMALS
            );
            riskCollateralDollarValue = _riskCollateralValue;
        } else {
            // Create static components and units array
            address[] memory nextSetComponents = new address[](1);
            nextSetComponents[0] = wethAddress;
            uint256[] memory nextSetUnits = getNewCollateralSetUnits(
                _stableCollateralValue,
                _ethPrice,
                ETH_DECIMALS,
                _riskCollateralDetails
            );

            // Create new risk collateral set with units and naturalUnit as calculated above
            riskCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                _riskCollateralDetails.naturalUnit,
                bytes32("USDC"),
                bytes32("USDC"),
                ""
            );

            // Calculate dollar value of new risk collateral
            riskCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                _ethPrice,
                _riskCollateralDetails.naturalUnit,
                nextSetUnits[0],
                ETH_DECIMALS
            );
            stableCollateralDollarValue = _stableCollateralValue;
        }

        return (stableCollateralDollarValue, riskCollateralDollarValue);
    }

    /*
     * Calculate new collateral units by making the new collateral USD value equal to the USD value of the
     * Set currently collateralizing the Rebalancing Set
     *
     * @param  _currentCollateralUSDValue           USD Value of current collateral set
     * @param  _replacedCollateralPrice             Price of asset to be rebalanced into
     * @param  _replacedCollateralDecimals          Amount of decimals in replacement collateral
     * @param  _replacedCollateralDetails           Details of Set to be replaced
     * @return uint256[]                            Units array for new collateral set
     */
    function getNewCollateralSetUnits(
        uint256 _currentCollateralUSDValue,
        uint256 _replacedCollateralPrice,
        uint256 _replacedCollateralDecimals,
        SetTokenLibrary.SetDetails memory _replacedCollateralDetails
    )
        internal
        pure
        returns (uint256[] memory)
    {
        uint256 SET_TOKEN_DECIMALS = 10**18;
        // Calculate nextSetUnits such that the USD value of new Set is equal to the USD value of the Set
        // being rebalanced out of
        uint256[] memory nextSetUnits = new uint256[](1);
        nextSetUnits[0] = _currentCollateralUSDValue
            .mul(10 ** _replacedCollateralDecimals)
            .mul(_replacedCollateralDetails.naturalUnit)
            .div(SET_TOKEN_DECIMALS.mul(_replacedCollateralPrice));
        return nextSetUnits;      
    }
}

