import * as _ from 'lodash';
import * as ethUtil from 'ethereumjs-util';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';

import { SetTokenContract, MedianContract } from 'set-protocol-contracts';

import {
  BaseTwoAssetStrategyManagerMockContract,
  BinaryAllocationPricerContract,
  BinaryAllocationPricerMockContract,
  BTCETHRebalancingManagerContract,
  BTCDaiRebalancingManagerContract,
  ETHDaiRebalancingManagerContract,
  InverseMACOStrategyManagerContract,
  MACOStrategyManagerContract,
  MACOStrategyManagerV2Contract,
  MovingAverageOracleContract,
  MovingAverageOracleV2Contract,
  MovingAverageToAssetPriceCrossoverTriggerContract,
  PriceTriggerMockContract,
  RSITrendingTriggerContract,
  TwoAssetWeightedStrategyManagerContract,
} from '../contracts';
import { BigNumber } from 'bignumber.js';

import {
  DEFAULT_GAS,
  DEFAULT_REBALANCING_NATURAL_UNIT,
  ETH_DECIMALS,
  ONE_HOUR_IN_SECONDS,
  USDC_DECIMALS,
  VALUE_TO_CENTS_CONVERSION,
  ZERO
} from '../constants';

import { getWeb3 } from '../web3Helper';

const web3 = getWeb3();
const BaseTwoAssetStrategyManagerMock = artifacts.require('BaseTwoAssetStrategyManagerMock');
const BinaryAllocationPricer = artifacts.require('BinaryAllocationPricer');
const BinaryAllocationPricerMock = artifacts.require('BinaryAllocationPricerMock');
const BTCETHRebalancingManager = artifacts.require('BTCETHRebalancingManager');
const BTCDaiRebalancingManager = artifacts.require('BTCDaiRebalancingManager');
const ETHDaiRebalancingManager = artifacts.require('ETHDaiRebalancingManager');
const InverseMACOStrategyManager = artifacts.require('InverseMACOStrategyManager');
const MACOStrategyManager = artifacts.require('MACOStrategyManager');
const MACOStrategyManagerV2 = artifacts.require('MACOStrategyManagerV2');
const MovingAverageToAssetPriceCrossoverTrigger = artifacts.require(
  'MovingAverageToAssetPriceCrossoverTrigger'
);
const PriceTriggerMock = artifacts.require('PriceTriggerMock');
const RSITrendingTrigger = artifacts.require('RSITrendingTrigger');
const TwoAssetWeightedStrategyManager = artifacts.require('TwoAssetWeightedStrategyManager');

