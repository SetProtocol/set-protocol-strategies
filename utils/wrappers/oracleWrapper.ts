import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import { MedianContract } from 'set-protocol-contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';

import {
  FeedFactoryContract,
  HistoricalPriceFeedContract,
  LegacyMakerOracleAdapterContract,
  LinearizedEMADataSourceContract,
  LinearizedPriceDataSourceContract,
  MovingAverageOracleContract,
  MovingAverageOracleV2Contract,
  OracleProxyCallerContract,
  OracleProxyContract,
  PriceFeedContract,
  TimeSeriesFeedContract,
} from '../contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
} from '@utils/constants';
import { getWeb3 } from '../web3Helper';
import { FeedCreatedArgs } from '../contract_logs/oracle';

const web3 = getWeb3();
const HistoricalPriceFeed = artifacts.require('HistoricalPriceFeed');
const FeedFactory = artifacts.require('FeedFactory');
const LegacyMakerOracleAdapter = artifacts.require('LegacyMakerOracleAdapter');
const LinearizedEMADataSource = artifacts.require('LinearizedEMADataSource');
const LinearizedPriceDataSource = artifacts.require('LinearizedPriceDataSource');
const Median = artifacts.require('Median');
const MovingAverageOracle = artifacts.require('MovingAverageOracle');
const MovingAverageOracleV2 = artifacts.require('MovingAverageOracleV2');
const OracleProxy = artifacts.require('OracleProxy');
const OracleProxyCaller = artifacts.require('OracleProxyCaller');
const TimeSeriesFeed = artifacts.require('TimeSeriesFeed');


const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);
const setUtils = new SetUtils(web3);


export class OracleWrapper {
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
    const feedFactory = await FeedFactory.new(
      { from },
    );

    return new FeedFactoryContract(
      new web3.eth.Contract(feedFactory.abi, feedFactory.address),
      { from },
    );
  }

  public async deployPriceFeedAsync(
    feedFactory: FeedFactoryContract,
    from: Address = this._contractOwnerAddress
  ): Promise<PriceFeedContract> {
    const txHash = await feedFactory.create.sendTransactionAsync(
      { from },
    );

    const logs = await setTestUtils.getLogsFromTxHash(txHash);
    const createLog = logs[logs.length - 1];
    const args: FeedCreatedArgs = createLog.args;

    return await PriceFeedContract.at(
      args.feed,
      web3,
      { from }
    );
  }

  public async deployMedianizerAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<MedianContract> {
    const medianizer = await Median.new(
      { from },
    );

    return new MedianContract(
      new web3.eth.Contract(medianizer.abi, medianizer.address),
      { from },
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
      { from },
    );

    return new TimeSeriesFeedContract(
      new web3.eth.Contract(historicalPriceFeed.abi, historicalPriceFeed.address),
      { from },
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
      { from },
    );

    return new LinearizedPriceDataSourceContract(
      new web3.eth.Contract(linearizedPriceDataSource.abi, linearizedPriceDataSource.address),
      { from },
    );
  }

  public async deployLinearizedEMADataSourceAsync(
    medianizerInstance: Address,
    emaDays: BigNumber,
    updateTolerance: BigNumber = ONE_DAY_IN_SECONDS,
    dataDescription: string = '200DailyETHPrice',
    from: Address = this._contractOwnerAddress
  ): Promise<LinearizedEMADataSourceContract> {
    const linearizedEMADataSource = await LinearizedEMADataSource.new(
      emaDays,
      updateTolerance,
      medianizerInstance,
      dataDescription,
      { from },
    );

    return new LinearizedEMADataSourceContract(
      new web3.eth.Contract(linearizedEMADataSource.abi, linearizedEMADataSource.address),
      { from },
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
      { from },
    );

    return new HistoricalPriceFeedContract(
      new web3.eth.Contract(historicalPriceFeed.abi, historicalPriceFeed.address),
      { from },
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
      { from },
    );

    return new MovingAverageOracleContract(
      new web3.eth.Contract(movingAverageOracle.abi, movingAverageOracle.address),
      { from },
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
      { from },
    );

    return new MovingAverageOracleV2Contract(
      new web3.eth.Contract(movingAverageOracle.abi, movingAverageOracle.address),
      { from },
    );
  }

  public async deployLegacyMakerOracleAdapterAsync(
    medianizerAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<LegacyMakerOracleAdapterContract> {
    const legacyMakerOracleAdapter = await LegacyMakerOracleAdapter.new(
      medianizerAddress,
      { from },
    );

    return new LegacyMakerOracleAdapterContract(
      new web3.eth.Contract(legacyMakerOracleAdapter.abi, legacyMakerOracleAdapter.address),
      { from },
    );
  }

  public async deployOracleProxyAsync(
    oracleAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<OracleProxyContract> {
    const oracleProxy = await OracleProxy.new(
      oracleAddress,
      { from },
    );

    return new OracleProxyContract(
      new web3.eth.Contract(oracleProxy.abi, oracleProxy.address),
      { from },
    );
  }

  public async deployOracleProxyCallerAsync(
    oracleAddress: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<OracleProxyCallerContract> {
    const oracleProxy = await OracleProxyCaller.new(
      oracleAddress,
      { from },
    );

    return new OracleProxyCallerContract(
      new web3.eth.Contract(oracleProxy.abi, oracleProxy.address),
      { from },
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
      { from },
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
        { from },
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
      { from },
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
      { from },
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
      { from }
    );
  }

  public async updateTimeSeriesFeedAsync(
    timeSeriesFeed: TimeSeriesFeedContract,
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
    timeSeriesFeed: TimeSeriesFeedContract,
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

  public calculateEMA(
    previousEMAValue: BigNumber,
    timePeriod: BigNumber,
    currentAssetPrice: BigNumber
  ): BigNumber {
    const weightedNumerator: BigNumber = new BigNumber(2);
    const weightedDenominator: BigNumber = timePeriod.plus(1);

    const currentWeightedValue = currentAssetPrice
                                   .mul(weightedNumerator).div(weightedDenominator).round(0, 3);

    const previousWeightedValue = previousEMAValue
                                   .mul(weightedNumerator).div(weightedDenominator).round(0, 3);

    return currentWeightedValue.add(previousEMAValue).sub(previousWeightedValue);
  }
}
