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
 * @title BinaryAllocator
 * @author Set Protocol
 *
 * Implementing IAllocator the BinaryAllocator flips between two all or nothing
 * allocations of the base asset depending what allocation the calling manager is seeking. In
 * addition, if either collateral Set becomes 4x more valuable than the other the contract will
 * create a new collateral Set and use that Set going forward.
 */
contract BinaryAllocator is
    IAllocator
{
    using SafeMath for uint256;

    /* ============ Events ============ */

    event NewCollateralTracked(
        bytes32 indexed _hash,
        address indexed _collateralAddress
    );

    /* ============ Constants ============ */
    uint256 constant public MINIMUM_COLLATERAL_NATURAL_UNIT_DECIMALS = 6;

    /* ============ State Variables ============ */
    ICore public core;
    address public setTokenFactory;

    ERC20Detailed public baseAsset;
    ERC20Detailed public quoteAsset;
    IOracle public baseAssetOracle;
    IOracle public quoteAssetOracle;  
    uint8 public baseAssetDecimals;
    uint8 public quoteAssetDecimals;

    // Hash of collateral units, naturalUnit, and component maps to collateral address
    mapping(bytes32 => ISetToken) public storedCollateral;

    /*
     * BinaryAllocator constructor.
     *
     * @param  _baseAsset                   The baseAsset address
     * @param  _quoteAsset                  The quoteAsset address
     * @param  _baseAssetOracle             The baseAsset oracle
     * @param  _quoteAssetOracle            The quoteAsset oracle
     * @param  _baseAssetCollateral         The baseAsset collateral Set
     * @param  _quoteAssetCollateral        The quoteAsset collateral Set
     * @param  _core                        The address of the Core contract
     * @param  _setTokenFactory             The address of SetTokenFactory used to create new collateral
     */
    constructor(
        ERC20Detailed _baseAsset,
        ERC20Detailed _quoteAsset,
        IOracle _baseAssetOracle,
        IOracle _quoteAssetOracle,
        ISetToken _baseAssetCollateral,
        ISetToken _quoteAssetCollateral,
        ICore _core,
        address _setTokenFactory
    )
        public
    {
        // Get components of collateral instances
        address[] memory baseAssetCollateralComponents = _baseAssetCollateral.getComponents();
        address[] memory quoteAssetCollateralComponents = _quoteAssetCollateral.getComponents();

        // Check that component arrays only have one component
        componentArrayContainsOneComponent(baseAssetCollateralComponents);
        componentArrayContainsOneComponent(quoteAssetCollateralComponents);

        // Make sure collateral instances are using the correct base and quote asset
        require(
            baseAssetCollateralComponents[0] == address(_baseAsset),
            "BinaryAllocator.constructor: Base collateral component must match base asset."
        );

        require(
            quoteAssetCollateralComponents[0] == address(_quoteAsset),
            "BinaryAllocator.constructor: Quote collateral component must match quote asset."
        );

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

        // Store passed in collateral in mapping
        bytes32 baseCollateralHash = calculateCollateralIDHashFromSet(
            _baseAssetCollateral
        );
        bytes32 quoteCollateralHash = calculateCollateralIDHashFromSet(
            _quoteAssetCollateral
        );
        storedCollateral[baseCollateralHash] = _baseAssetCollateral;
        storedCollateral[quoteCollateralHash] = _quoteAssetCollateral;

        emit NewCollateralTracked(baseCollateralHash, address(_baseAssetCollateral));
        emit NewCollateralTracked(quoteCollateralHash, address(_quoteAssetCollateral));
    }

    /* ============ External ============ */

    /*
     * Determine the next allocation to rebalance into. If the dollar value of the two collateral sets is more
     * than 4x different from each other then create a new collateral set. If currently 100% in baseAsset then
     * a new quote collateral set is created if 0% in baseAsset then a new base collateral set is created.
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
        require(
            _targetBaseAssetAllocation == _allocationPrecision || _targetBaseAssetAllocation == 0,
            "BinaryAllocator.determineNewAllocation: Passed allocation must be equal to allocationPrecision or 0."
        );

        // Determine if rebalance is to the baseAsset
        bool toBaseAsset = (_targetBaseAssetAllocation == _allocationPrecision);

        validateCurrentCollateralSet(
            _currentCollateralSet,
            toBaseAsset
        );

        // Calculate currentSetValue, toBaseAsset inverted here because calculating currentSet value which would be
        // using opposite collateral asset of toBaseAsset
        uint256 currentSetValue = calculateCollateralSetValueInternal(
            address(_currentCollateralSet),
            !toBaseAsset
        );

        // Check to see if new collateral must be created in order to keep collateral price ratio in line.
        // If not just return the dollar value of current collateral sets
        (
            ERC20Detailed nextSetComponent,
            uint256 nextSetUnit,
            uint256 nextSetNaturalUnit
        ) = calculateNextCollateralParameters(
            currentSetValue,
            toBaseAsset
        );

        ISetToken nextSet = createOrSelectNextSet(
            nextSetComponent,
            nextSetUnit,
            nextSetNaturalUnit
        );

        return nextSet;
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
        address[] memory setComponents = _collateralSet.getComponents();

        // Check that setComponents only has one component
        componentArrayContainsOneComponent(setComponents);

        return calculateCollateralSetValueInternal(
            address(_collateralSet),
            setComponents[0] == address(baseAsset)
        );
    }

    /* ============ Internal ============ */

    /*
     * Create CollateralIDHash based on nextSet parameters. If hash already exists then use collateral
     * set associated with that hash. If hash does not already exist then create new collateral set and
     * store in storedCollateral mapping.
     *
     * @param  _nextSetComponent        Component of nextSet
     * @param  _nextSetUnit             Unit of nextSet
     * @param  _nextSetNaturalUnit      NaturalUnit of nextSet
     * @return address                  Address of nextSet
     */
    function createOrSelectNextSet(
        ERC20Detailed _nextSetComponent,
        uint256 _nextSetUnit,
        uint256 _nextSetNaturalUnit
    )
        internal
        returns (ISetToken)
    {
        // Create collateralIDHash 
        bytes32 collateralIDHash = calculateCollateralIDHash(
            _nextSetUnit,
            _nextSetNaturalUnit,
            address(_nextSetComponent)
        );
        
        // If collateralIDHash exists then use existing collateral set otherwise create new collateral and
        // store in mapping
        if (address(storedCollateral[collateralIDHash]) != address(0)) {
            return storedCollateral[collateralIDHash];
        } else {
            // Determine new collateral name and symbol
            (
                bytes32 nextCollateralName,
                bytes32 nextCollateralSymbol
            ) = _nextSetComponent == baseAsset ? (bytes32("BaseAssetCollateral"), bytes32("BACOL")) :
                (bytes32("QuoteAssetCollateral"), bytes32("QACOL"));

            // Create unit and component arrays for SetToken creation
            uint256[] memory nextSetUnits = new uint256[](1);
            address[] memory nextSetComponents = new address[](1);
            nextSetUnits[0] = _nextSetUnit;
            nextSetComponents[0] = address(_nextSetComponent);

            // Create new collateral set with passed components, units, and naturalUnit
            address nextSetAddress = core.createSet(
                setTokenFactory,
                nextSetComponents,
                nextSetUnits,
                _nextSetNaturalUnit,
                nextCollateralName,
                nextCollateralSymbol,
                ""
            );

            // Store new collateral in mapping
            storedCollateral[collateralIDHash] = ISetToken(nextSetAddress);

            emit NewCollateralTracked(collateralIDHash, nextSetAddress);

            return ISetToken(nextSetAddress);
        }
    }

    /*
     * Validate passed parameters to make sure target allocation is either 0 or 100 and that the currentSet
     * was created by core and is made up of the correct component. Finally, return a boolean indicating
     * whether new allocation should be in baseAsset.
     *
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @param  _toBaseAsset                     Boolean indicating whether new collateral is made of baseAsset
     */
    function validateCurrentCollateralSet(
        ISetToken _currentCollateralSet,
        bool _toBaseAsset    
    )
        internal
        view
    {
        // Make sure passed currentSet was created by Core
        require(
            core.validSets(address(_currentCollateralSet)),
            "BinaryAllocator.validateCurrentCollateralSet: Passed collateralSet must be tracked by Core."
        );

        // Get current set components
        address[] memory currentSetComponents = _currentCollateralSet.getComponents();

        // Make sure current set component array is one item long
        require(
            currentSetComponents.length == 1,
            "BinaryAllocator.validateCurrentCollateralSet: Passed collateral set must have one component."
        );

        // Make sure that currentSet component is opposite of expected component to be rebalanced into
        address requiredComponent = _toBaseAsset ? address(quoteAsset) : address(baseAsset);
        require(
            currentSetComponents[0] == requiredComponent,
            "BinaryAllocator.validateCurrentCollateralSet: New allocation doesn't match currentSet component."
        );
    }

    /*
     * Calculate value of passed collateral set.
     *
     * @param  _currentCollateralSet        Instance of current set collateralizing RebalancingSetToken
     * @param  _usingBaseAsset              Boolean indicating whether collateral set uses base asset
     * @return uint256                      USD value of passed Set
     */
    function calculateCollateralSetValueInternal(
        address _collateralSet,
        bool _usingBaseAsset
    )
        internal
        view
        returns (uint256)
    {
        // Gather price and decimal information for current collateral component
        (
            uint256 currentComponentPrice,
            uint256 currentComponentDecimals
        ) = getComponentPriceAndDecimalData(_usingBaseAsset);

        // Get currentSet Details and use to value passed currentSet
        SetTokenLibrary.SetDetails memory currentSetDetails = SetTokenLibrary.getSetDetails(
            address(_collateralSet)
        );

        // Calculate collateral set value
        return FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            currentComponentPrice,
            currentSetDetails.naturalUnit,
            currentSetDetails.units[0],
            currentComponentDecimals
        );       
    }

    /*
     * Calculate new collateral units and natural unit. Return new component address The system of
     * equations to determine unit and naturalUnit is as follows:
     *
     * naturalUnit = 10 ** k
     * unit = log2(round(10^(d + k - 18) * V / P))
     * k = max(6, log10(10^(18 - d) * P / V), 18-d)
     *
     * Where d is the decimals of the new component, P is the price of the new component, and V is the
     * target value of the new Set.
     *
     * Implementation for k will be split as such,
     * kOne = max(6, 18-d)
     * kTwo = log10(10^(18 - d) * P / V)
     * k = max(kOne, kTwo)
     *
     * @param  _targetCollateralUSDValue      USD Value of current collateral set
     * @param  _newComponentPrice             Price of underlying token to be rebalanced into
     * @param  _newComponentDecimals          Amount of decimals in replacement token
     * @return ERCDetailed                    Instance of new collateral component
     * @return uint256                        Units for new collateral set
     * @return uint256                        NaturalUnit for new collateral set
     */
    function calculateNextCollateralParameters(
        uint256 _currentSetValue,
        bool _toBaseAsset
    )
        internal
        view
        returns (ERC20Detailed, uint256, uint256)
    {
        // Gather price and decimal information for next collateral components
        (
            uint256 nextSetComponentPrice,
            uint8 nextSetComponentDecimals
        ) = getComponentPriceAndDecimalData(_toBaseAsset);

        // Determine minimum natural unit based on max of pre-defined minimum or (18 - decimals) of the 
        // component in the new Set.
        uint256 kOne = Math.max(
            MINIMUM_COLLATERAL_NATURAL_UNIT_DECIMALS,
            uint256(18).sub(nextSetComponentDecimals)
        );

        // Intermediate step to calculate kTwo
        uint256 intermediate = AllocatorMathLibrary.roundUpDivision(
            CommonMath.safePower(uint256(10), uint256(18).sub(nextSetComponentDecimals)).mul(nextSetComponentPrice),
            _currentSetValue
        );

        // Complete kTwo calculation by taking ceil(log10()) of intermediate
        uint256 kTwo = AllocatorMathLibrary.ceilLog10(intermediate);

        // k is max of kOne and kTwo
        uint256 k = Math.max(kOne, kTwo);

        // Get raw unit amount for nextSet
        uint256 unroundedNextUnit = (uint256(10) ** uint256(nextSetComponentDecimals + k - 18))
            .mul(_currentSetValue)
            .div(nextSetComponentPrice);
        
        // Round raw nextSet unit to nearest power of 2
        uint256 nextSetUnit = AllocatorMathLibrary.roundToNearestPowerOfTwo(
            unroundedNextUnit
        );

        // Get nextSetComponent
        ERC20Detailed nextSetComponent = _toBaseAsset ? baseAsset : quoteAsset;  

        return (nextSetComponent, nextSetUnit, CommonMath.safePower(10, k));
    }

    /*
     * Gets price and decimal information for component based on if looking for base or quote asset data
     *
     * @param  _usingBaseAsset         Boolean indicating whether to get information for base asset
     * @return uint256                 USD Price of component
     * @return uint8                   Decimal of component
     */
    function getComponentPriceAndDecimalData(
        bool _usingBaseAsset
    )
        internal
        view
        returns (uint256, uint8)
    {
        // If using base asset return baseAsset price and decimals and vice versa
        if (_usingBaseAsset) {
            return (baseAssetOracle.read(), baseAssetDecimals);
        } else {
            return (quoteAssetOracle.read(), quoteAssetDecimals);
        }        
    }

    /*
     * Creates a CollateralIDHash from a passed SetToken instance. 
     *
     * @param  _setToken         SetToken to make CollateralIDHash of
     * @return bytes32           CollateralIDHash of SetToken
     */
    function calculateCollateralIDHashFromSet(
        ISetToken _setToken
    )
        internal
        view
        returns (bytes32)
    {
        // Get SetToken details for use in calculating collateralIDHash
        SetTokenLibrary.SetDetails memory setDetails = SetTokenLibrary.getSetDetails(
            address(_setToken)
        );

        // Calculate CollateralIDHash
        return calculateCollateralIDHash(
            setDetails.units[0],
            setDetails.naturalUnit,
            setDetails.components[0]
        );
    }

    /*
     * Creates a CollateralIDHash from passed SetToken parameters. 
     *
     * @param  _units           Units of SetToken
     * @param  _naturalUnit     NaturalUnit of SetToken
     * @param  _component       Component of SetToken
     * @return bytes32          CollateralIDHash of SetToken
     */
    function calculateCollateralIDHash(
        uint256 _units,
        uint256 _naturalUnit,
        address _component
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                _units,
                _naturalUnit,
                _component
            )
        );
    }

    /*
     * Check that passed component array contains one component, else revert.
     *
     * @param  _array     Array to be evaluated
     */
    function componentArrayContainsOneComponent(
        address[] memory _array
    )
        internal
        pure
    {
        require(
            _array.length == 1,
            "BinaryAllocator.componentArrayContainsOneComponent: Array contains more than one component."
        );
    }
}