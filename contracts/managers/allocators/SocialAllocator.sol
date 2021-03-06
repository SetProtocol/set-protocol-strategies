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

import { ERC20Detailed } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import { Math } from "openzeppelin-solidity/contracts/math/Math.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { CommonMath } from "set-protocol-contract-utils/contracts/lib/CommonMath.sol";
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { IOracleWhiteList } from "set-protocol-contracts/contracts/core/interfaces/IOracleWhiteList.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { SetTokenLibrary } from "set-protocol-contracts/contracts/core/lib/SetTokenLibrary.sol";
import { SetUSDValuation } from "set-protocol-contracts/contracts/core/liquidators/impl/SetUSDValuation.sol";
import { IOracle } from "set-protocol-oracles/contracts/meta-oracles/interfaces/IOracle.sol";

import { AllocatorMathLibrary } from "../lib/AllocatorMathLibrary.sol";
import { FlexibleTimingManagerLibrary } from "../lib/FlexibleTimingManagerLibrary.sol";
import { ISocialAllocator } from "./ISocialAllocator.sol";


/**
 * @title SocialAllocator
 * @author Set Protocol
 *
 * Implementing ISocialAllocator the SocialAllocator creates new SetTokens that represent a mix of two
 * assets.
 */
contract SocialAllocator is
    ISocialAllocator
{
    using SafeMath for uint256;
    using CommonMath for uint256;

    /* ============ Structs ============ */

    struct AssetPrices {
        uint256 baseAssetPrice;
        uint256 quoteAssetPrice;
    }

    /* ============ Constants ============ */
    // Asset multiplier for single assets. Used to define value of collateral as 4 * (priceA, priceB).
    uint256 constant public SINGLE_ASSET_MULTIPLER = 4e18;
    uint256 constant public MAXIMUM_ALLOCATION = 1e18;

    /* ============ State Variables ============ */
    ICore public core;
    address public setTokenFactory;

    ERC20Detailed public baseAsset;
    ERC20Detailed public quoteAsset;
    IOracleWhiteList public oracleWhiteList;
    uint8 public baseAssetDecimals;
    uint8 public quoteAssetDecimals;

    uint256 public pricePrecision;
    uint256 public collateralNaturalUnit;
    bytes32 public collateralName;
    bytes32 public collateralSymbol;

    address[] public multiAssetNextSetComponents;
    address[] public baseAssetNextSetComponents;
    address[] public quoteAssetNextSetComponents;
    uint256 public baseAssetFullUnitMultiplier;
    uint256 public quoteAssetFullUnitMultiplier;

    /*
     * SocialAllocator constructor.
     *
     * @param  _baseAsset                   The baseAsset address
     * @param  _quoteAsset                  The quoteAsset address
     * @param  _oracleWhiteList             List of assets to their matching oracles
     * @param  _core                        The address of the Core contract
     * @param  _setTokenFactory             The address of SetTokenFactory used to create new collateral
     * @param  _pricePrecision              Amount of significant figures kept in determining new units
     * @param  _collateralName              Name of collateral Sets created by this Allocator
     * @param  _collateralSymbol            Symbol of collateral Sets created by this Allocator
     */
    constructor(
        ERC20Detailed _baseAsset,
        ERC20Detailed _quoteAsset,
        IOracleWhiteList _oracleWhiteList,
        ICore _core,
        address _setTokenFactory,
        uint256 _pricePrecision,
        bytes32 _collateralName,
        bytes32 _collateralSymbol
    )
        public
    {
        require(
            _pricePrecision > 0,
            "SocialAllocator.constructor: Price precision must be greater than 0."
        );

        baseAsset = _baseAsset;
        quoteAsset = _quoteAsset;

        oracleWhiteList = _oracleWhiteList;
        core = _core;
        setTokenFactory = _setTokenFactory;
        pricePrecision = _pricePrecision;
        collateralName = _collateralName;
        collateralSymbol = _collateralSymbol;

        // Query decimals of base and quote assets
        baseAssetDecimals = _baseAsset.decimals();
        quoteAssetDecimals = _quoteAsset.decimals();

        // Calculate constants that will be used in calculations
        uint256 minDecimals = Math.min(baseAssetDecimals, quoteAssetDecimals);

        // Decimal difference for asset a1 is 10 ** (a1Decimals - min(a1Decimals, a2Decimals))
        baseAssetFullUnitMultiplier = CommonMath.safePower(10, uint256(baseAssetDecimals).sub(minDecimals));
        quoteAssetFullUnitMultiplier = CommonMath.safePower(10, uint256(quoteAssetDecimals).sub(minDecimals));

        // NaturalUnit is equal to max(a1DecimalDifference, a2DecimalDifference) * pricePrecision
        collateralNaturalUnit = CommonMath.safePower(10, uint256(18).sub(minDecimals))
            .mul(pricePrecision);

        // Next set components will always be in order of base asset first
        multiAssetNextSetComponents = [address(baseAsset), address(quoteAsset)];
        baseAssetNextSetComponents = [address(baseAsset)];
        quoteAssetNextSetComponents = [address(quoteAsset)];
    }

    /* ============ External ============ */

    /*
     * Determine the next allocation to rebalance into.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset in a scaled decimal value
     *                                          (e.g. 100% = 1e18, 1% = 1e16)
     * @return ISetToken                        The address of the proposed nextSet
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation
    )
        external
        returns (ISetToken)
    {
        require(
            _targetBaseAssetAllocation <= MAXIMUM_ALLOCATION,
            "SocialAllocator.determineNewAllocation: Passed allocation must not exceed 100%."
        );

        // Determine nextSet units and components
        (
            uint256[] memory nextSetUnits,
            address[] memory nextSetComponents
        )= calculateNextSetParameters(
            _targetBaseAssetAllocation
        );

        // Create new collateral set with passed components, units, and collateralNaturalUnit
        address nextSetAddress = core.createSet(
            setTokenFactory,
            nextSetComponents,
            nextSetUnits,
            collateralNaturalUnit,
            collateralName,
            collateralSymbol,
            ""
        );

        return ISetToken(nextSetAddress);
    }

    /*
     * Calculate value of passed collateral set.
     *
     * @param  _collateralSet        Address of current set collateralizing RebalancingSetToken
     * @return uint256               USD value of 10 **18 units of passed Set
     */
    function calculateCollateralSetValue(
        ISetToken _collateralSet
    )
        external
        view
        returns (uint256)
    {
        return SetUSDValuation.calculateSetTokenDollarValue(_collateralSet, oracleWhiteList);
    }

    /* ============ Internal ============ */

    /*
     * Determine units and component array of nextSet. Direct to correct calculating function
     * based on if allocation is mix of assets or single asset.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @return uint256[]                        Unit array of nextSet collateral
     * @return address[]                        Component array of nextSet collateral
     */
    function calculateNextSetParameters(
        uint256 _targetBaseAssetAllocation
    )
        internal
        view
        returns (uint256[] memory, address[] memory)
    {
        // Get prices
        AssetPrices memory assetPrices = getAssetPrices();

        // Calculate allocationUnitValues, or the amount of each component equal to max(Pa1, Pa2)
        uint256 baseAssetAllocationUnitValue = Math.max(
            assetPrices.quoteAssetPrice.mul(pricePrecision).div(assetPrices.baseAssetPrice),
            pricePrecision
        );

        uint256 quoteAssetAllocationUnitValue = Math.max(
            assetPrices.baseAssetPrice.mul(pricePrecision).div(assetPrices.quoteAssetPrice),
            pricePrecision
        );

        // If single asset use correct asset vars to calculate units, and return correct component array
        if (_targetBaseAssetAllocation == 0) {
            uint256[] memory units = calculateSingleAssetNextSetUnits(
                quoteAssetAllocationUnitValue,
                quoteAssetFullUnitMultiplier
            );

            return (units, quoteAssetNextSetComponents);
        } else if (_targetBaseAssetAllocation == MAXIMUM_ALLOCATION) {
            uint256[] memory units = calculateSingleAssetNextSetUnits(
                baseAssetAllocationUnitValue,
                baseAssetFullUnitMultiplier
            );

            return (units, baseAssetNextSetComponents);
        }

        // Calculate multi-asset units and component arrays
        return calculateMultiAssetNextSetParameters(
            _targetBaseAssetAllocation,
            baseAssetAllocationUnitValue,
            quoteAssetAllocationUnitValue
        );
    }

    /*
     * Calculate units of next Set. Calculating the units for asset 1 (a1) is as follows:
     *      a1DecimalDifference * a1Multiplier * max(Pa2*pricePrecision/Pa1, pricePrecision)
     *
     * Where DecimalDifference is defined as such (set in constructor):
     *      10 ** (a1Decimals - min(a1Decimals, a2Decimals))
     *
     * Multiplier is defined as:
     *      max(a1Allocation/a2Allocation, 1)
     *
     * And Pa1 is price of asset 1 and Pa2 is price of asset 2
     *
     * This results in a Set Token that's value is max(Pa1, Pa2) * (a1Multiplier + a2Multiplier)
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _baseAssetAllocationUnitValue    Amount in base component units equal in USD to max(Pa1, Pa2)
     * @param  _quoteAssetAllocationUnitValue   Amount in quote component units equal in USD to max(Pa1, Pa2)
     * @return uint256[]                        Unit array of nextSet collateral
     * @return address[]                        Component array of nextSet collateral
     */
    function calculateMultiAssetNextSetParameters(
        uint256 _targetBaseAssetAllocation,
        uint256 _baseAssetAllocationUnitValue,
        uint256 _quoteAssetAllocationUnitValue
    )
        internal
        view
        returns (uint256[] memory, address[] memory)
    {
        // Get quote asset allocation
        uint256 quoteAssetAllocation = MAXIMUM_ALLOCATION.sub(_targetBaseAssetAllocation);

        // Calculate multiplier for quote and base asset. Multiplier is just the amount of highest
        // allocation divided by lowest allocation. Asset that has lowest allocation will have
        // multiplier set to 1.
        uint256 baseAssetMultiplier = Math.max(_targetBaseAssetAllocation.scale().div(quoteAssetAllocation), CommonMath.scaleFactor());
        uint256 quoteAssetMultiplier = Math.max(quoteAssetAllocation.scale().div(_targetBaseAssetAllocation), CommonMath.scaleFactor());

        uint256[] memory units = new uint256[](2);
        // Get baseAsset units
        units[0] = calculateUnitAmount(
            _baseAssetAllocationUnitValue,
            baseAssetMultiplier,
            baseAssetFullUnitMultiplier
        );

        // Get quote asset units
        units[1] = calculateUnitAmount(
            _quoteAssetAllocationUnitValue,
            quoteAssetMultiplier,
            quoteAssetFullUnitMultiplier
        );

        return (units, multiAssetNextSetComponents);
    }

    /*
     * Calculate units of next Set. Set value should be equal to SINGLE_ASSET_MULTIPLIER * max(Pa1, Pa2).
     *
     * @param  _allocationUnitValue             Amount in component units equal in USD to max(Pa1, Pa2)
     * @param  _decimalMultiplier               Decimal difference between asset and max decimal amount
     * @return uint256[]                        Unit array of nextSet collateral
     */
    function calculateSingleAssetNextSetUnits(
        uint256 _allocationUnitValue,
        uint256 _decimalMultiplier
    )
        internal
        view
        returns (uint256[] memory)
    {
        // Determine whether allocating all to baseAsset or quoteAsset
        uint256[] memory units = new uint256[](1);
        units[0] = calculateUnitAmount(
            _allocationUnitValue,
            SINGLE_ASSET_MULTIPLER,
            _decimalMultiplier
        );

        return units;
    }

    /*
     * Calculate unit amount for one asset in Set. Generalized above for asset 1 (a1):
     * a1DecimalDifference * a1Multiplier * max(Pa2*pricePrecision/Pa1, pricePrecision)
     *
     * Where (max(Pa2*pricePrecision/Pa1, pricePrecision) is represented as _allocationUnitValue
     *
     * Since assetMultiplier is passed as a number with 18 decimals it must be descaled.
     *
     * @param  _allocationUnitValue       Amount in component units equal in USD to max(Pa1, Pa2)
     * @param  _assetMultiplier           Amount of allocationUnitValues to include in allocation
     * @param  _decimalMultiplier         Decimal difference between asset and max decimal amount
     * @return uint256                    Units of asset
     */
    function calculateUnitAmount(
        uint256 _allocationUnitValue,
        uint256 _assetMultiplier,
        uint256 _decimalMultiplier
    )
        internal
        view
        returns (uint256)
    {
        return _decimalMultiplier.mul(_assetMultiplier).mul(_allocationUnitValue).deScale();
    }

    /*
     * Gets oracle addresses from whitelist then calls oracles for current price. Returns in
     * order of baseAsset, quoteAsset.
     *
     * @return AssetPrices             Struct containing base and quote asset prices
     */
    function getAssetPrices()
        internal
        view
        returns(AssetPrices memory)
    {
        // Create token addresses array
        address[] memory tokenAddresses = new address[](2);
        tokenAddresses[0] = address(baseAsset);
        tokenAddresses[1] = address(quoteAsset);

        // Get oracle addresses for each token
        address[] memory oracleAddresses = oracleWhiteList.getOracleAddressesByToken(
            tokenAddresses
        );

        // Get token price from oracles
        return AssetPrices({
            baseAssetPrice: IOracle(oracleAddresses[0]).read(),
            quoteAssetPrice: IOracle(oracleAddresses[1]).read()
        });
    }
}
