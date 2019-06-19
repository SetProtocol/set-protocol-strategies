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

import { ERC20Detailed } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { IRebalancingSetToken } from "set-protocol-contracts/contracts/core/interfaces/IRebalancingSetToken.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { SetTokenLibrary } from "set-protocol-contracts/contracts/core/lib/SetTokenLibrary.sol";

import { IMedian } from "../external/DappHub/interfaces/IMedian.sol";
import { IMetaOracle } from "../meta-oracles/interfaces/IMetaOracle.sol";
import { FlexibleTimingManagerLibrary } from "./lib/FlexibleTimingManagerLibrary.sol";


/**
 * @title MACOStrategyManager
 * @author Set Protocol
 *
 * Rebalancing Manager contract for implementing the Moving Average (MA) Crossover
 * Strategy between a risk asset's MA and the spot price of the risk asset. The time
 * frame for the MA is defined on instantiation. When the spot price dips below the MA
 * risk asset is sold for stable asset and vice versa when the spot price exceeds the MA.
 */
contract MACOStrategyManager {
    using SafeMath for uint256;

    /* ============ Constants ============ */
    uint256 constant AUCTION_LIB_PRICE_DIVISOR = 1000;
    uint256 constant ALLOCATION_PRICE_RATIO_LIMIT = 4;

    uint256 constant TEN_MINUTES_IN_SECONDS = 600;

    // Equal to $1 since token prices are passed with 18 decimals
    uint256 constant STABLE_ASSET_PRICE = 10 ** 18;
    uint256 constant SET_TOKEN_DECIMALS = 10**18;

    /* ============ State Variables ============ */
    address public contractDeployer;
    address public rebalancingSetTokenAddress;
    address public coreAddress;
    address public movingAveragePriceFeed;
    address public setTokenFactory;
    address public auctionLibrary;

    address public stableAssetAddress;
    address public riskAssetAddress;
    address public stableCollateralAddress;
    address public riskCollateralAddress;

    uint256 public stableAssetDecimals;
    uint256 public riskAssetDecimals;

    uint256 public auctionTimeToPivot;
    uint256 public movingAverageDays;
    uint256 public lastCrossoverConfirmationTimestamp;

    uint256 public crossoverConfirmationMinTime;
    uint256 public crossoverConfirmationMaxTime;

    /* ============ Events ============ */

    event LogManagerProposal(
        uint256 riskAssetPrice,
        uint256 movingAveragePrice
    );

    /*
     * MACOStrategyManager constructor.
     *
     * @param  _coreAddress                         The address of the Core contract
     * @param  _movingAveragePriceFeed              The address of MA price feed
     * @param  _stableAssetAddress                  The address of the stable asset contract
     * @param  _riskAssetAddress                    The address of the risk asset contract
     * @param  _initialStableCollateralAddress      The address stable collateral 
     *                                              (made of stable asset wrapped in a Set Token)
     * @param  _initialRiskCollateralAddress        The address risk collateral 
     *                                              (made of risk asset wrapped in a Set Token)
     * @param  _setTokenFactory                     The address of the SetTokenFactory
     * @param  _auctionLibrary                      The address of auction price curve to use in rebalance
     * @param  _movingAverageDays                   The amount of days to use in moving average calculation
     * @param  _auctionTimeToPivot                  The amount of time until pivot reached in rebalance
     * @param  _crossoverConfirmationBounds         The minimum and maximum time in seconds confirm confirmation
     *                                                can be called after the last initial crossover confirmation
     */
    constructor(
        address _coreAddress,
        address _movingAveragePriceFeed,
        address _stableAssetAddress,
        address _riskAssetAddress,
        address _initialStableCollateralAddress,
        address _initialRiskCollateralAddress,
        address _setTokenFactory,
        address _auctionLibrary,
        uint256 _movingAverageDays,
        uint256 _auctionTimeToPivot,
        uint256[2] memory _crossoverConfirmationBounds
    )
        public
    {
        contractDeployer = msg.sender;
        coreAddress = _coreAddress;
        movingAveragePriceFeed = _movingAveragePriceFeed;
        setTokenFactory = _setTokenFactory;
        auctionLibrary = _auctionLibrary;

        stableAssetAddress = _stableAssetAddress;
        riskAssetAddress = _riskAssetAddress;
        stableCollateralAddress = _initialStableCollateralAddress;
        riskCollateralAddress = _initialRiskCollateralAddress;

        auctionTimeToPivot = _auctionTimeToPivot;
        movingAverageDays = _movingAverageDays;
        lastCrossoverConfirmationTimestamp = 0;

        crossoverConfirmationMinTime = _crossoverConfirmationBounds[0];
        crossoverConfirmationMaxTime = _crossoverConfirmationBounds[1];

        address[] memory initialRiskCollateralComponents = ISetToken(_initialRiskCollateralAddress).getComponents();
        address[] memory initialStableCollateralComponents = ISetToken(_initialStableCollateralAddress).getComponents();

        require(
            crossoverConfirmationMaxTime >= crossoverConfirmationMinTime,
            "MACOStrategyManager.constructor: Max confirmation time must be greater than min."
        );

        require(
            initialStableCollateralComponents[0] == _stableAssetAddress,
            "MACOStrategyManager.constructor: Stable collateral component must match stable asset."
        );

        require(
            initialRiskCollateralComponents[0] == _riskAssetAddress,
            "MACOStrategyManager.constructor: Risk collateral component must match risk asset."
        );

        // Get decimals of underlying assets from smart contracts
        stableAssetDecimals = ERC20Detailed(_stableAssetAddress).decimals();
        riskAssetDecimals = ERC20Detailed(_riskAssetAddress).decimals();
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
            "MACOStrategyManager.initialize: Only the contract deployer can initialize"
        );

        // Make sure the rebalancingSetToken is tracked by Core
        require(
            ICore(coreAddress).validSets(_rebalancingSetTokenAddress),
            "MACOStrategyManager.initialize: Invalid or disabled RebalancingSetToken address"
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
            block.timestamp > lastCrossoverConfirmationTimestamp.add(crossoverConfirmationMaxTime),
            "MACOStrategyManager.initialPropose: 12 hours must pass before new proposal initiated"
        );
        
        // Create interface to interact with RebalancingSetToken and check enough time has passed for proposal
        FlexibleTimingManagerLibrary.validateManagerPropose(IRebalancingSetToken(rebalancingSetTokenAddress));
        
        // Get price data from oracles
        (
            uint256 riskAssetPrice,
            uint256 movingAveragePrice
        ) = getPriceData();

        // Make sure price trigger has been reached
        checkPriceTriggerMet(riskAssetPrice, movingAveragePrice);      

        lastCrossoverConfirmationTimestamp = block.timestamp;
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
            block.timestamp >= lastCrossoverConfirmationTimestamp.add(crossoverConfirmationMinTime) &&
            block.timestamp <= lastCrossoverConfirmationTimestamp.add(crossoverConfirmationMaxTime),
            "MACOStrategyManager.confirmPropose: Confirming signal must be within bounds of the initial propose"
        );

        // Create interface to interact with RebalancingSetToken and check not in Proposal state
        FlexibleTimingManagerLibrary.validateManagerPropose(IRebalancingSetToken(rebalancingSetTokenAddress));

        // Get price data from oracles
        (
            uint256 riskAssetPrice,
            uint256 movingAveragePrice
        ) = getPriceData();

        // Make sure price trigger has been reached
        checkPriceTriggerMet(riskAssetPrice, movingAveragePrice);          

        // If price trigger has been met, get next Set allocation. Create new set if price difference is too
        // great to run good auction. Return nextSet address and dollar value of current and next set
        (
            address nextSetAddress,
            uint256 currentSetDollarValue,
            uint256 nextSetDollarValue
        ) = determineNewAllocation(
            riskAssetPrice,
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
            riskAssetPrice,
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
     * Get the risk asset and moving average prices from respective oracles. Price returned have 18 decimals so 
     * 10 ** 18 = $1.
     *
     * @return uint256              USD Price of risk asset
     * @return uint256              Moving average USD Price of risk asset
     */
    function getPriceData()
        internal
        view
        returns(uint256, uint256)
    {
        // Get raw riska asset price feed being used by moving average oracle
        address riskAssetPriceFeed = IMetaOracle(movingAveragePriceFeed).getSourceMedianizer();

        // Get current risk asset price and moving average data
        uint256 riskAssetPrice = FlexibleTimingManagerLibrary.queryPriceData(riskAssetPriceFeed);
        uint256 movingAveragePrice = uint256(IMetaOracle(movingAveragePriceFeed).read(movingAverageDays));

        return (riskAssetPrice, movingAveragePrice);        
    }

    /*
     * Check to make sure that the necessary price changes have occured to allow a rebalance.
     *
     * @param  _riskAssetPrice          Current risk asset price as found on oracle
     * @param  _movingAveragePrice      Current MA price from Meta Oracle
     */
    function checkPriceTriggerMet(
        uint256 _riskAssetPrice,
        uint256 _movingAveragePrice
    )
        internal
        view
    {
        if (usingRiskCollateral()) {
            // If currently holding risk asset (riskOn) check to see if price is below MA, otherwise revert.
            require(
                _movingAveragePrice > _riskAssetPrice,
                "MACOStrategyManager.checkPriceTriggerMet: Risk asset price must be below moving average price"
            );
        } else {
            // If currently holding stable asset (not riskOn) check to see if price is above MA, otherwise revert.
            require(
                _movingAveragePrice < _riskAssetPrice,
                "MACOStrategyManager.checkPriceTriggerMet: Risk asset price must be above moving average price"
            );
        }        
    }

    /*
     * Check to make sure that the necessary price changes have occured to allow a rebalance.
     * Determine the next allocation to rebalance into. If the dollar value of the two collateral sets is more
     * than 5x different from each other then create a new collateral set. If currently riskOn then a new
     * stable collateral set is created, if !riskOn then a new risk collateral set is created.
     *
     * @param  _riskAssetPrice          Current risk asset price as found on oracle
     * @param  _movingAveragePrice      Current MA price from Meta Oracle
     * @return address                  The address of the proposed nextSet
     * @return uint256                  The USD value of current Set
     * @return uint256                  The USD value of next Set
     */
    function determineNewAllocation(
        uint256 _riskAssetPrice,
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
        ) = checkForNewAllocation(_riskAssetPrice);

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
     * @param  _riskAssetPrice          Current risk asset price as found on oracle
     * @return uint256                  The USD value of stable collateral
     * @return uint256                  The USD value of risk collateral
     */
    function checkForNewAllocation(
        uint256 _riskAssetPrice
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
            STABLE_ASSET_PRICE,
            stableCollateralDetails.naturalUnit,
            stableCollateralDetails.units[0],
            stableAssetDecimals
        );
        uint256 riskCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            _riskAssetPrice,
            riskCollateralDetails.naturalUnit,
            riskCollateralDetails.units[0],
            riskAssetDecimals
        );
        
        // If value of one Set is 5 times greater than the other, create a new collateral Set
        if (riskCollateralDollarValue.mul(ALLOCATION_PRICE_RATIO_LIMIT) <= stableCollateralDollarValue ||
            riskCollateralDollarValue >= stableCollateralDollarValue.mul(ALLOCATION_PRICE_RATIO_LIMIT)) {
            //Determine the new collateral parameters
            return determineNewCollateralParameters(
                _riskAssetPrice,
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
     * @param  _riskAssetPrice                  Current risk asset price as found on oracle
     * @param  _stableCollateralValue           Value of current stable collateral set in USD
     * @param  _riskCollateralValue             Value of current risk collateral set in USD
     * @param  _stableCollateralDetails         Set details of current stable collateral set
     * @param  _riskCollateralDetails           Set details of current risk collateral set
     * @return uint256                          The USD value of stable collateral
     * @return uint256                          The USD value of risk collateral
     */
    function determineNewCollateralParameters(
        uint256 _riskAssetPrice,
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
            nextSetComponents[0] = stableAssetAddress;
            
            (
                uint256[] memory nextSetUnits,
                uint256 nextNaturalUnit
            ) = getNewCollateralSetParameters(
                _riskCollateralValue,
                STABLE_ASSET_PRICE,
                stableAssetDecimals,
                _stableCollateralDetails.naturalUnit
            );

            // Create new stable collateral set with units and naturalUnit as calculated above
            stableCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                nextNaturalUnit,
                bytes32("STBLCollateral"),
                bytes32("STBLMACO"),
                ""
            );
            // Calculate dollar value of new stable collateral
            stableCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                STABLE_ASSET_PRICE,
                nextNaturalUnit,
                nextSetUnits[0],
                stableAssetDecimals
            );
            riskCollateralDollarValue = _riskCollateralValue;
        } else {
            // Create static components and units array
            address[] memory nextSetComponents = new address[](1);
            nextSetComponents[0] = riskAssetAddress;

            (
                uint256[] memory nextSetUnits,
                uint256 nextNaturalUnit
            ) = getNewCollateralSetParameters(
                _stableCollateralValue,
                _riskAssetPrice,
                riskAssetDecimals,
                _riskCollateralDetails.naturalUnit
            );

            // Create new risk collateral set with units and naturalUnit as calculated above
            riskCollateralAddress = ICore(coreAddress).createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                nextNaturalUnit,
                bytes32("RISKCollateral"),
                bytes32("RISKMACO"),
                ""
            );

            // Calculate dollar value of new risk collateral
            riskCollateralDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
                _riskAssetPrice,
                nextNaturalUnit,
                nextSetUnits[0],
                riskAssetDecimals
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
        uint256 _replacementCollateralNaturalUnit        
    )
        internal
        pure
        returns (uint256)
    {
        return _currentCollateralUSDValue
            .mul(10 ** _replacementUnderlyingDecimals)
            .mul(_replacementCollateralNaturalUnit)
            .div(SET_TOKEN_DECIMALS.mul(_replacementUnderlyingPrice));        
    }
}

