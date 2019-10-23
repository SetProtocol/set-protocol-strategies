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

import { IOracle } from "../meta-oracles/interfaces/IOracle.sol";
import { IMetaOracleV2 } from "../meta-oracles/interfaces/IMetaOracleV2.sol";
import { MACOStrategyManagerV2 } from "./MACOStrategyManagerV2.sol";


/**
 * @title InverseMACOStrategyManager
 * @author Set Protocol
 * 
 * Instead of going bullish when the price crosses above the moving average, the Set flips to the
 * stable asset and vice versa in a bearish market.
 */
contract InverseMACOStrategyManager is MACOStrategyManagerV2 {
    /*
     * InverseMACOStrategyManager constructor.
     *
     * @param  _coreAddress                         The address of the Core contract
     * @param  _movingAveragePriceFeed              The address of MA price feed
     * @param  _riskAssetOracle                     The address of risk asset oracle
     * @param  _stableAssetAddress                  The address of the stable asset contract
     * @param  _riskAssetAddress                    The address of the risk asset contract
     * @param  _collateralAddresses                 The addresses of collateral Sets [stableCollateral,
     *                                              riskCollateral]
     * @param  _setTokenFactory                     The address of the SetTokenFactory
     * @param  _auctionLibrary                      The address of auction price curve to use in rebalance
     * @param  _movingAverageDays                   The amount of days to use in moving average calculation
     * @param  _auctionTimeToPivot                  The amount of time until pivot reached in rebalance
     * @param  _crossoverConfirmationBounds         The minimum and maximum time in seconds confirm confirmation
     *                                                can be called after the last initial crossover confirmation
     */
    constructor(
        address _coreAddress,
        IMetaOracleV2 _movingAveragePriceFeed,
        IOracle _riskAssetOracle,
        address _stableAssetAddress,
        address _riskAssetAddress,
        address[2] memory _collateralAddresses,
        address _setTokenFactory,
        address _auctionLibrary,
        uint256 _movingAverageDays,
        uint256 _auctionTimeToPivot,
        uint256[2] memory _crossoverConfirmationBounds
    )
        public
        MACOStrategyManagerV2(
            _coreAddress,
            _movingAveragePriceFeed,
            _riskAssetOracle,
            _stableAssetAddress,
            _riskAssetAddress,
            _collateralAddresses,
            _setTokenFactory,
            _auctionLibrary,
            _movingAverageDays,
            _auctionTimeToPivot,
            _crossoverConfirmationBounds
        )
    {}

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
            // If currently holding risk asset (riskOn) check to see if price is above MA, otherwise revert.
            require(
                _movingAveragePrice < _riskAssetPrice,
                "InverseMACOStrategyManager.checkPriceTriggerMet: Risk asset price must be above moving average price"
            );
        } else {
            // If currently holding stable asset (not riskOn) check to see if price is below MA, otherwise revert.
            require(
                _movingAveragePrice > _riskAssetPrice,
                "InverseMACOStrategyManager.checkPriceTriggerMet: Risk asset price must be below moving average price"
            );
        }        
    }
}