const { SetProtocolUtils: SetUtils, SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const {
  SET_FULL_TOKEN_UNITS,
  WBTC_FULL_TOKEN_UNITS,
  WETH_FULL_TOKEN_UNITS,
} = SetUtils.CONSTANTS;

export class ManagerHelper {
  private _tokenOwnerAddress: Address;

  constructor(
    tokenOwnerAddress: Address,
  ) {
    this._tokenOwnerAddress = tokenOwnerAddress;
  }

  /* ============ Rebalancing Token Manager Deployment ============ */

  public async deployBTCETHRebalancingManagerAsync(
    coreAddress: Address,
    btcPriceFeedAddress: Address,
    ethPriceFeedAddress: Address,
    btcAddress: Address,
    ethAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    multiplers: BigNumber[],
    allocationBounds: BigNumber[],
    from: Address = this._tokenOwnerAddress
  ): Promise<BTCETHRebalancingManagerContract> {
    const truffleRebalacingTokenManager = await BTCETHRebalancingManager.new(
      coreAddress,
      btcPriceFeedAddress,
      ethPriceFeedAddress,
      btcAddress,
      ethAddress,
      setTokenFactoryAddress,
      auctionLibrary,
      auctionTimeToPivot,
      multiplers,
      allocationBounds,
      { from },
    );

    return new BTCETHRebalancingManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployBTCDaiRebalancingManagerAsync(
    coreAddress: Address,
    btcPriceFeedAddress: Address,
    daiAddress: Address,
    btcAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    multiplers: BigNumber[],
    allocationBounds: BigNumber[],
    from: Address = this._tokenOwnerAddress
  ): Promise<BTCDaiRebalancingManagerContract> {
    const truffleRebalacingTokenManager = await BTCDaiRebalancingManager.new(
      coreAddress,
      btcPriceFeedAddress,
      daiAddress,
      btcAddress,
      setTokenFactoryAddress,
      auctionLibrary,
      auctionTimeToPivot,
      multiplers,
      allocationBounds,
      { from },
    );

    return new BTCDaiRebalancingManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployETHDaiRebalancingManagerAsync(
    coreAddress: Address,
    ethPriceFeedAddress: Address,
    daiAddress: Address,
    ethAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    multiplers: BigNumber[],
    allocationBounds: BigNumber[],
    from: Address = this._tokenOwnerAddress
  ): Promise<ETHDaiRebalancingManagerContract> {
    const truffleRebalacingTokenManager = await ETHDaiRebalancingManager.new(
      coreAddress,
      ethPriceFeedAddress,
      daiAddress,
      ethAddress,
      setTokenFactoryAddress,
      auctionLibrary,
      auctionTimeToPivot,
      multiplers,
      allocationBounds,
      { from },
    );

    return new ETHDaiRebalancingManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployMACOStrategyManagerAsync(
    coreAddress: Address,
    movingAveragePriceFeedAddress: Address,
    daiAddress: Address,
    ethAddress: Address,
    stableCollateralAddress: Address,
    riskCollateralAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    movingAverageDays: BigNumber,
    crossoverConfirmationBounds: BigNumber[],
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    from: Address = this._tokenOwnerAddress
  ): Promise<MACOStrategyManagerContract> {
    const truffleRebalacingTokenManager = await MACOStrategyManager.new(
      coreAddress,
      movingAveragePriceFeedAddress,
      daiAddress,
      ethAddress,
      stableCollateralAddress,
      riskCollateralAddress,
      setTokenFactoryAddress,
      auctionLibrary,
      movingAverageDays,
      auctionTimeToPivot,
      crossoverConfirmationBounds,
      { from },
    );

    return new MACOStrategyManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployMACOStrategyManagerV2Async(
    coreAddress: Address,
    movingAveragePriceFeedAddress: Address,
    riskAssetOracleAddress: Address,
    daiAddress: Address,
    ethAddress: Address,
    stableCollateralAddress: Address,
    riskCollateralAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    movingAverageDays: BigNumber,
    crossoverConfirmationBounds: BigNumber[],
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    from: Address = this._tokenOwnerAddress
  ): Promise<MACOStrategyManagerV2Contract> {
    const truffleRebalacingTokenManager = await MACOStrategyManagerV2.new(
      coreAddress,
      movingAveragePriceFeedAddress,
      riskAssetOracleAddress,
      daiAddress,
      ethAddress,
      [stableCollateralAddress, riskCollateralAddress],
      setTokenFactoryAddress,
      auctionLibrary,
      movingAverageDays,
      auctionTimeToPivot,
      crossoverConfirmationBounds,
      { from },
    );

    return new MACOStrategyManagerV2Contract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployInverseMACOStrategyManagerAsync(
    coreAddress: Address,
    movingAveragePriceFeedAddress: Address,
    riskAssetOracleAddress: Address,
    daiAddress: Address,
    ethAddress: Address,
    stableCollateralAddress: Address,
    riskCollateralAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    movingAverageDays: BigNumber,
    crossoverConfirmationBounds: BigNumber[],
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    from: Address = this._tokenOwnerAddress
  ): Promise<MACOStrategyManagerV2Contract> {
    const truffleRebalacingTokenManager = await InverseMACOStrategyManager.new(
      coreAddress,
      movingAveragePriceFeedAddress,
      riskAssetOracleAddress,
      daiAddress,
      ethAddress,
      [stableCollateralAddress, riskCollateralAddress],
      setTokenFactoryAddress,
      auctionLibrary,
      movingAverageDays,
      auctionTimeToPivot,
      crossoverConfirmationBounds,
      { from },
    );

    return new InverseMACOStrategyManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployBaseTwoAssetStrategyManagerMockAsync(
    coreInstance: Address,
    allocationPricerInstance: Address,
    auctionLibraryInstance: Address,
    baseAssetAllocation: BigNumber,
    auctionTimeToPivot: BigNumber = ONE_HOUR_IN_SECONDS.mul(2),
    auctionSpeed: BigNumber = ONE_HOUR_IN_SECONDS.div(6),
    from: Address = this._tokenOwnerAddress
  ): Promise<BaseTwoAssetStrategyManagerMockContract> {
    const truffleRebalacingTokenManager = await BaseTwoAssetStrategyManagerMock.new(
      coreInstance,
      allocationPricerInstance,
      auctionLibraryInstance,
      baseAssetAllocation,
      auctionTimeToPivot,
      auctionSpeed,
      { from },
    );

    return new BaseTwoAssetStrategyManagerMockContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployTwoAssetWeightedStrategyManagerAsync(
    coreInstance: Address,
    allocationPricerInstance: Address,
    auctionLibraryInstance: Address,
    baseAssetAllocation: BigNumber,
    auctionTimeToPivot: BigNumber = ONE_HOUR_IN_SECONDS.mul(2),
    auctionSpeed: BigNumber = ONE_HOUR_IN_SECONDS.div(6),
    priceTriggers: Address[],
    triggerWeights: BigNumber[],
    from: Address = this._tokenOwnerAddress
  ): Promise<TwoAssetWeightedStrategyManagerContract> {
    const truffleRebalacingTokenManager = await TwoAssetWeightedStrategyManager.new(
      coreInstance,
      allocationPricerInstance,
      auctionLibraryInstance,
      baseAssetAllocation,
      auctionTimeToPivot,
      auctionSpeed,
      priceTriggers,
      triggerWeights,
      { from },
    );

    return new TwoAssetWeightedStrategyManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  /* ============ Price Triggers ============ */
  public async deployPriceTriggerMocksAsync(
    priceTriggerCount: number,
    initialStates: boolean[],
  ): Promise<PriceTriggerMockContract[]> {
    const priceTriggers: PriceTriggerMockContract[] = [];
    const priceTriggersPromises = _.times(priceTriggerCount, async index => {
      return await PriceTriggerMock.new(
        initialStates[index],
        { from: this._tokenOwnerAddress, gas: DEFAULT_GAS },
      );
    });

    await Promise.all(priceTriggersPromises).then(priceTriggerInstances => {
      _.each(priceTriggerInstances, priceTrigger => {
        priceTriggers.push(new PriceTriggerMockContract(
          new web3.eth.Contract(priceTrigger.abi, priceTrigger.address),
          { from: this._tokenOwnerAddress, gas: DEFAULT_GAS }
        ));
      });
    });

    return priceTriggers;
  }


  public async deployMovingAverageToAssetPriceCrossoverTrigger(
    movingAveragePriceFeed: Address,
    assetPairOracle: Address,
    movingAverageDays: BigNumber,
    initialState: boolean,
    signalConfirmationMinTime: BigNumber,
    signalConfirmationMaxTime: BigNumber,
    from: Address = this._tokenOwnerAddress,
  ): Promise<MovingAverageToAssetPriceCrossoverTriggerContract> {
    const trufflePriceTrigger = await MovingAverageToAssetPriceCrossoverTrigger.new(
      movingAveragePriceFeed,
      assetPairOracle,
      movingAverageDays,
      signalConfirmationMinTime,
      signalConfirmationMaxTime,
      initialState,
      { from }
    );

    return new MovingAverageToAssetPriceCrossoverTriggerContract(
      new web3.eth.Contract(trufflePriceTrigger.abi, trufflePriceTrigger.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployRSITrendingTrigger(
    rsiOracleInstance: Address,
    lowerBound: BigNumber,
    upperBound: BigNumber,
    rsiTimePeriod: BigNumber,
    initialTrendState: boolean,
    from: Address = this._tokenOwnerAddress,
  ): Promise<RSITrendingTriggerContract> {
    const trufflePriceTrigger = await RSITrendingTrigger.new(
      rsiOracleInstance,
      lowerBound,
      upperBound,
      rsiTimePeriod,
      initialTrendState,
      { from }
    );

    return new RSITrendingTriggerContract(
      new web3.eth.Contract(trufflePriceTrigger.abi, trufflePriceTrigger.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  /* ============ Allocation Pricers ============ */

  public async deployBinaryAllocationPricerAsync(
    baseAssetInstance: Address,
    quoteAssetInstance: Address,
    baseAssetOracleInstance: Address,
    quoteAssetOracleInstance: Address,
    baseAssetCollateralInstance: Address,
    quoteAssetCollateralInstance: Address,
    coreInstance: Address,
    setTokenFactoryAddress: Address,
    from: Address = this._tokenOwnerAddress,
  ): Promise<BinaryAllocationPricerContract> {
    const truffleAllocationPricer = await BinaryAllocationPricer.new(
      baseAssetInstance,
      quoteAssetInstance,
      baseAssetOracleInstance,
      quoteAssetOracleInstance,
      baseAssetCollateralInstance,
      quoteAssetCollateralInstance,
      coreInstance,
      setTokenFactoryAddress,
      { from }
    );

    return new BinaryAllocationPricerContract(
      new web3.eth.Contract(truffleAllocationPricer.abi, truffleAllocationPricer.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public async deployBinaryAllocationPricerMockAsync(
    baseAssetCollateralInstance: Address,
    quoteAssetCollateralInstance: Address,
    baseAssetCollateralValue: BigNumber,
    quoteAssetCollateralValue: BigNumber,
    from: Address = this._tokenOwnerAddress,
  ): Promise<BinaryAllocationPricerMockContract> {
    const truffleAllocationPricer = await BinaryAllocationPricerMock.new(
      baseAssetCollateralInstance,
      quoteAssetCollateralInstance,
      baseAssetCollateralValue,
      quoteAssetCollateralValue,
      { from }
    );

    return new BinaryAllocationPricerMockContract(
      new web3.eth.Contract(truffleAllocationPricer.abi, truffleAllocationPricer.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  /* ============ Helper Functions ============ */

  public calculateCollateralSetHash(
    units: BigNumber,
    naturalUnit: BigNumber,
    component: Address
  ): string {
    const hexString = SetTestUtils.bufferArrayToHex([
      SetUtils.paddedBufferForBigNumber(units),
      SetUtils.paddedBufferForBigNumber(naturalUnit),
      ethUtil.toBuffer(component),
    ]);

    return web3.utils.soliditySha3(hexString);
  }

  public async getMACOInitialAllocationAsync(
    stableCollateral: SetTokenContract,
    riskCollateral: SetTokenContract,
    spotPriceOracle: MedianContract,
    movingAverageOracle: MovingAverageOracleContract | MovingAverageOracleV2Contract,
    dataDays: BigNumber,
  ): Promise<Address> {
    const spotPrice = parseInt(await spotPriceOracle.read.callAsync());
    const rawMAPrice = await movingAverageOracle.read.callAsync(dataDays);
    const maPriceNum = parseInt(rawMAPrice.toString());

    if (spotPrice > maPriceNum) {
      return riskCollateral.address;
    } else {
      return stableCollateral.address;
    }
  }

  public async getInverseMACOInitialAllocationAsync(
    stableCollateral: SetTokenContract,
    riskCollateral: SetTokenContract,
    spotPriceOracle: MedianContract,
    movingAverageOracle: MovingAverageOracleContract | MovingAverageOracleV2Contract,
    dataDays: BigNumber,
  ): Promise<Address> {
    const spotPrice = parseInt(await spotPriceOracle.read.callAsync());
    const rawMAPrice = await movingAverageOracle.read.callAsync(dataDays);
    const maPriceNum = parseInt(rawMAPrice.toString());

    if (spotPrice > maPriceNum) {
      return stableCollateral.address;
    } else {
      return riskCollateral.address;
    }
  }

  public getExpectedBtcEthNextSetParameters(
    btcPrice: BigNumber,
    ethPrice: BigNumber,
    btcMultiplier: BigNumber,
    ethMultiplier: BigNumber,
  ): any {
    let units: BigNumber[];
    let naturalUnit: BigNumber;
    if (btcPrice.greaterThanOrEqualTo(ethPrice)) {
      const ethUnits = btcPrice.mul(new BigNumber(10 ** 10)).div(ethPrice).round(0, 3);
      units = [new BigNumber(1).mul(btcMultiplier), ethUnits.mul(ethMultiplier)];
      naturalUnit = new BigNumber(10 ** 10);
    } else {
      const btcUnits = ethPrice.mul(new BigNumber(100)).mul(btcMultiplier).div(btcPrice).round(0, 3);
      const ethUnits = new BigNumber(100).mul(new BigNumber(10 ** 10)).mul(ethMultiplier);
      units = [btcUnits, ethUnits];
      naturalUnit = new BigNumber(10 ** 12);
    }

    return {
      units,
      naturalUnit,
    };
  }

  public getExpectedGeneralNextSetParameters(
    tokenOnePrice: BigNumber,
    tokenTwoPrice: BigNumber,
    tokenOneMultiplier: BigNumber,
    tokenTwoMultiplier: BigNumber,
    decimalDifference: BigNumber,
    pricePrecision: BigNumber
  ): any {
    let units: BigNumber[];

    const naturalUnit: BigNumber = pricePrecision.mul(decimalDifference);
    if (tokenTwoPrice.greaterThanOrEqualTo(tokenOnePrice)) {
      const tokenOneUnits = tokenTwoPrice.mul(decimalDifference).mul(pricePrecision).div(tokenOnePrice).round(0, 3);
      units = [tokenOneMultiplier.mul(tokenOneUnits), tokenTwoMultiplier.mul(pricePrecision)];
    } else {
      const tokenTwoUnits = tokenOnePrice.mul(pricePrecision).div(tokenTwoPrice).round(0, 3);
      units = [pricePrecision.mul(decimalDifference).mul(tokenOneMultiplier), tokenTwoUnits.mul(tokenTwoMultiplier)];
    }

    return {
      units,
      naturalUnit,
    };
  }

  public async getExpectedNewBinaryAllocationParametersAsync(
    currentCollateralSet: SetTokenContract,
    currentAssetPrice: BigNumber,
    nextAssetPrice: BigNumber,
    currentAssetDecimals: BigNumber,
    nextAssetDecimals: BigNumber
  ): Promise<any> {
    let naturalUnit: BigNumber;
    let units: BigNumber[];

    const currentUnits = await currentCollateralSet.getUnits.callAsync();
    const currentNaturalUnit = await currentCollateralSet.naturalUnit.callAsync();

    const currentCollateralUSDValue = this.computeTokenDollarAmount(
      currentAssetPrice,
      SET_FULL_TOKEN_UNITS.mul(currentUnits).div(currentNaturalUnit),
      currentAssetDecimals
    );

    let newUnits: BigNumber = ZERO;
    let naturalUnitMultiplier: BigNumber = new BigNumber(1);
    const minimumNaturalUnit = BigNumber.max(
      DEFAULT_REBALANCING_NATURAL_UNIT,
      new BigNumber(10 ** 18).div(nextAssetDecimals)
    );
    while (newUnits.lessThan(1)) {
      naturalUnit = minimumNaturalUnit.mul(naturalUnitMultiplier);
      newUnits = this.calculateNewUnits(
        currentCollateralUSDValue,
        nextAssetPrice,
        nextAssetDecimals,
        naturalUnit
      );
      naturalUnitMultiplier = naturalUnitMultiplier.mul(10);
    }
    units = [this.roundToNearestPowerOfTwo(newUnits)];
    return {
      units,
      naturalUnit,
    };
  }

  public async getExpectedMACONewCollateralParametersAsync(
    stableCollateral: SetTokenContract,
    riskCollateral: SetTokenContract,
    spotPriceOracle: MedianContract,
    stableCollateralDecimals: BigNumber,
    riskCollateralDecimals: BigNumber,
    riskOn: boolean,
  ): Promise<any> {
    let naturalUnit: BigNumber;
    let units: BigNumber[];

    const currentEthPrice = new BigNumber(await spotPriceOracle.read.callAsync());
    const currentUSDCPrice = new BigNumber(10 ** 18);

    const riskUnits = await riskCollateral.getUnits.callAsync();
    const riskNaturalUnit = await riskCollateral.naturalUnit.callAsync();
    const stableUnits = await stableCollateral.getUnits.callAsync();
    const stableNaturalUnit = await stableCollateral.naturalUnit.callAsync();

    let newUnits: BigNumber = new BigNumber(1);
    let naturalUnitMultiplier: BigNumber = new BigNumber(1);
    if (riskOn) {
      const riskCollateralUSDValue = this.computeTokenDollarAmount(
        currentEthPrice,
        SET_FULL_TOKEN_UNITS.mul(riskUnits).div(riskNaturalUnit),
        riskCollateralDecimals
      );

      while (newUnits.lessThanOrEqualTo(1)) {
        naturalUnit = stableNaturalUnit.mul(naturalUnitMultiplier);
        newUnits = this.calculateNewUnits(
          riskCollateralUSDValue,
          currentUSDCPrice,
          USDC_DECIMALS,
          naturalUnit
        );
        naturalUnitMultiplier = naturalUnitMultiplier.mul(10);
      }
      units = [newUnits];
    } else {
      const stableCollateralUSDValue = this.computeTokenDollarAmount(
        currentUSDCPrice,
        SET_FULL_TOKEN_UNITS.mul(stableUnits).div(stableNaturalUnit),
        stableCollateralDecimals
      );

      while (newUnits.lessThanOrEqualTo(1)) {
        naturalUnit = riskNaturalUnit.mul(naturalUnitMultiplier);
        newUnits = this.calculateNewUnits(
          stableCollateralUSDValue,
          currentEthPrice,
          ETH_DECIMALS,
          naturalUnit
        );
        naturalUnitMultiplier = naturalUnitMultiplier.mul(10);
      }
    }
    units = [newUnits];
    return {
      units,
      naturalUnit,
    };
  }

  private calculateNewUnits(
    currentUSDValue: BigNumber,
    replacedCollateralPrice: BigNumber,
    replacedCollateralDecimals: BigNumber,
    replacedCollateralNaturalUnit: BigNumber
  ): BigNumber {
    return currentUSDValue
              .mul(replacedCollateralDecimals)
              .mul(replacedCollateralNaturalUnit)
              .div(SET_FULL_TOKEN_UNITS).round(0, 3)
              .div(replacedCollateralPrice.div(VALUE_TO_CENTS_CONVERSION)).round(0, 3);
  }

  public async getExpectedGeneralAuctionParameters(
    tokenOnePrice: BigNumber,
    tokenTwoPrice: BigNumber,
    tokenOneMultiplier: BigNumber,
    tokenTwoMultiplier: BigNumber,
    tokenOneDecimals: BigNumber,
    tokenTwoDecimals: BigNumber,
    pricePrecision: BigNumber,
    auctionTimeToPivot: BigNumber,
    currentSetToken: SetTokenContract,
  ): Promise<any> {
    const THIRTY_MINUTES_IN_SECONDS = new BigNumber(30 * 60);

    const nextSetParams = this.getExpectedGeneralNextSetParameters(
      tokenOnePrice,
      tokenTwoPrice,
      tokenOneMultiplier,
      tokenTwoMultiplier,
      tokenOneDecimals.div(tokenTwoDecimals),
      pricePrecision,
    );

    const currentSetNaturalUnit = await currentSetToken.naturalUnit.callAsync();
    const currentSetUnits = await currentSetToken.getUnits.callAsync();

    const currentSetDollarAmount = this.computeTokenValue(
      currentSetUnits,
      currentSetNaturalUnit,
      tokenOnePrice,
      tokenTwoPrice,
      tokenOneDecimals,
      tokenTwoDecimals,
    );

    const nextSetDollarAmount = this.computeTokenValue(
      nextSetParams['units'],
      nextSetParams['naturalUnit'],
      tokenOnePrice,
      tokenTwoPrice,
      tokenOneDecimals,
      tokenTwoDecimals,
    );

    const fairValue = nextSetDollarAmount.div(currentSetDollarAmount).mul(1000).round(0, 3);
    const onePercentSlippage = fairValue.div(100).round(0, 3);

    const thirtyMinutePeriods = auctionTimeToPivot.div(THIRTY_MINUTES_IN_SECONDS).round(0, 3);
    const halfPriceRange = thirtyMinutePeriods.mul(onePercentSlippage).div(2).round(0, 3);

    const auctionStartPrice = fairValue.sub(halfPriceRange);
    const auctionPivotPrice = fairValue.add(halfPriceRange);

    return {
      auctionStartPrice,
      auctionPivotPrice,
    };
  }

  public async getExpectedMACOAuctionParametersAsync(
    currentSetToken: SetTokenContract,
    nextSetToken: SetTokenContract,
    riskOn: boolean,
    ethPrice: BigNumber,
    timeIncrement: BigNumber,
    auctionTimeToPivot: BigNumber,
  ): Promise<any> {
    let nextSetDollarAmount: BigNumber;
    let currentSetDollarAmount: BigNumber;

    const nextSetUnits = await nextSetToken.getUnits.callAsync();
    const nextSetNaturalUnit = await nextSetToken.naturalUnit.callAsync();

    const currentSetUnits = await currentSetToken.getUnits.callAsync();
    const currentSetNaturalUnit = await currentSetToken.naturalUnit.callAsync();

    const USDC_PRICE = new BigNumber(10 ** 18);
    if (riskOn) {
      nextSetDollarAmount = nextSetUnits[0]
        .mul(SET_FULL_TOKEN_UNITS)
        .mul(USDC_PRICE)
        .div(nextSetNaturalUnit)
        .div(USDC_DECIMALS);
      currentSetDollarAmount = currentSetUnits[0]
        .mul(SET_FULL_TOKEN_UNITS)
        .mul(ethPrice)
        .div(currentSetNaturalUnit)
        .div(ETH_DECIMALS);
    } else {
      currentSetDollarAmount = currentSetUnits[0]
        .mul(SET_FULL_TOKEN_UNITS)
        .mul(USDC_PRICE)
        .div(currentSetNaturalUnit)
        .div(USDC_DECIMALS);
      nextSetDollarAmount = nextSetUnits[0]
        .mul(SET_FULL_TOKEN_UNITS)
        .mul(ethPrice)
        .div(nextSetNaturalUnit)
        .div(ETH_DECIMALS);
    }

    return this.calculateLinearAuctionParameters(
      currentSetDollarAmount,
      nextSetDollarAmount,
      timeIncrement,
      auctionTimeToPivot
    );
  }

  public calculateLinearAuctionParameters(
    currentSetValue: BigNumber,
    nextSetValue: BigNumber,
    timeIncrement: BigNumber,
    auctionTimeToPivot: BigNumber
  ): any {
    const fairValue = nextSetValue.div(currentSetValue).mul(1000).round(0, 3);
    const onePercentSlippage = fairValue.div(100).round(0, 3);

    const timeIncrements = auctionTimeToPivot.div(timeIncrement).round(0, 3);
    const halfPriceRange = timeIncrements.mul(onePercentSlippage).div(2).round(0, 3);

    const auctionStartPrice = fairValue.sub(halfPriceRange);
    const auctionPivotPrice = fairValue.add(halfPriceRange);

    return {
      auctionStartPrice,
      auctionPivotPrice,
    };
  }

  public async getExpectedBtcEthAuctionParameters(
    btcPrice: BigNumber,
    ethPrice: BigNumber,
    btcMultiplier: BigNumber,
    ethMultiplier: BigNumber,
    auctionTimeToPivot: BigNumber,
    currentSetToken: SetTokenContract,
  ): Promise<any> {
    const THIRTY_MINUTES_IN_SECONDS = new BigNumber(30 * 60);
    const BTC_DECIMALS = WBTC_FULL_TOKEN_UNITS;
    const ETH_DECIMALS = WETH_FULL_TOKEN_UNITS;

    const nextSetParams = this.getExpectedBtcEthNextSetParameters(
      btcPrice,
      ethPrice,
      btcMultiplier,
      ethMultiplier,
    );

    const currentSetNaturalUnit = await currentSetToken.naturalUnit.callAsync();
    const currentSetUnits = await currentSetToken.getUnits.callAsync();

    const currentSetDollarAmount = this.computeTokenValue(
      currentSetUnits,
      currentSetNaturalUnit,
      btcPrice,
      ethPrice,
      BTC_DECIMALS,
      ETH_DECIMALS,
    );

    const nextSetDollarAmount = this.computeTokenValue(
      nextSetParams['units'],
      nextSetParams['naturalUnit'],
      btcPrice,
      ethPrice,
      BTC_DECIMALS,
      ETH_DECIMALS,
    );

    const fairValue = nextSetDollarAmount.div(currentSetDollarAmount).mul(1000).round(0, 3);
    const onePercentSlippage = fairValue.div(100).round(0, 3);

    const thirtyMinutePeriods = auctionTimeToPivot.div(THIRTY_MINUTES_IN_SECONDS).round(0, 3);
    const halfPriceRange = thirtyMinutePeriods.mul(onePercentSlippage).div(2).round(0, 3);

    const auctionStartPrice = fairValue.sub(halfPriceRange);
    const auctionPivotPrice = fairValue.add(halfPriceRange);

    return {
      auctionStartPrice,
      auctionPivotPrice,
    };
  }

  public async calculateSetTokenValue(
    setToken: SetTokenContract,
    componentPrices: BigNumber[],
    componentDecimals: BigNumber[]
  ): Promise<BigNumber> {
    const collateralSetUnits = await setToken.getUnits.callAsync();
    const collateralSetNaturalUnit = await setToken.naturalUnit.callAsync();

    let collateralSetValue = new BigNumber(0);
    for (let i = 0; i < collateralSetUnits.length; i++) {
      const componentUnitsInFullToken = SET_FULL_TOKEN_UNITS
                                        .mul(collateralSetUnits)
                                        .div(collateralSetNaturalUnit)
                                        .round(0, 3);

      const componentDollarAmount = componentPrices[i]
                                    .mul(componentUnitsInFullToken)
                                    .div(componentDecimals[i]);
      collateralSetValue = collateralSetValue.add(componentDollarAmount);
    }

    return collateralSetValue;
  }

  private computeTokenValue(
    units: BigNumber[],
    naturalUnit: BigNumber,
    tokenOnePrice: BigNumber,
    tokenTwoPrice: BigNumber,
    tokenOneDecimals: BigNumber,
    tokenTwoDecimals: BigNumber,
  ): BigNumber {
    const tokenOneUnitsInFullToken = SET_FULL_TOKEN_UNITS.mul(units[0]).div(naturalUnit).round(0, 3);
    const tokenTwoUnitsInFullToken = SET_FULL_TOKEN_UNITS.mul(units[1]).div(naturalUnit).round(0, 3);

    const tokenOneDollarAmount = this.computeTokenDollarAmount(
      tokenOnePrice,
      tokenOneUnitsInFullToken,
      tokenOneDecimals
    );
    const tokenTwoDollarAmount = this.computeTokenDollarAmount(
      tokenTwoPrice,
      tokenTwoUnitsInFullToken,
      tokenTwoDecimals
    );

    return tokenOneDollarAmount.add(tokenTwoDollarAmount);
  }

  private computeTokenDollarAmount(
    tokenPrice: BigNumber,
    unitsInFullSet: BigNumber,
    tokenDecimals: BigNumber,
  ): BigNumber {
    return tokenPrice
             .mul(unitsInFullSet)
             .div(tokenDecimals)
             .div(VALUE_TO_CENTS_CONVERSION)
             .round(0, 3);
  }

  private roundToNearestPowerOfTwo(
    value: BigNumber
  ): BigNumber {
    // Multiply by 1.5 to roughly approximate sqrt(2). Needed to round to nearest power of two.
    let scaledValue = value.mul(3).div(2).round(0, 3).toNumber();
    let power = 0;

    if (scaledValue >= 0x100000000000000000000000000000000) { scaledValue >>= 128; power += 128; }
    if (scaledValue >= 0x10000000000000000) { scaledValue >>= 64; power += 64; }
    if (scaledValue >= 0x100000000) { scaledValue >>= 32; power += 32; }
    if (scaledValue >= 0x10000) { scaledValue >>= 16; power += 16; }
    if (scaledValue >= 0x100) { scaledValue >>= 8; power += 8; }
    if (scaledValue >= 0x10) { scaledValue >>= 4; power += 4; }
    if (scaledValue >= 0x4) { scaledValue >>= 2; power += 2; }
    if (scaledValue >= 0x2) power += 1; // No need to shift x anymore

    return new BigNumber(2 ** power);
  }
}
