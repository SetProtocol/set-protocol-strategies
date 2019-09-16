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

    /* ============ Structs ============ */
    struct CollateralSetInfo {
        ISetToken setInstance;
        uint256 componentPrice;
        uint256 componentDecimals;
        uint256 collateralValue;
    }

    /* ============ Constants ============ */
    uint256 constant SET_TOKEN_DECIMALS = 10 ** 18;
    uint256 constant MINIMUM_COLLATERAL_NATURAL_UNIT = 10 ** 6;
    uint256 constant ALLOCATION_PRICE_RATIO_LIMIT = 4;

    /* ============ State Variables ============ */
    ICore public coreInstance;
    address public setTokenFactoryAddress;

    ERC20Detailed public baseAssetInstance;
    ERC20Detailed public quoteAssetInstance;
    IOracle public baseAssetOracleInstance;
    IOracle public quoteAssetOracleInstance;
    ISetToken public baseAssetCollateralInstance;
    ISetToken public quoteAssetCollateralInstance;
    uint256 public baseAssetDecimals;
    uint256 public quoteAssetDecimals;

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

        // Set state frome constructor params
        baseAssetCollateralInstance = _baseAssetCollateralInstance;
        quoteAssetCollateralInstance = _quoteAssetCollateralInstance;

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
    }

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
        bool toBaseAsset = validateAllocationParams(
            _targetBaseAssetAllocation,
            _currentCollateralSet
        );

        // Create struct that holds relevant information for the currentSet and (potential) nextSet
        (
            CollateralSetInfo memory currentSetInfo,
            CollateralSetInfo memory nextSetInfo
        ) = getCollateralSetInfo(
            toBaseAsset,
            _currentCollateralSet
        );

        // Check to see if new collateral must be created in order to keep collateral price ratio in line.
        // If not just return the dollar value of current collateral sets
        return checkForNewCollateral(
            currentSetInfo,
            nextSetInfo,
            toBaseAsset
        );
    }

    /*
     * Validate passed parameters to make sure target allocation is either 0 or 100 and that the currentSet
     * was created by core and is made up of the correct component. Finally, return a boolean indicating
     * whether new allocation should be in baseAsset.
     *
     * @param  _targetBaseAssetAllocation       Target allocation of the base asset
     * @param  _currentCollateralSet            Instance of current set collateralizing RebalancingSetToken
     * @return boolean                          The address of the proposed nextSet
     */
    function validateAllocationParams(
        uint256 _targetBaseAssetAllocation,
        ISetToken _currentCollateralSet        
    )
        internal
        view
        returns (bool)
    {
        require(
            _targetBaseAssetAllocation == 100 || _targetBaseAssetAllocation == 0,
            "BinaryAllocationPricer.validateAllocationParams: Passed allocation must be 100 or 0."
        );

        // Determine if rebalance is to the baseAsset
        bool toBaseAsset = (_targetBaseAssetAllocation == 100);

        // Make sure passed currentSet was created by Core
        require(
            coreInstance.validSets(address(_currentCollateralSet)),
            "BinaryAllocationPricer.validateAllocationParams: Passed collateralSet must be tracked by Core."
        );

        // Make sure that currentSet component is opposite of expected component to be rebalanced into
        address[] memory currentSetComponents = _currentCollateralSet.getComponents();
        address requiredComponent = toBaseAsset ? address(quoteAssetInstance) : address(baseAssetInstance);
        require(
            currentSetComponents[0] == requiredComponent,
            "BinaryAllocationPricer.validateAllocationParams: New allocation doesn't match currentSet component."
        );

        return toBaseAsset;
    }

    /*
     * Create structs of current and potential next Set containing a reference to the instance of the Set and
     * relevant value, component price, and component decimal information.
     *
     * @param  _toBaseAsset                 Boolean indicating whether new collateral is made of baseAsset
     * @param  _currentCollateralSet        Instance of current set collateralizing RebalancingSetToken
     * @return CollateralSetInfo            Component, price, and adress information of current Set
     * @return CollateralSetInfo            Component, price, and adress information of (potential) next Set
     */
    function getCollateralSetInfo(
        bool _toBaseAsset,
        ISetToken _currentCollateralSet
    )
        internal
        view
        returns (CollateralSetInfo memory, CollateralSetInfo memory)
    {
        // Get current oracle prices
        uint256 baseAssetPrice = baseAssetOracleInstance.read();
        uint256 quoteAssetPrice = quoteAssetOracleInstance.read();

        // Based on if rebalancing to baseAsset, assign correct variables to SetInfo structs
        CollateralSetInfo memory currentSetInfo;
        CollateralSetInfo memory nextSetInfo;
        if (_toBaseAsset) {
            currentSetInfo.componentPrice = quoteAssetPrice;
            currentSetInfo.componentDecimals = quoteAssetDecimals;
            currentSetInfo.setInstance = _currentCollateralSet;

            nextSetInfo.componentPrice = baseAssetPrice;
            nextSetInfo.componentDecimals = baseAssetDecimals;
            nextSetInfo.setInstance = baseAssetCollateralInstance;
        } else {
            currentSetInfo.componentPrice = baseAssetPrice;
            currentSetInfo.componentDecimals = baseAssetDecimals;
            currentSetInfo.setInstance = _currentCollateralSet;

            nextSetInfo.componentPrice = quoteAssetPrice;
            nextSetInfo.componentDecimals = quoteAssetDecimals;
            nextSetInfo.setInstance = quoteAssetCollateralInstance;
        }

        // Get currentSet Details and use to value passed currentSet
        SetTokenLibrary.SetDetails memory currentSetDetails = SetTokenLibrary.getSetDetails(
            address(currentSetInfo.setInstance)
        );
        currentSetInfo.collateralValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            currentSetInfo.componentPrice,
            currentSetDetails.naturalUnit,
            currentSetDetails.units[0],
            currentSetInfo.componentDecimals
        );

        // Get nextSet Details and use to value nextSet pulled from contract
        SetTokenLibrary.SetDetails memory nextSetDetails = SetTokenLibrary.getSetDetails(
            address(nextSetInfo.setInstance)
        );
        nextSetInfo.collateralValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            nextSetInfo.componentPrice,
            nextSetDetails.naturalUnit,
            nextSetDetails.units[0],
            nextSetInfo.componentDecimals
        );

        return (currentSetInfo, nextSetInfo);        
    }

    /*
     * Check to see if a new collateral set needs to be created. If the dollar value of the two collateral sets is more
     * than 4x different from each other then create a new collateral set.
     *
     * @param  _currentSetInfo          Component, price, and adress information of current Set
     * @param  _nextSetInfo             Component, price, and adress information of (potential) next Set
     * @param  _toBaseAsset             Boolean indicating whether new collateral is made of baseAsset
     * @return address                  Address of the nextSet
     * @return uint256                  The USD value of currentSet
     * @return uint256                  The USD value of nextSet
     */
    function checkForNewCollateral(
        CollateralSetInfo memory _currentSetInfo,
        CollateralSetInfo memory _nextSetInfo,
        bool _toBaseAsset
    )
        internal
        returns(address, uint256, uint256)
    {   
        // If value of one Set is 4 times greater than the other, create a new collateral Set
        if (_currentSetInfo.collateralValue.mul(ALLOCATION_PRICE_RATIO_LIMIT) <= _nextSetInfo.collateralValue ||
            _currentSetInfo.collateralValue >= _nextSetInfo.collateralValue.mul(ALLOCATION_PRICE_RATIO_LIMIT)) {
            //Determine the new collateral parameters
            return determineNewCollateralParameters(
                _currentSetInfo,
                _nextSetInfo,
                _toBaseAsset
            );
        } else {
            return (
                address(_nextSetInfo.setInstance),
                _currentSetInfo.collateralValue,
                _nextSetInfo.collateralValue
            );
        }
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
    function determineNewCollateralParameters(
        CollateralSetInfo memory _currentSetInfo,
        CollateralSetInfo memory _nextSetInfo,
        bool _toBaseAsset
    )
        internal
        returns (address, uint256, uint256)
    {
        // Create static components array
        address[] memory nextSetComponents = _nextSetInfo.setInstance.getComponents();

        uint256 targetCollateralUSDValue = _nextSetInfo.collateralValue > _currentSetInfo.collateralValue ? 
            _currentSetInfo.collateralValue.mul(2) : _currentSetInfo.collateralValue.div(2);

        // Get new collateral Set units and naturalUnit. Target valuation equal to half the currentSet to 1) avoid
        // a sitiuation where the collateral constantly has to be remade when RebalancingSets using the same
        // contract submit old collateral that is still 4x different from the Sets known in the contract, and
        // 2) avoid pricing off the Set's currently on the contract which could have been updated maliciously.        
        (
            uint256[] memory nextSetUnits,
            uint256 nextNaturalUnit
        ) = getNewCollateralSetParameters(
            targetCollateralUSDValue,
            _nextSetInfo.componentPrice,
            _nextSetInfo.componentDecimals
        );

        // Create new collateral set with units and naturalUnit as calculated above
        address nextSetAddress = coreInstance.createSet(
            setTokenFactoryAddress,
            nextSetComponents,
            nextSetUnits,
            nextNaturalUnit,
            bytes32("STBLCollateral"),
            bytes32("STBLMACO"),
            ""
        );
        // Calculate dollar value of new collateral
        uint256 nextSetDollarValue = FlexibleTimingManagerLibrary.calculateTokenAllocationAmountUSD(
            _nextSetInfo.componentPrice,
            nextNaturalUnit,
            nextSetUnits[0],
            _nextSetInfo.componentDecimals
        );

        // Assign new collateral Set to correct AssetCollateralInstance
        if (_toBaseAsset) {
            baseAssetCollateralInstance = ISetToken(nextSetAddress);
        } else {
            quoteAssetCollateralInstance = ISetToken(nextSetAddress);
        }

        return (nextSetAddress, _currentSetInfo.collateralValue, nextSetDollarValue);
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
    function getNewCollateralSetParameters(
        uint256 _targetCollateralUSDValue,
        uint256 _newComponentPrice,
        uint256 _newComponentDecimals
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

        // Determine minimum natural unit based on max of pre-defined minimum or 18 - decimals of the 
        // component in the new Set.
        uint256 minimumNaturalUnit = Math.max(
            MINIMUM_COLLATERAL_NATURAL_UNIT,
            10 ** (uint256(18).sub(_newComponentDecimals))
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

        nextSetUnits[0] = potentialNextUnit;
        return (nextSetUnits, nextNaturalUnit);
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
        uint256 _newComponentDecimals,
        uint256 _newCollateralNaturalUnit        
    )
        internal
        pure
        returns (uint256)
    {
        return _targetCollateralUSDValue
            .mul(10 ** _newComponentDecimals)
            .mul(_newCollateralNaturalUnit)
            .div(SET_TOKEN_DECIMALS.mul(_newComponentPrice));        
    }
}