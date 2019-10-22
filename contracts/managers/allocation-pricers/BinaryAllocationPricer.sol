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
    uint256 constant MINIMUM_COLLATERAL_NATURAL_UNIT = 10 ** 6;
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
            "MACOStrategyManager.constructor: Base collateral component must match base asset."
        );

        require(
            quoteAssetCollateralComponents[0] == address(_quoteAssetInstance),
            "MACOStrategyManager.constructor: Quote collateral component must match quote asset."
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
        bytes32 baseCollateralHash = createCollateralIDHashFromSet(
            _baseAssetCollateralInstance
        );
        bytes32 quoteCollateralHash = createCollateralIDHashFromSet(
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
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @return address                          The address of the proposed nextSet
     * @return uint256                          The USD value of current Set
     * @return uint256                          The USD value of next Set
     */
    function determineNewAllocation(
        uint256 _targetBaseAssetAllocation,
        ISetToken _currentCollateralSet
    )
        external
        returns (address, uint256, uint256)
    {
        require(
            _targetBaseAssetAllocation == 100 || _targetBaseAssetAllocation == 0,
            "BinaryAllocationPricer.validateAllocationParams: Passed allocation must be 100 or 0."
        );

        // Determine if rebalance is to the baseAsset
        bool toBaseAsset = (_targetBaseAssetAllocation == 100);

        validateAllocationParams(
            _currentCollateralSet,
            toBaseAsset
        );

        // Create struct that holds relevant information for the currentSet
        uint256 currentSetValue = calculateCurrentCollateralSetValue(
            toBaseAsset,
            _currentCollateralSet
        );

        // Check to see if new collateral must be created in order to keep collateral price ratio in line.
        // If not just return the dollar value of current collateral sets
        (
            address nextSetAddress,
            uint256 nextSetValue
        ) = determineNextCollateralParameters(
            currentSetValue,
            toBaseAsset
        );

        return (nextSetAddress, currentSetValue, nextSetValue);
    }

    /* ============ Internal ============ */

    /*
     * Validate passed parameters to make sure target allocation is either 0 or 100 and that the currentSet
     * was created by core and is made up of the correct component. Finally, return a boolean indicating
     * whether new allocation should be in baseAsset.
     *
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @param  _toBaseAsset                     Boolean indicating whether new collateral is made of baseAsset
     */
    function validateAllocationParams(
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
     * Create structs of current and potential next Set containing a reference to the instance of the Set and
     * relevant value, component price, and component decimal information.
     *
     * @param  _toBaseAsset                 Boolean indicating whether new collateral is made of baseAsset
     * @param  _currentCollateralSet        Instance of current set collateralizing RebalancingSetToken
     */
    function calculateCurrentCollateralSetValue(
        bool _toBaseAsset,
        ISetToken _currentCollateralSet
    )
        internal
        view
        returns (uint256)
    {
        // Gather price and decimal information for current collateral components
        uint256 currentComponentPrice;
        uint256 currentComponentDecimals;
        if (_toBaseAsset) {
            currentComponentPrice = quoteAssetOracleInstance.read();
            currentComponentDecimals = quoteAssetDecimals;
        } else {
            currentComponentPrice = baseAssetOracleInstance.read();
            currentComponentDecimals = baseAssetDecimals;
        }

        // Get currentSet Details and use to value passed currentSet
        SetTokenLibrary.SetDetails memory currentSetDetails = SetTokenLibrary.getSetDetails(
            address(_currentCollateralSet)
        );
        return FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            currentComponentPrice,
            currentSetDetails.naturalUnit,
            currentSetDetails.units[0],
            currentComponentDecimals
        );       
    }

    /*
     * Create new collateral Set for the occasion where the dollar value of the two collateral 
     * sets is more than 4x different from each other. The new collateral set address is then
     * assigned to the correct state variable (baseAsset or quoteAsset collateral) 
     *
     * @param  _currentSetInfo          Component, price, and adress information of current Set
     * @param  _nextSetInfo             Component, price, and adress information of (potential) next Set
     * @param  _toBaseAsset             Boolean indicating whether new collateral is made of baseAsset
     * @return address                  Address of the nextSet
     * @return uint256                  The USD value of currentSet
     * @return uint256                  The USD value of nextSet
     */
    function determineNextCollateralParameters(
        uint256 _currentSetValue,
        bool _toBaseAsset
    )
        internal
        returns (address, uint256)
    {
        // Gather price and decimal information for next collateral components
        address nextSetComponent;
        uint256 nextSetComponentPrice;
        uint8 nextSetComponentDecimals;
        if (_toBaseAsset) {
            nextSetComponent = address(baseAssetInstance);
            nextSetComponentPrice = baseAssetOracleInstance.read();
            nextSetComponentDecimals = baseAssetDecimals;
        } else {
            nextSetComponent = address(quoteAssetInstance);
            nextSetComponentPrice = quoteAssetOracleInstance.read();
            nextSetComponentDecimals = quoteAssetDecimals;
        }

        // Get collateral Set units and naturalUnit. Units will be rounded to the nearest power
        // of 2 to the units required to set value of nextSet == value of currentSet.     
        (
            uint256 nextSetUnit,
            uint256 nextSetNaturalUnit
        ) = calculateNextSetParameters(
            _currentSetValue,
            nextSetComponentPrice,
            nextSetComponentDecimals
        );

        // Calculate dollar value of new collateral
        uint256 nextSetValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            nextSetComponentPrice,
            nextSetNaturalUnit,
            nextSetUnit,
            nextSetComponentDecimals
        );

        address nextSetAddress = createOrSelectNextSet(
            nextSetComponent,
            nextSetUnit,
            nextSetNaturalUnit,
            _toBaseAsset
        );

        return (nextSetAddress, nextSetValue);
    }

    function createOrSelectNextSet(
        address _nextSetComponent,
        uint256 _nextSetUnit,
        uint256 _nextSetNaturalUnit,
        bool _toBaseAsset
    )
        internal
        returns (address)
    {
        bytes32 collateralIDHash = createCollateralIDHash(
            _nextSetUnit,
            _nextSetNaturalUnit,
            _nextSetComponent
        );
        
        if (storedCollateral[collateralIDHash] != address(0)) {
            return storedCollateral[collateralIDHash];
        } else {
            uint256[] memory nextSetUnits = new uint256[](1);
            address[] memory nextSetComponents = new address[](1);
            nextSetUnits[0] = _nextSetUnit;
            nextSetComponents[0] = _nextSetComponent;

            // Create new collateral set with units and naturalUnit as calculated above
            address nextSetAddress = createNewCollateralSet(
                nextSetComponents,
                nextSetUnits,
                _nextSetNaturalUnit,
                _toBaseAsset
            );

            storedCollateral[collateralIDHash] = nextSetAddress;

            emit NewCollateralLogged(collateralIDHash, nextSetAddress);

            return nextSetAddress;
        }
    }

    /*
     * Determines the correct name and symbol for the new collateral Set, then creates the Set by calling
     * Core and returns the address.
     *
     * @param  _nextSetComponents       Components of the next Set
     * @param  _nextSetUnits            Units of the next Set
     * @param  _nextSetNaturalUnit      Natural unit of the next Set
     * @param  _toBaseAsset             Boolean indicating whether new collateral is made of baseAsset
     * @return address                  Address of the nextSet
     */
    function createNewCollateralSet(
        address[] memory _nextSetComponents,
        uint256[] memory _nextSetUnits,
        uint256 _nextSetNaturalUnit,
        bool _toBaseAsset
    )
        internal
        returns (address)
    {
        (
            bytes32 nextCollateralName,
            bytes32 nextCollateralSymbol
        ) = _toBaseAsset ? (bytes32("BaseAssetCollateral"), bytes32("BACOL")) :
            (bytes32("QuoteAssetCollateral"), bytes32("QACOL"));

        // Create new collateral set with passed units and naturalUnit
        return coreInstance.createSet(
            setTokenFactoryAddress,
            _nextSetComponents,
            _nextSetUnits,
            _nextSetNaturalUnit,
            nextCollateralName,
            nextCollateralSymbol,
            ""
        );       
    }

    function createCollateralIDHashFromSet(
        ISetToken _setToken
    )
        internal
        returns (bytes32)
    {
        SetTokenLibrary.SetDetails memory setDetails = SetTokenLibrary.getSetDetails(
            address(_setToken)
        );

        return createCollateralIDHash(
            setDetails.units[0],
            setDetails.naturalUnit,
            setDetails.components[0]
        );
    }

    /*
     * Calculate new collateral units and natural unit. If necessary iterate through until naturalUnit
     * found that supports non-zero unit amount.
     *
     * @param  _targetCollateralUSDValue      USD Value of current collateral set
     * @param  _newComponentPrice             Price of underlying token to be rebalanced into
     * @param  _newComponentDecimals          Amount of decimals in replacement token
     * @return uint256[]                      Units array for new collateral set
     * @return uint256                        NaturalUnit for new collateral set
     */
    function calculateNextSetParameters(
        uint256 _targetCollateralUSDValue,
        uint256 _newComponentPrice,
        uint8 _newComponentDecimals
    )
        internal
        pure
        returns (uint256, uint256)
    {
        // Calculate nextSetUnits such that the USD value of new Set is equal to the USD value of the Set
        // being rebalanced out of

        uint256 potentialNextUnit = 0;
        uint256 naturalUnitMultiplier = 1;
        uint256 nextNaturalUnit;

        // Determine minimum natural unit based on max of pre-defined minimum or (18 - decimals) of the 
        // component in the new Set.
        uint256 minimumNaturalUnit = Math.max(
            MINIMUM_COLLATERAL_NATURAL_UNIT,
            CommonMath.safePower(10, (uint256(18).sub(_newComponentDecimals)))
        );

        // Calculate next units. If nextUnit is 0 then bump natural unit (and thus units) by factor of
        // ten until unit is greater than 0
        while (potentialNextUnit == 0) {
            nextNaturalUnit = minimumNaturalUnit.mul(naturalUnitMultiplier);
            potentialNextUnit = calculateNextSetUnits(
                _targetCollateralUSDValue,
                _newComponentPrice,
                _newComponentDecimals,
                nextNaturalUnit
            );
            naturalUnitMultiplier = naturalUnitMultiplier.mul(10);            
        }

        uint256 nextSetUnit = roundToNearestPowerOfTwo(
            potentialNextUnit
        );

        return (nextSetUnit, nextNaturalUnit);
    }

    function roundToNearestPowerOfTwo(
        uint256 _value
    )
        internal
        pure
        returns (uint256)
    {
        require (_value > 0);

        // Multiply by 1.5 to roughly approximate sqrt(2). Needed to round to nearest power of two. 
        uint256 scaledValue = _value.mul(3).div(2);
        uint256 power = 0;

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

    function createCollateralIDHash(
        uint256 _units,
        uint256 _naturalUnit,
        address _component
    )
        internal
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
     * Calculate new collateral units by making the new collateral USD value equal to the USD value of the
     * Set currently collateralizing the Rebalancing Set.
     *
     * @param  _targetCollateralUSDValue        USD Value of current collateral set
     * @param  _newComponentPrice               Price of asset to be rebalanced into
     * @param  _newComponentDecimals            Amount of decimals in replacement collateral
     * @param  _newCollateralNaturalUnit        Natural Unit of collateral set to be replacement
     * @return uint256                          New unit for new collateral set
     */
    function calculateNextSetUnits(
        uint256 _targetCollateralUSDValue,
        uint256 _newComponentPrice,
        uint8 _newComponentDecimals,
        uint256 _newCollateralNaturalUnit        
    )
        internal
        pure
        returns (uint256)
    {
        return _targetCollateralUSDValue
            .mul(CommonMath.safePower(10, uint256(_newComponentDecimals)))
            .mul(_newCollateralNaturalUnit)
            .div(SET_TOKEN_WHOLE_UNIT.mul(_newComponentPrice));        
    }
}