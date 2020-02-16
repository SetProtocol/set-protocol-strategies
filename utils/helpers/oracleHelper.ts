import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';

import {
  ConstantPriceOracleContract,
  CTokenOracleContract,
  DydxConstantPriceOracleMockContract,
  DydxOracleAdapterContract,
  EMAOracleContract,
  FeedFactoryContract,
  HistoricalPriceFeedContract,
  TwoAssetRatioOracleContract,
  LegacyMakerOracleAdapterContract,
  LinearizedEMATimeSeriesFeedContract,
  LinearizedPriceDataSourceContract,
  MedianContract,
  MovingAverageOracleContract,
  MovingAverageOracleV1ProxyContract,
  MovingAverageOracleV2Contract,
  OracleProxyContract,
  PriceFeedContract,
  RSIOracleContract,
  TimeSeriesFeedContract,
  TimeSeriesFeedV2Contract,
  TwoAssetLinearizedTimeSeriesFeedContract
} from 'set-protocol-oracles';

import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
} from '@utils/constants';
import { getWeb3, getContractInstance, importFromOracles, txnFrom } from '../web3Helper';
import { FeedCreatedArgs } from '../contract_logs/oracle';

const web3 = getWeb3();

const ConstantPriceOracle = importFromOracles('ConstantPriceOracle');
const CTokenOracle = importFromOracles('CTokenOracle');
const DydxConstantPriceOracleMock = importFromOracles('DydxConstantPriceOracleMock');
const DydxOracleAdapter = importFromOracles('DydxOracleAdapter');
const EMAOracle = importFromOracles('EMAOracle');
const FeedFactory = importFromOracles('FeedFactory');
const HistoricalPriceFeed = importFromOracles('HistoricalPriceFeed');
const TwoAssetRatioOracle = importFromOracles('TwoAssetRatioOracle');
const LegacyMakerOracleAdapter = importFromOracles('LegacyMakerOracleAdapter');
const LinearizedEMATimeSeriesFeed = importFromOracles('LinearizedEMATimeSeriesFeed');
const LinearizedPriceDataSource = importFromOracles('LinearizedPriceDataSource');
const Median = importFromOracles('Median');
const MovingAverageOracle = importFromOracles('MovingAverageOracle');
const MovingAverageOracleV1Proxy = importFromOracles('MovingAverageOracleV1Proxy');
const MovingAverageOracleV2 = importFromOracles('MovingAverageOracleV2');
const OracleProxy = importFromOracles('OracleProxy');
const RSIOracle = importFromOracles('RSIOracle');
const TimeSeriesFeed = importFromOracles('TimeSeriesFeed');
const TwoAssetLinearizedTimeSeriesFeed = importFromOracles('TwoAssetLinearizedTimeSeriesFeed');

const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);
const setUtils = new SetUtils(web3);


