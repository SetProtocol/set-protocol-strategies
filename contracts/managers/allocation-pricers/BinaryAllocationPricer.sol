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

import { FlexibleTimingManagerLibrary } from "../lib/FlexibleTimingManagerLibrary.sol";
import { IAllocationPricer } from "./IAllocationPricer.sol";
import { IOracle } from "../../meta-oracles/interfaces/IOracle.sol";


/**
 * @title BinaryAllocationPricer
 * @author Set Protocol
 *
 * Implementing IAllocationPricer the BinaryAllocationPricer flips between two all or nothing
 * allocations of the base asset depending what allocation the calling manager is seeking. In
 * addition, if either collateral Set becomes 4x more valuable than the other the contract will
 * create a new collateral Set and use that Set going forward.
 */
contract BinaryAllocationPricer is
    IAllocationPricer
{
    using SafeMath for uint256;

    /* ============ Events ============ */

    event NewCollateralLogged(
        bytes32 indexed _hashId,
        address _collateralAddress
    );

    /* ============ Constants ============ */
    uint256 constant SET_TOKEN_WHOLE_UNIT = 10 ** 18;
    uint256 constant MINIMUM_COLLATERAL_NATURAL_UNIT_DECIMALS = 6;
    uint256 constant ALLOCATION_PRICE_RATIO_LIMIT = 4;

    /* ============ State Variables ============ */
    ICore public coreInstance;
    address public setTokenFactoryAddress;

    ERC20Detailed public baseAssetInstance;
    ERC20Detailed public quoteAssetInstance;
    IOracle public baseAssetOracleInstance;
    IOracle public quoteAssetOracleInstance;
    // Remember to remove these!!
    ISetToken public baseAssetCollateralInstance;
    ISetToken public quoteAssetCollateralInstance;    
    uint8 public baseAssetDecimals;
    uint8 public quoteAssetDecimals;

    mapping(bytes32 => address) public storedCollateral;

    /*
     * BinaryAllocationPricer constructor.
     *
     * @param  _baseAssetInstance                   The baseAsset address
     * @param  _quoteAssetInstance                  The quoteAsset address
     * @param  _baseAssetOracleInstance             The baseAsset oracle
     * @param  _quoteAssetOracleInstance            The quoteAsset oracle
     * @param  _baseAssetCollateralInstance         The baseAsset collateral Set
     * @param  _quoteAssetCollateralInstance        The quoteAsset collateral Set
     * @param  _coreInstance                        The address of the Core contract
     * @param  _setTokenFactoryAddress              The address of SetTokenFactory used to create
     *                                              new collateral
     */
    constructor(
        ERC20Detailed _baseAssetInstance,
        ERC20Detailed _quoteAssetInstance,
        IOracle _baseAssetOracleInstance,
        IOracle _quoteAssetOracleInstance,
        ISetToken _baseAssetCollateralInstance,
        ISetToken _quoteAssetCollateralInstance,
        ICore _coreInstance,
        address _setTokenFactoryAddress
    )
        public
    {
        // Get components of collateral instances
        address[] memory baseAssetCollateralComponents = _baseAssetCollateralInstance.getComponents();
        address[] memory quoteAssetCollateralComponents = _quoteAssetCollateralInstance.getComponents();

        // Make sure collateral instances are using the correct base and quote asset
        require(
            baseAssetCollateralComponents[0] == address(_baseAssetInstance),
            "BinaryAllocationPricer.constructor: Base collateral component must match base asset."
        );

        require(
            quoteAssetCollateralComponents[0] == address(_quoteAssetInstance),
            "BinaryAllocationPricer.constructor: Quote collateral component must match quote asset."
        );

        baseAssetInstance = _baseAssetInstance;
        quoteAssetInstance = _quoteAssetInstance;

        baseAssetOracleInstance = _baseAssetOracleInstance;
        quoteAssetOracleInstance = _quoteAssetOracleInstance;

        // Query decimals of base and quote assets
        baseAssetDecimals = _baseAssetInstance.decimals();
        quoteAssetDecimals = _quoteAssetInstance.decimals();

        // Set Core and setTokenFactory
        coreInstance = _coreInstance;
        setTokenFactoryAddress = _setTokenFactoryAddress;

        // Store passed in collateral in mapping
        bytes32 baseCollateralHash = calculateCollateralIDHashFromSet(
            _baseAssetCollateralInstance
        );
        bytes32 quoteCollateralHash = calculateCollateralIDHashFromSet(
            _quoteAssetCollateralInstance
        );
        storedCollateral[baseCollateralHash] = address(_baseAssetCollateralInstance);
        storedCollateral[quoteCollateralHash] = address(_quoteAssetCollateralInstance);

        emit NewCollateralLogged(baseCollateralHash, address(_baseAssetCollateralInstance));
        emit NewCollateralLogged(quoteCollateralHash, address(_quoteAssetCollateralInstance));
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
     * @return uint256                          The USD value of current Set
     * @return uint256                          The USD value of next Set
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        uint256 _allocationPrecision,
        ISetToken _currentCollateralSet
    )
        external
        returns (address, uint256, uint256)
    {
        require(
            _targetBaseAssetAllocation == _allocationPrecision || _targetBaseAssetAllocation == 0,
            "BinaryAllocationPricer.validateAllocationParams: Passed allocation must be equal to allocationPrecision or 0."
        );

        // Determine if rebalance is to the baseAsset
        bool toBaseAsset = (_targetBaseAssetAllocation == _allocationPrecision);

        validateCurrentCollateralSet(
            _currentCollateralSet,
            toBaseAsset
        );

        // Create struct that holds relevant information for the currentSet
        uint256 currentSetValue = calculateCollateralSetValue(
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

        address nextSetAddress = createOrSelectNextSet(
            nextSetComponent,
            nextSetUnit,
            nextSetNaturalUnit
        );

        // Calculate dollar value of new collateral
        uint256 nextSetValue = calculateCollateralSetValue(
            nextSetAddress,
            toBaseAsset
        );

        return (nextSetAddress, currentSetValue, nextSetValue);
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
        returns (address)
    {
        // Create collateralIDHash 
        bytes32 collateralIDHash = calculateCollateralIDHash(
            _nextSetUnit,
            _nextSetNaturalUnit,
            address(_nextSetComponent)
        );
        
        // If collateralIDHash exists then use existing collateral set otherwise create new collateral and
        // store in mapping
        if (storedCollateral[collateralIDHash] != address(0)) {
            return storedCollateral[collateralIDHash];
        } else {
            // Determine new collateral name and symbol
            (
                bytes32 nextCollateralName,
                bytes32 nextCollateralSymbol
            ) = _nextSetComponent == baseAssetInstance ? (bytes32("BaseAssetCollateral"), bytes32("BACOL")) :
                (bytes32("QuoteAssetCollateral"), bytes32("QACOL"));

            // Create unit and component arrays for SetToken creation
            uint256[] memory nextSetUnits = new uint256[](1);
            address[] memory nextSetComponents = new address[](1);
            nextSetUnits[0] = _nextSetUnit;
            nextSetComponents[0] = address(_nextSetComponent);

            // Create new collateral set with passed components, units, and naturalUnit
            address nextSetAddress = coreInstance.createSet(
                setTokenFactoryAddress,
                nextSetComponents,
                nextSetUnits,
                _nextSetNaturalUnit,
                nextCollateralName,
                nextCollateralSymbol,
                ""
            );

            // Store new collateral in mapping
            storedCollateral[collateralIDHash] = nextSetAddress;

            emit NewCollateralLogged(collateralIDHash, nextSetAddress);

            return nextSetAddress;
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
            coreInstance.validSets(address(_currentCollateralSet)),
            "BinaryAllocationPricer.validateAllocationParams: Passed collateralSet must be tracked by Core."
        );

        // Get current set components
        address[] memory currentSetComponents = _currentCollateralSet.getComponents();

        // Make sure current set component array is one item long
        require(
            currentSetComponents.length == 1,
            "BinaryAllocationPricer.validateAllocationParams: Passed collateral set must have one component."
        );

        // Make sure that currentSet component is opposite of expected component to be rebalanced into
        address requiredComponent = _toBaseAsset ? address(quoteAssetInstance) : address(baseAssetInstance);
        require(
            currentSetComponents[0] == requiredComponent,
            "BinaryAllocationPricer.validateAllocationParams: New allocation doesn't match currentSet component."
        );
    }

    /*
     * Calculate value of passed collateral set.
     *
     * @param  _currentCollateralSet        Instance of current set collateralizing RebalancingSetToken
     * @param  _usingBaseAsset              Boolean indicating whether collateral set uses base asset
     */
    function calculateCollateralSetValue(
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
        uint256 intermediate = (uint256(10) ** uint256(18 - nextSetComponentDecimals))
            .mul(nextSetComponentPrice)
            .div(_currentSetValue)
            .add(1);

        // Complete kTwo calculation by taking ceil(log10()) of intermediate
        uint256 kTwo = ceilLog10(intermediate);

        // k is max of kOne and kTwo
        uint256 k = Math.max(kOne, kTwo);

        // Get raw unit amount for nextSet
        uint256 unroundedNextUnit = (uint256(10) ** uint256(nextSetComponentDecimals + k - 18))
            .mul(_currentSetValue)
            .div(nextSetComponentPrice);
        
        // Round raw nextSet unit to nearest power of 2
        uint256 nextSetUnit = roundToNearestPowerOfTwo(
            unroundedNextUnit
        );

        // Get nextSetComponent
        ERC20Detailed nextSetComponent = _toBaseAsset ? baseAssetInstance : quoteAssetInstance;  

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
            return (baseAssetOracleInstance.read(), baseAssetDecimals);
        } else {
            return (quoteAssetOracleInstance.read(), quoteAssetDecimals);
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
     * Rounds passed value to the nearest power of 2. 
     *
     * @param  _value         Value to be rounded to nearest power of 2
     * @return uint256        Rounded value
     */
    function roundToNearestPowerOfTwo(
        uint256 _value
    )
        internal
        pure
        returns (uint256)
    {
        // Make sure passed value is greater than 0
        require (
            _value > 0,
            "BinaryAllocationPricer.roundToNearestPowerOfTwo: Value must be greater than zero."
        );

        // Multiply by 1.5 to roughly approximate sqrt(2). Needed to round to nearest power of two. 
        uint256 scaledValue = _value.mul(3).div(2);
        uint256 power = 0;

        // Calculate nearest power of two
        if (scaledValue >= 0x100000000000000000000000000000000) { scaledValue >>= 128; power += 128; }
        if (scaledValue >= 0x10000000000000000) { scaledValue >>= 64; power += 64; }
        if (scaledValue >= 0x100000000) { scaledValue >>= 32; power += 32; }
        if (scaledValue >= 0x10000) { scaledValue >>= 16; power += 16; }
        if (scaledValue >= 0x100) { scaledValue >>= 8; power += 8; }
        if (scaledValue >= 0x10) { scaledValue >>= 4; power += 4; }
        if (scaledValue >= 0x4) { scaledValue >>= 2; power += 2; }
        if (scaledValue >= 0x2) power += 1; // No need to shift x anymore

        return 2 ** power;
    }

    /*
     * Gets the rounded up log10 of passed value
     *
     * @param  _value         Value to calculate ceil(log()) on
     * @return uint256        Output value
     */
    function ceilLog10(
        uint256 _value
    )
        public
        pure 
        returns (uint256)
    {
        // Make sure passed value is greater than 0
        require (
            _value > 0,
            "BinaryAllocationPricer.ceilLog10: Value must be greater than zero."
        );

        // Since log10(1) = 0, if _value = 1 return 0
        if (_value == 1) return 0;

        // Calcualte ceil(log10())
        uint256 x = _value - 1;

        uint256 result = 0;

        if (x >= 10000000000000000000000000000000000000000000000000000000000000000) {
            x /= 10000000000000000000000000000000000000000000000000000000000000000;
            result += 64;
        }
        if (x >= 100000000000000000000000000000000) {
            x /= 100000000000000000000000000000000;
            result += 32;
        }
        if (x >= 10000000000000000) {
            x /= 10000000000000000;
            result += 16;
        }
        if (x >= 100000000) {
            x /= 100000000;
            result += 8;
        }
        if (x >= 10000) {
            x /= 10000;
            result += 4;
        }
        if (x >= 100) {
            x /= 100;
            result += 2;
        }
        if (x >= 10) {
            x /= 10;
            result += 1;
        }

        return result + 1;
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
}