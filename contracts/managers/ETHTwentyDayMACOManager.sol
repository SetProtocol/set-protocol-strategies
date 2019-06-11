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
 * Strategy between ETH MA and the spot price of ETH. The time frame for the MA is
 * defined on instantiation When the spot price dips below the  MA ETH is sold for 
 * USDC and vice versa when the spot price exceeds the MA.
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
    uint256 constant SET_TOKEN_DECIMALS = 10**18;

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
     * @param  _movingAverageDays                   The amount of days to use in moving average calculation
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
        // Check that contract deployer is calling function
        require(
            msg.sender == contractDeployer,
            "ETHTwentyDayMACOManager.initialize: Only the contract deployer can initialize"
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

        // Create interface to interact with RebalancingSetToken and check not in Proposal state
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
     * @return uint256              Moving average USD Price of ETH
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
     * @param  _movingAveragePrice      Current MA price from Meta Oracle
     */
    function checkPriceTriggerMet(
        uint256 _ethPrice,
        uint256 _movingAveragePrice
    )
        internal
        view
    {
        if (usingRiskCollateral()) {
            // If currently holding ETH (riskOn) check to see if price is below MA, otherwise revert.
            require(
                _movingAveragePrice > _ethPrice,
                "ETHTwentyDayMACOManager.checkPriceTriggerMet: ETH Price must be below moving average price"
            );
        } else {
            // If currently holding USDC (not riskOn) check to see if price is above MA, otherwise revert.
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
     * @param  _movingAveragePrice      Current MA price from Meta Oracle
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
     * @return uint256                  The USD value of stable collateral
     * @return uint256                  The USD value of risk collateral
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
            
            (
                uint256[] memory nextSetUnits,
                uint256 nextNaturalUnit
            ) = getNewCollateralSetParameters(
                _riskCollateralValue,
                USDC_PRICE,
                USDC_DECIMALS,
                _stableCollateralDetails.naturalUnit
            );

            // Create new stable collateral set with units and naturalUnit as calculated above
            stableCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                nextNaturalUnit,
                bytes32("USDCETH"),
                bytes32("USDCETH"),
                ""
            );
            // Calculate dollar value of new stable collateral
            stableCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                USDC_PRICE,
                nextNaturalUnit,
                nextSetUnits[0],
                USDC_DECIMALS
            );
            riskCollateralDollarValue = _riskCollateralValue;
        } else {
            // Create static components and units array
            address[] memory nextSetComponents = new address[](1);
            nextSetComponents[0] = ethAddress;

            (
                uint256[] memory nextSetUnits,
                uint256 nextNaturalUnit
            ) = getNewCollateralSetParameters(
                _stableCollateralValue,
                _ethPrice,
                ETH_DECIMALS,
                _riskCollateralDetails.naturalUnit
            );

            // Create new risk collateral set with units and naturalUnit as calculated above
            riskCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                nextNaturalUnit,
                bytes32("USDC"),
                bytes32("USDC"),
                ""
            );

            // Calculate dollar value of new risk collateral
            riskCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                _ethPrice,
                nextNaturalUnit,
                nextSetUnits[0],
                ETH_DECIMALS
            );
            stableCollateralDollarValue = _stableCollateralValue;
        }

        return (stableCollateralDollarValue, riskCollateralDollarValue);
    }

    /*
     * Calculate new collateral units and natural unit. If necessary iterate through until naturalUnit
     * found that supports non-zero unit amount. Here Underlying refers to the token underlying the
     * collateral Set (i.e. ETH is underlying of riskCollateral Set).
     *
     * @param  _currentCollateralUSDValue              USD Value of current collateral set
     * @param  _replacementUnderlyingPrice             Price of underlying token to be rebalanced into
     * @param  _replacementUnderlyingDecimals          Amount of decimals in replacement token
     * @param  _replacementCollateralNaturalUnit       Natural Unit of replacement collateral Set
     * @return uint256[]                               Units array for new collateral set
     * @return uint256                                 NaturalUnit for new collateral set
     */
    function getNewCollateralSetParameters(
        uint256 _currentCollateralUSDValue,
        uint256 _replacementUnderlyingPrice,
        uint256 _replacementUnderlyingDecimals,
        uint256 _replacementCollateralNaturalUnit
    )
        internal
        pure
        returns (uint256[] memory, uint256)
    {
        // Calculate nextSetUnits such that the USD value of new Set is equal to the USD value of the Set
        // being rebalanced out of
        uint256[] memory nextSetUnits = new uint256[](1);

        uint256 potentialNextUnit = 0;
        uint256 naturalUnitMultiplier = 1;
        uint256 nextNaturalUnit;

        // Calculate next units. If nextUnit is 0 then bump natural unit (and thus units) by factor of
        // ten until unit is greater than 0
        while (potentialNextUnit == 0) {
            nextNaturalUnit = _replacementCollateralNaturalUnit.mul(naturalUnitMultiplier);
            potentialNextUnit = calculateNextSetUnits(
                _currentCollateralUSDValue,
                _replacementUnderlyingPrice,
                _replacementUnderlyingDecimals,
                nextNaturalUnit
            );
            naturalUnitMultiplier = naturalUnitMultiplier.mul(10);            
        }

        nextSetUnits[0] = potentialNextUnit;
        return (nextSetUnits, nextNaturalUnit);
    }

    /*
     * Calculate new collateral units by making the new collateral USD value equal to the USD value of the
     * Set currently collateralizing the Rebalancing Set. Here Underlying refers to the token underlying the
     * collateral Set (i.e. ETH is underlying of riskCollateral Set).
     *
     * @param  _currentCollateralUSDValue              USD Value of current collateral set
     * @param  _replacementUnderlyingPrice             Price of asset to be rebalanced into
     * @param  _replacementUnderlyingDecimals          Amount of decimals in replacement collateral
     * @param  _replacementCollateralNaturalUnit       Natural Unit of collateral set to be replacement
     * @return uint256                                 New unit for new collateral set
     */
    function calculateNextSetUnits(
        uint256 _currentCollateralUSDValue,
        uint256 _replacementUnderlyingPrice,
        uint256 _replacementUnderlyingDecimals,
        uint256 _nextNaturalUnit        
    )
        internal
        pure
        returns (uint256)
    {
        return _currentCollateralUSDValue
            .mul(10 ** _replacementUnderlyingDecimals)
            .mul(_nextNaturalUnit)
            .div(SET_TOKEN_DECIMALS.mul(_replacementUnderlyingPrice));        
    }
}