export class OracleHelper {
  private _contractOwnerAddress: Address;
  private _blockchain: Blockchain;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
    this._blockchain = new Blockchain(web3);
  }

  /* ============ Deployment ============ */

  public async deployFeedFactoryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<FeedFactoryContract> {
    const feedFactory = await FeedFactory.new(txnFrom(from));

    return new FeedFactoryContract(
      getContractInstance(feedFactory),
      txnFrom(from),
    );
  }

  public async deployPriceFeedAsync(
    feedFactory: FeedFactoryContract,
    from: Address = this._contractOwnerAddress
  ): Promise<PriceFeedContract> {
    const txHash = await feedFactory.create.sendTransactionAsync(
      txnFrom(from),
    );

    const logs = await setTestUtils.getLogsFromTxHash(txHash);
    const createLog = logs[logs.length - 1];
    const args: FeedCreatedArgs = createLog.args;

    return await PriceFeedContract.at(
      args.feed,
      web3,
      txnFrom(from)
    );
  }

  public async deployMedianizerAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<MedianContract> {
    const medianizer = await Median.new(txnFrom(from));

    return new MedianContract(
      getContractInstance(medianizer),
      txnFrom(from),
    );
  }

  public async deployTimeSeriesFeedAsync(
    dataSourceAddress: Address,
    seededValues: BigNumber[],
    updateInterval: BigNumber = ONE_DAY_IN_SECONDS,
    maxDataPoints: BigNumber = new BigNumber(200),
    dataDescription: string = '200DailyETHPrice',
    from: Address = this._contractOwnerAddress
  ): Promise<TimeSeriesFeedContract> {
    const historicalPriceFeed = await TimeSeriesFeed.new(
      updateInterval,
      maxDataPoints,
      dataSourceAddress,
      dataDescription,
      seededValues,
      txnFrom(from),
    );

    return new TimeSeriesFeedContract(
      getContractInstance(historicalPriceFeed),
      txnFrom(from),
    );
  }

  public async deployLinearizedPriceDataSourceAsync(
    medianizerInstance: Address,
    updateTolerance: BigNumber = ONE_DAY_IN_SECONDS,
    dataDescription: string = '200DailyETHPrice',
    from: Address = this._contractOwnerAddress
  ): Promise<LinearizedPriceDataSourceContract> {
    const linearizedPriceDataSource = await LinearizedPriceDataSource.new(
      updateTolerance,
      medianizerInstance,
      dataDescription,
      txnFrom(from),
    );

    return new LinearizedPriceDataSourceContract(
      getContractInstance(linearizedPriceDataSource),
      txnFrom(from),
    );
  }

  public async deployLinearizedEMATimeSeriesFeedAsync(
    medianizerInstance: Address,
    emaTimePeriod: BigNumber,
    seededValues: BigNumber[],
    interpolationThreshold: BigNumber = ONE_HOUR_IN_SECONDS.mul(3),
    updateInterval: BigNumber = ONE_DAY_IN_SECONDS,
    maxDataPoints: BigNumber = new BigNumber(200),
    dataDescription: string = '200DailyETHPrice',
    nextEarliestUpdate: BigNumber = SetTestUtils.generateTimestamp(updateInterval.toNumber() / 60),
    from: Address = this._contractOwnerAddress
  ): Promise<LinearizedEMATimeSeriesFeedContract> {
    const linearizedEMATimeSeriesFeed = await LinearizedEMATimeSeriesFeed.new(
      updateInterval,
      nextEarliestUpdate,
      maxDataPoints,
      seededValues,
      emaTimePeriod,
      interpolationThreshold,
      medianizerInstance,
      dataDescription,
      txnFrom(from),
    );

    return new LinearizedEMATimeSeriesFeedContract(
      getContractInstance(linearizedEMATimeSeriesFeed),
      txnFrom(from),
    );
  }

  public async deployHistoricalPriceFeedAsync(
    updateFrequency: BigNumber,
    medianizerAddress: Address,
    dataDescription: string,
    seededValues: BigNumber[],
    from: Address = this._contractOwnerAddress
  ): Promise<HistoricalPriceFeedContract> {
    const historicalPriceFeed = await HistoricalPriceFeed.new(
      updateFrequency,
      medianizerAddress,
      dataDescription,
      seededValues,
      txnFrom(from),
    );

    return new HistoricalPriceFeedContract(
      getContractInstance(historicalPriceFeed),
      txnFrom(from),
    );
  }

  public async deployTwoAssetLinearizedTimeSeriesFeedAsync(
    baseMedianizerInstance: Address,
    quoteMedianizerInstance: Address,
    seededValues: BigNumber[],
    interpolationThreshold: BigNumber = ONE_HOUR_IN_SECONDS.mul(3),
    updateInterval: BigNumber = ONE_DAY_IN_SECONDS,
    maxDataPoints: BigNumber = new BigNumber(200),
    dataDescription: string = '200DailyETHBTCPrice',
    nextEarliestUpdate: BigNumber = SetTestUtils.generateTimestamp(updateInterval.toNumber() / 60),
    from: Address = this._contractOwnerAddress
  ): Promise<TwoAssetLinearizedTimeSeriesFeedContract> {
    const twoAssetLinearizedTimeSeriesFeed = await TwoAssetLinearizedTimeSeriesFeed.new(
      updateInterval,
      nextEarliestUpdate,
      maxDataPoints,
      seededValues,
      interpolationThreshold,
      baseMedianizerInstance,
      quoteMedianizerInstance,
      dataDescription,
      txnFrom(from),
    );

    return new TwoAssetLinearizedTimeSeriesFeedContract(
      getContractInstance(twoAssetLinearizedTimeSeriesFeed),
      txnFrom(from),
    );
  }

  public async deployTwoAssetRatioOracleAsync(
    baseMedianizerInstance: Address,
    quoteMedianizerInstance: Address,
    dataDescription: string,
    from: Address = this._contractOwnerAddress
  ): Promise<TwoAssetRatioOracleContract> {
    const twoAssetRatioOracle = await TwoAssetRatioOracle.new(
      baseMedianizerInstance,
      quoteMedianizerInstance,
      dataDescription,
      txnFrom(from),
    );

    return new TwoAssetRatioOracleContract(
      getContractInstance(twoAssetRatioOracle),
      txnFrom(from),
    );
  }

  public async deployMovingAverageOracleAsync(
    priceFeedAddress: Address,
    dataDescription: string,
    from: Address = this._contractOwnerAddress
  ): Promise<MovingAverageOracleContract> {
    const movingAverageOracle = await MovingAverageOracle.new(
      priceFeedAddress,
      dataDescription,
      txnFrom(from),
    );

    return new MovingAverageOracleContract(
      getContractInstance(movingAverageOracle),
      txnFrom(from),
    );
  }

  public async deployMovingAverageOracleV1ProxyAsync(
    metaOracle: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<MovingAverageOracleV1ProxyContract> {
    const movingAverageOracleProxy = await MovingAverageOracleV1Proxy.new(
      metaOracle,
      txnFrom(from),
    );

    return new MovingAverageOracleV1ProxyContract(
      getContractInstance(movingAverageOracleProxy),
      txnFrom(from),
    );
  }

  public async deployMovingAverageOracleV2Async(
    timeSeriesFeedAddress: Address,
    dataDescription: string,
    from: Address = this._contractOwnerAddress
  ): Promise<MovingAverageOracleV2Contract> {
    const movingAverageOracle = await MovingAverageOracleV2.new(
      timeSeriesFeedAddress,
      dataDescription,
      txnFrom(from),
    );

    return new MovingAverageOracleV2Contract(
      getContractInstance(movingAverageOracle),
      txnFrom(from),
    );
  }

  public async deployEMAOracleAsync(
    timeSeriesFeedAddresses: Address[],
    timeSeriesFeedDays: BigNumber[],
    dataDescription: string = 'ETH Daily EMA',
    from: Address = this._contractOwnerAddress
  ): Promise<EMAOracleContract> {
    const emaOracle = await EMAOracle.new(
      timeSeriesFeedAddresses,
      timeSeriesFeedDays,
      dataDescription,
      txnFrom(from),
    );

    return new EMAOracleContract(
      getContractInstance(emaOracle),
      txnFrom(from),
    );
  }

  public async deployLegacyMakerOracleAdapterAsync(
    medianizerAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<LegacyMakerOracleAdapterContract> {
    const legacyMakerOracleAdapter = await LegacyMakerOracleAdapter.new(
      medianizerAddress,
      txnFrom(from),
    );

    return new LegacyMakerOracleAdapterContract(
      getContractInstance(legacyMakerOracleAdapter),
      txnFrom(from),
    );
  }

  public async deployOracleProxyAsync(
    oracleAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<OracleProxyContract> {
    const oracleProxy = await OracleProxy.new(
      oracleAddress,
      txnFrom(from),
    );

    return new OracleProxyContract(
      getContractInstance(oracleProxy),
      txnFrom(from),
    );
  }

  public async deployConstantPriceOracleAsync(
    constantPrice: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<ConstantPriceOracleContract> {
    const oracle = await ConstantPriceOracle.new(
      constantPrice,
      txnFrom(from),
    );

    return new ConstantPriceOracleContract(
      getContractInstance(oracle),
      txnFrom(from),
    );
  }

  public async deployRSIOracleAsync(
    timeSeriesFeedAddress: Address,
    dataDescription: string,
    from: Address = this._contractOwnerAddress
  ): Promise<RSIOracleContract> {
    const rsiOracle = await RSIOracle.new(
      timeSeriesFeedAddress,
      dataDescription,
      txnFrom(from),
    );

    return new RSIOracleContract(
      getContractInstance(rsiOracle),
      txnFrom(from),
    );
  }

  public async deployCTokenOracleAsync(
    cToken: Address,
    underlyingOracle: Address,
    cTokenFullUnit: BigNumber,
    underlyingFullUnit: BigNumber,
    dataDescription: string = 'CToken',
    from: Address = this._contractOwnerAddress
  ): Promise<CTokenOracleContract> {
    const cTokenOracle = await CTokenOracle.new(
      cToken,
      underlyingOracle,
      cTokenFullUnit,
      underlyingFullUnit,
      dataDescription,
      txnFrom(from),
    );

    return new CTokenOracleContract(
      getContractInstance(cTokenOracle),
      txnFrom(from),
    );
  }

  public async deployDydxOracleAdapterAsync(
    dydxPriceOracleAddress: Address,
    erc20TokenAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<DydxOracleAdapterContract> {
    const dydxOracleAdapter = await DydxOracleAdapter.new(
      dydxPriceOracleAddress,
      erc20TokenAddress,
      txnFrom(from),
    );

    return new DydxOracleAdapterContract(
      getContractInstance(dydxOracleAdapter),
      txnFrom(from),
    );
  }

  public async deployDydxConstantPriceOracleMockAsync(
    oracleValue: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<DydxConstantPriceOracleMockContract> {
    const dydxConstantPriceOracleMock = await DydxConstantPriceOracleMock.new(
      oracleValue,
      txnFrom(from),
    );

    return new DydxConstantPriceOracleMockContract(
      getContractInstance(dydxConstantPriceOracleMock),
      txnFrom(from),
    );
  }

  /* ============ Transactions ============ */

  public async addPriceFeedOwnerToMedianizer(
    medianizer: MedianContract,
    priceFeedSigner: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await medianizer.lift.sendTransactionAsync(
      priceFeedSigner,
      txnFrom(from),
    );
  }

  public async addAuthorizedAddressesToOracleProxy(
    oracleProxy: OracleProxyContract,
    authorizedAddresses: Address[],
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    let i: number;
    for (i = 0; i < authorizedAddresses.length; i++) {
      await oracleProxy.addAuthorizedAddress.sendTransactionAsync(
        authorizedAddresses[i],
        txnFrom(from),
      );
    }
  }

  public async setMedianizerMinimumQuorumAsync(
    medianizer: MedianContract,
    minimum: number,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await medianizer.setMin.sendTransactionAsync(
      new BigNumber(minimum),
      txnFrom(from),
    );
  }

  public async updatePriceFeedAsync(
    priceFeed: PriceFeedContract,
    price: BigNumber,
    timeStamp: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    return await priceFeed.poke.sendTransactionAsync(
      price,
      timeStamp,
      txnFrom(from),
    );
  }

  /*
    This is disconnected from the v1 system where price feeds are updated first and then
    the medianizer reads from each price feed to determine the median. In the new system,
    The oracles are off chain, sign their price updates, and then send them all to the medianizer
    which now expects N (new prices, timestamps, signatures)

    Makes a number of assumptions:
    1. Price update is signed by ownerAccount
    2. Only one price is used to update the price
    3. Only one timestmap is used to update the timestamp
    4. Quorum on price feed is 1
    4. OwnerAccount is added as approved oracle on medianizer
  */
  public async updateMedianizerPriceAsync(
    medianizer: MedianContract,
    price: BigNumber,
    timestamp: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<string> {
    const standardSignature = SetUtils.hashPriceFeedHex(price, timestamp);
    const ecSignature = await setUtils.signMessage(standardSignature, from);

    return await medianizer.poke.sendTransactionAsync(
      [price],
      [timestamp],
      [new BigNumber(ecSignature.v)],
      [ecSignature.r],
      [ecSignature.s],
      txnFrom(from)
    );
  }

  public async updateTimeSeriesFeedAsync(
    timeSeriesFeed: TimeSeriesFeedContract | TimeSeriesFeedV2Contract,
    medianizer: MedianContract,
    price: BigNumber,
    timestamp: number = ONE_DAY_IN_SECONDS.mul(2).toNumber(),
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    await this._blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
    await this.updateMedianizerPriceAsync(
      medianizer,
      price,
      SetTestUtils.generateTimestamp(timestamp),
    );

    await timeSeriesFeed.poke.sendTransactionAsync(
      { gas: DEFAULT_GAS},
    );
  }

  public async batchUpdateTimeSeriesFeedAsync(
    timeSeriesFeed: TimeSeriesFeedContract | TimeSeriesFeedV2Contract,
    medianizer: MedianContract,
    daysOfData: number,
    priceArray: BigNumber[] = undefined,
    from: Address = this._contractOwnerAddress
  ): Promise<BigNumber[]> {

    if (!priceArray) {
      priceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 100) + 100));
    }

    let i: number;
    for (i = 0; i < priceArray.length; i++) {
      await this.updateTimeSeriesFeedAsync(
        timeSeriesFeed,
        medianizer,
        priceArray[i],
        ONE_DAY_IN_SECONDS.mul(2 * i + 2).toNumber()
      );
    }

    return priceArray;
  }

  public async updateTwoAssetTimeSeriesFeedAsync(
    timeSeriesFeed: TimeSeriesFeedContract | TimeSeriesFeedV2Contract,
    baseMedianizer: MedianContract,
    quoteMedianizer: MedianContract,
    basePrice: BigNumber,
    quotePrice: BigNumber,
    timestamp: number = ONE_DAY_IN_SECONDS.mul(2).toNumber(),
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    await this._blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
    await this.updateMedianizerPriceAsync(
      baseMedianizer,
      basePrice,
      SetTestUtils.generateTimestamp(timestamp),
    );
    await this.updateMedianizerPriceAsync(
      quoteMedianizer,
      quotePrice,
      SetTestUtils.generateTimestamp(timestamp),
    );

    await timeSeriesFeed.poke.sendTransactionAsync(
      { gas: DEFAULT_GAS},
    );
  }

  public async batchUpdateTwoAssetTimeSeriesFeedAsync(
    timeSeriesFeed: TimeSeriesFeedContract | TimeSeriesFeedV2Contract,
    baseMedianizer: MedianContract,
    quoteMedianizer: MedianContract,
    daysOfData: number,
    basePriceArray: BigNumber[] = undefined,
    quotePriceArray: BigNumber[] = undefined,
    from: Address = this._contractOwnerAddress
  ): Promise<BigNumber[]> {

    if (!basePriceArray) {
      basePriceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 100) + 100));
    }
    if (!quotePriceArray) {
      quotePriceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 1000) + 8000));
    }

    let i: number;
    const baseQuotePriceArray = [];
    for (i = 0; i < daysOfData; i++) {
      // Create ratio array
      baseQuotePriceArray.push(
        basePriceArray[i]
        .mul(10 ** 18)
        .div(quotePriceArray[i])
        .round(0, BigNumber.ROUND_DOWN)
      );

      await this.updateTwoAssetTimeSeriesFeedAsync(
        timeSeriesFeed,
        baseMedianizer,
        quoteMedianizer,
        basePriceArray[i],
        quotePriceArray[i],
        ONE_DAY_IN_SECONDS.mul(2 * i + 2).toNumber()
      );
    }
    return baseQuotePriceArray;
  }

  public async updateHistoricalPriceFeedAsync(
    dailyPriceFeed: HistoricalPriceFeedContract,
    medianizer: MedianContract,
    price: BigNumber,
    from: Address = this._contractOwnerAddress
  ): Promise<void> {
    await this._blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

    const lastBlock = await web3.eth.getBlock('latest');
    await this.updateMedianizerPriceAsync(
      medianizer,
      price,
      lastBlock.timestamp + 1,
    );

    await dailyPriceFeed.poke.sendTransactionAsync(
      { gas: DEFAULT_GAS},
    );
  }

  public async batchUpdateHistoricalPriceFeedAsync(
    dailyPriceFeed: HistoricalPriceFeedContract,
    medianizer: MedianContract,
    daysOfData: number,
    priceArray: BigNumber[] = undefined,
    from: Address = this._contractOwnerAddress
  ): Promise<BigNumber[]> {

    if (!priceArray) {
      priceArray = Array.from({length: daysOfData}, () => ether(Math.floor(Math.random() * 100) + 100));
    }

    let i: number;
    for (i = 0; i < priceArray.length; i++) {
      await this.updateHistoricalPriceFeedAsync(
        dailyPriceFeed,
        medianizer,
        priceArray[i],
      );
    }

    return priceArray;
  }

  public batchCalculateEMA(
    startEMAValue: BigNumber,
    timePeriod: BigNumber,
    assetPriceArray: BigNumber[]
  ): BigNumber[] {
    const emaValues: BigNumber[] = [];
    let lastEMAValue: BigNumber = startEMAValue;

    for (let i = 0; i < assetPriceArray.length; i++) {
      emaValues.push(
        this.calculateEMA(
          lastEMAValue,
          timePeriod,
          assetPriceArray[i]
        )
      );
      lastEMAValue = emaValues[i];
    }

    return emaValues;
  }

  /*
   * The EMA formula is the following:
   *
   * Weighted Multiplier = 2 / (timePeriod + 1)
   *
   * EMA = Price(Today) x Weighted Multiplier +
   *       EMA(Yesterday) -
   *       EMA(Yesterday) x Weighted Multiplier
   *
   * Our implementation is simplified to the following for efficiency:
   *
   * EMA = (Price(Today) * 2 + EMA(Yesterday) * (timePeriod - 1)) / (timePeriod + 1)
   *
   */
  public calculateEMA(
    previousEMAValue: BigNumber,
    timePeriod: BigNumber,
    currentAssetPrice: BigNumber
  ): BigNumber {
    const a = currentAssetPrice.mul(2);
    const b = previousEMAValue.mul(timePeriod.minus(1));
    const c = timePeriod.plus(1);

    return a.plus(b).div(c).round(0, 3);
  }

  /*
   * Calculates the new relative strength index value using
   * an array of prices.
   *
   * RSI = 100 − 100 /
   *       (1 + (Gain / Loss))
   *
   * Price Difference = Price(N) - Price(N-1) where N is number of days
   * Gain = Sum(Positive Price Difference)
   * Loss = -1 * Sum(Negative Price Difference)
   *
   *
   * Our implementation is simplified to the following for efficiency
   * RSI = (100 * SUM(Gain)) / (SUM(Loss) + SUM(Gain)
   */

  public calculateRSI(
    rsiDataArray: BigNumber[],
  ): BigNumber {
    let positiveDataSum = new BigNumber(0);
    let negativeDataSum = new BigNumber(0);

    for (let i = 1; i < rsiDataArray.length; i++) {
      if (rsiDataArray[i - 1].gte(rsiDataArray[i])) {
        positiveDataSum = positiveDataSum.add(rsiDataArray[i - 1]).sub(rsiDataArray[i]);
      }
      else {
        negativeDataSum = negativeDataSum.add(rsiDataArray[i]).sub(rsiDataArray[i - 1]);
      }
    }

    if (negativeDataSum.eq(0) && positiveDataSum.eq(0)) {
      negativeDataSum = new BigNumber(1);
    }

    const bigHundred = new BigNumber(100);

    const a = bigHundred.mul(positiveDataSum);
    const b = positiveDataSum.add(negativeDataSum);
    const c = a.div(b).round(0, BigNumber.ROUND_DOWN);

    return c;
  }
}
