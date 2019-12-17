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
import { CommonMath } from "set-protocol-contracts/contracts/lib/CommonMath.sol";
import { ICore } from "set-protocol-contracts/contracts/core/interfaces/ICore.sol";
import { ISetToken } from "set-protocol-contracts/contracts/core/interfaces/ISetToken.sol";
import { SetTokenLibrary } from "set-protocol-contracts/contracts/core/lib/SetTokenLibrary.sol";

import { AllocatorMathLibrary } from "../lib/AllocatorMathLibrary.sol";
import { FlexibleTimingManagerLibrary } from "../lib/FlexibleTimingManagerLibrary.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";
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

    /* ============ Events ============ */

    event NewCollateralTracked(
        bytes32 indexed _hash,
        address indexed _collateralAddress
    );

    /* ============ Constants ============ */
    uint256 constant private ONE = 1;
    uint256 constant public SINGLE_ASSET_MULTIPLER = 4 * 10 ** 18;

    /* ============ State Variables ============ */
    ICore public core;
    address public setTokenFactory;

    ERC20Detailed public baseAsset;
    ERC20Detailed public quoteAsset;
    IOracle public baseAssetOracle;
    IOracle public quoteAssetOracle;  
    uint8 public baseAssetDecimals;
    uint8 public quoteAssetDecimals;

    uint256 public pricePrecision;
    uint256 public collateralNaturalUnit;
    address[] public multiAssetNextSetComponents;
    address[] public baseAssetNextSetComponents;
    address[] public quoteAssetNextSetComponents;
    uint256 public baseAssetDecimalDifference;
    uint256 public quoteAssetDecimalDifference;

    /*
     * SocialAllocator constructor.
     *
     * @param  _baseAsset                   The baseAsset address
     * @param  _quoteAsset                  The quoteAsset address
     * @param  _baseAssetOracle             The baseAsset oracle
     * @param  _quoteAssetOracle            The quoteAsset oracle
     * @param  _core                        The address of the Core contract
     * @param  _setTokenFactory             The address of SetTokenFactory used to create new collateral
     * @param  _pricePrecision              Amount of significant figures kept in determining new units
     */
    constructor(
        ERC20Detailed _baseAsset,
        ERC20Detailed _quoteAsset,
        IOracle _baseAssetOracle,
        IOracle _quoteAssetOracle,
        ICore _core,
        address _setTokenFactory,
        uint256 _pricePrecision
    )
        public
    {
        baseAsset = _baseAsset;
        quoteAsset = _quoteAsset;

        baseAssetOracle = _baseAssetOracle;
        quoteAssetOracle = _quoteAssetOracle;

        // Query decimals of base and quote assets
        baseAssetDecimals = _baseAsset.decimals();
        quoteAssetDecimals = _quoteAsset.decimals();

        core = _core;
        setTokenFactory = _setTokenFactory;
        pricePrecision = _pricePrecision;

        // Calculate constants that will be used in calculations
        uint256 minDecimals = Math.min(baseAssetDecimals, quoteAssetDecimals);

        // Decimal difference for asset a1 is 10 ** (a1Decimals - min(a1Decimals, a2Decimals))
        baseAssetDecimalDifference = CommonMath.safePower(10, uint256(baseAssetDecimals).sub(minDecimals));
        quoteAssetDecimalDifference = CommonMath.safePower(10, uint256(quoteAssetDecimals).sub(minDecimals));

        // NaturalUnit is equal to max(a1DecimalDifference, a2DecimalDifference) * pricePrecision
        collateralNaturalUnit = Math.max(baseAssetDecimalDifference, quoteAssetDecimalDifference)
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
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _allocationPrecision             Precision of allocation percentage
     * @return ISetToken                        The address of the proposed nextSet
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision
    )
        external
        returns (ISetToken)
    {
        // Determine nextSet units and components
        (
            uint256[] memory nextSetUnits,
            address[] memory nextSetComponents
        )= calculateNextSetParameters(
            _targetBaseAssetAllocation,
            _allocationPrecision
        );

        // Create new collateral set with passed components, units, and collateralNaturalUnit
        address nextSetAddress = core.createSet(
            setTokenFactory,
            nextSetComponents,
            nextSetUnits,
            collateralNaturalUnit,
            "",
            "",
            ""
        );

        return ISetToken(nextSetAddress);
    }

    /*
     * Calculate value of passed collateral set.
     *
     * @param  _collateralSet         of current set collateralizing RebalancingSetToken
     * @return uint256               USD value of passed Set
     */
    function calculateCollateralSetValue(
        ISetToken _collateralSet
    )
        external
        view
        returns (uint256)
    {
        return calculateCollateralSetValueInternal(
            address(_collateralSet)
        );
    }

    /* ============ Internal ============ */

    /*
     * Calculate value of passed collateral set.
     *
     * @param  _currentCollateralSet        Instance of current set collateralizing RebalancingSetToken
     * @return uint256                      USD value of passed Set
     */
    function calculateCollateralSetValueInternal(
        address _collateralSet
    )
        internal
        view
        returns (uint256)
    {
        // Get SetToken details for use in calculating collateralIDHash
        SetTokenLibrary.SetDetails memory setDetails = SetTokenLibrary.getSetDetails(
            address(_collateralSet)
        );

        // Get components prices and decimals
        (
            uint256[] memory componentPrices,
            uint256[] memory componentDecimals
        ) = fetchComponentsPriceAndDecimal(setDetails.components);

        // Calculate and return Set value
        return FlexibleTimingManagerLibrary.calculateSetTokenDollarValue(
            componentPrices,
            setDetails.naturalUnit,
            setDetails.units,
            componentDecimals
        );
    }

    /*
     * Determine units and component array of nextSet. Direct to correct calculating function
     * based on if allocation is mix of assets or single asset.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _allocationPrecision             Precision of allocation percentage
     * @return ISetToken                        The address of the proposed nextSet
     */
    function calculateNextSetParameters(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision
    )
        internal
        view
        returns (uint256[] memory, address[] memory)
    {
        if (_targetBaseAssetAllocation == 0 || _targetBaseAssetAllocation == _allocationPrecision) {
            return calculateSingleAssetNextSetUnits(_targetBaseAssetAllocation, _allocationPrecision);
        }

        return calculateMultiAssetNextSetUnits(_targetBaseAssetAllocation, _allocationPrecision);
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
     * @param  _allocationPrecision             Precision of allocation percentage
     * @return uint256[]                        Unit array of nextSet collateral
     * @return address[]                        Component array of nextSet collateral
     */
    function calculateMultiAssetNextSetUnits(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision
    )
        internal
        view
        returns (uint256[] memory, address[] memory)
    {
        // Get quote asset allocation
        uint256 quoteAssetAllocation = _allocationPrecision.sub(_targetBaseAssetAllocation);

        // Calculate multiplier for quote and base asset. Multiplier is just the amount of highest
        // allocation divided by lowest allocation. Asset that has lowest allocation will have
        // multiplier set to 1.
        uint256 baseAssetMultiplier = Math.max(_targetBaseAssetAllocation.scale().div(quoteAssetAllocation), ONE.scale());
        uint256 quoteAssetMultiplier = Math.max(quoteAssetAllocation.scale().div(_targetBaseAssetAllocation), ONE.scale());

        // Get prices
        uint256 baseAssetPrice = baseAssetOracle.read();
        uint256 quoteAssetPrice = quoteAssetOracle.read();

        uint256[] memory units = new uint256[](2);
        // Get baseAsset units
        units[0] = calculateUnitAmount(
            Math.max(quoteAssetPrice.mul(pricePrecision).div(baseAssetPrice), pricePrecision),
            baseAssetMultiplier,
            baseAssetDecimalDifference
        );

        // Get quote asset units
        units[1] = calculateUnitAmount(
            Math.max(baseAssetPrice.mul(pricePrecision).div(quoteAssetPrice), pricePrecision),
            quoteAssetMultiplier,
            quoteAssetDecimalDifference
        );

        return (units, multiAssetNextSetComponents);
    }

    /*
     * Calculate units of next Set. Determine which asset to rebalance into and then calculate unit
     * amount. Set value should be equal to SINGLE_ASSET_MULTIPLIER * max(Pa1, Pa2).
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _allocationPrecision             Precision of allocation percentage
     * @return uint256[]                        Unit array of nextSet collateral
     * @return address[]                        Component array of nextSet collateral
     */
    function calculateSingleAssetNextSetUnits(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision
    )
        internal
        view
        returns (uint256[] memory, address[] memory)
    {
        // Get prices
        uint256 baseAssetPrice = baseAssetOracle.read();
        uint256 quoteAssetPrice = quoteAssetOracle.read();

        // Determine whether allocating all to baseAsset or quoteAsset
        uint256[] memory units = new uint256[](1);
        if (_targetBaseAssetAllocation == _allocationPrecision) {
            units[0] = calculateUnitAmount(
                Math.max(quoteAssetPrice.mul(pricePrecision).div(baseAssetPrice), pricePrecision),
                SINGLE_ASSET_MULTIPLER,
                baseAssetDecimalDifference
            );

            return (units, baseAssetNextSetComponents);
        } else {
            units[0] = calculateUnitAmount(
                Math.max(baseAssetPrice.mul(pricePrecision).div(quoteAssetPrice), pricePrecision),
                SINGLE_ASSET_MULTIPLER,
                quoteAssetDecimalDifference
            );

            return (units, quoteAssetNextSetComponents);
        }

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
     * @param  _decimalDifference         Decimal difference between asset and max decimal amount
     * @return uint256                    Units of asset
     */
    function calculateUnitAmount(
        uint256 _allocationUnitValue,
        uint256 _assetMultiplier,
        uint256 _decimalDifference
    )
        internal
        view
        returns (uint256)
    {
        return _decimalDifference.mul(_assetMultiplier).mul(_allocationUnitValue).deScale();
    }

    /*
     * Get prices and decimals information for passed two component array. Arrays returned will be in
     * order of components passed.
     *
     * @param  _componentArray        Array of component addresses to get price and decimal info
     * @return uint256[]              Price of components
     * @return uint256[]              Decimals of components
     */
    function fetchComponentsPriceAndDecimal(
        address[] memory _componentArray
    )
        internal
        view
        returns (uint256[] memory, uint256[] memory)
    {
        uint256[] memory componentPrices = new uint256[](_componentArray.length);
        uint256[] memory componentDecimals = new uint256[](_componentArray.length);

        for (uint256 i = 0; i < _componentArray.length; i++) {
            // Create price and decimal arrays, order is based on which component is passed first
            if (_componentArray[i] == address(baseAsset)) {
                componentPrices[i] = baseAssetOracle.read();
                componentDecimals[i] = baseAssetDecimals; 
            } else {
                componentPrices[i] = quoteAssetOracle.read();
                componentDecimals[i] = quoteAssetDecimals;        
            }
        }

        return (componentPrices, componentDecimals);
    }
}