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
import { IAllocator } from "./IAllocator.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";


/**
 * @title WeightedAllocator
 * @author Set Protocol
 *
 * Implementing IAllocator the WeightedAllocator creates new SetTokens that represent a mix of two
 * assets. 
 */
contract WeightedAllocator is
    IAllocator
{
    using SafeMath for uint256;

    /* ============ Events ============ */

    event NewCollateralTracked(
        bytes32 indexed _hash,
        address indexed _collateralAddress
    );

    /* ============ Constants ============ */
    uint256 constant public PRICE_PRECISION = 100;

    /* ============ State Variables ============ */
    ICore public core;
    address public setTokenFactory;

    ERC20Detailed public baseAsset;
    ERC20Detailed public quoteAsset;
    IOracle public baseAssetOracle;
    IOracle public quoteAssetOracle;  
    uint8 public baseAssetDecimals;
    uint8 public quoteAssetDecimals;

    uint256 public collateralNaturalUnit;
    address[] public nextSetComponents;
    uint256 public baseAssetDecimalDifference;
    uint256 public quoteAssetDecimalDifference;

    /*
     * WeightedAllocator constructor.
     *
     * @param  _baseAsset                   The baseAsset address
     * @param  _quoteAsset                  The quoteAsset address
     * @param  _baseAssetOracle             The baseAsset oracle
     * @param  _quoteAssetOracle            The quoteAsset oracle
     * @param  _core                        The address of the Core contract
     * @param  _setTokenFactory             The address of SetTokenFactory used to create new collateral
     */
    constructor(
        ERC20Detailed _baseAsset,
        ERC20Detailed _quoteAsset,
        IOracle _baseAssetOracle,
        IOracle _quoteAssetOracle,
        ICore _core,
        address _setTokenFactory
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

        // Set Core and setTokenFactory
        core = _core;
        setTokenFactory = _setTokenFactory;

        // Calculate constants that will be used in calculations
        uint256 minDecimals = Math.min(baseAssetDecimals, quoteAssetDecimals);

        collateralNaturalUnit = CommonMath.safePower(10, uint256(18).sub(minDecimals))
            .mul(PRICE_PRECISION);

        baseAssetDecimalDifference = CommonMath.safePower(10, uint256(baseAssetDecimals).sub(minDecimals));
        quoteAssetDecimalDifference = CommonMath.safePower(10, uint256(quoteAssetDecimals).sub(minDecimals));

        nextSetComponents = [address(baseAsset), address(quoteAsset)];
    }

    /* ============ External ============ */

    /*
     * Determine the next allocation to rebalance into. Set new collateral to value of old collateral.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _allocationPrecision             Precision of allocation percentage
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @return address                          The address of the proposed nextSet
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision,
        ISetToken _currentCollateralSet
    )
        external
        returns (ISetToken)
    {
        // Determine nextSet units
        uint256[] memory nextSetUnits = calculateNextSetParameters(
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

        (
            uint256[] memory componentPrices,
            uint256[] memory componentDecimals
        ) = fetchComponentsPriceAndDecimal(setDetails.components);

        return FlexibleTimingManagerLibrary.calculateSetTokenDollarValue(
            componentPrices,
            setDetails.naturalUnit,
            setDetails.units,
            componentDecimals
        );
    }

    function calculateNextSetParameters(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision
    )
        internal
        view
        returns (uint256[] memory)
    {
        uint256 quoteAssetAllocation = _allocationPrecision.sub(_targetBaseAssetAllocation);
        uint256 baseAssetMultiplier = 1;
        uint256 quoteAssetMultiplier = 1;
        if (_targetBaseAssetAllocation > quoteAssetAllocation) {
            baseAssetMultiplier = _targetBaseAssetAllocation.div(quoteAssetAllocation);
        } else {
            quoteAssetMultiplier = quoteAssetAllocation.div(_targetBaseAssetAllocation);
        }

        uint256 baseAssetPrice = baseAssetOracle.read();
        uint256 quoteAssetPrice = quoteAssetOracle.read();

        uint256[] memory units = new uint256[](2);
        // Get baseAsset units
        units[0] = baseAssetDecimalDifference.mul(baseAssetMultiplier).mul(
            Math.max(quoteAssetPrice.mul(PRICE_PRECISION).div(baseAssetPrice), PRICE_PRECISION)
        );

        // Get quote asset units
        units[1] = quoteAssetDecimalDifference.mul(quoteAssetMultiplier).mul(
            Math.max(baseAssetPrice.mul(PRICE_PRECISION).div(quoteAssetPrice), PRICE_PRECISION)
        );

        return units;
    }

    function fetchComponentsPriceAndDecimal(
        address[] memory componentArray
    )
        internal
        view
        returns (uint256[] memory, uint256[] memory)
    {
        uint256[] memory componentPrices = new uint256[](componentArray.length);
        uint256[] memory componentDecimals = new uint256[](componentArray.length);

        if (componentArray[0] == address(baseAsset)) {
            componentPrices[0] = baseAssetOracle.read();
            componentPrices[1] = quoteAssetOracle.read();
            componentDecimals[0] = baseAssetDecimals;
            componentDecimals[1] = quoteAssetDecimals; 
        } else {
            componentPrices[0] = quoteAssetOracle.read();
            componentPrices[1] = baseAssetOracle.read();
            componentDecimals[0] = quoteAssetDecimals;
            componentDecimals[1] = baseAssetDecimals;            
        }

        return (componentPrices, componentDecimals);
    }
}