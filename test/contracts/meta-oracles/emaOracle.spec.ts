require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  LinearizedEMADataSourceContract,
  EMAOracleContract,
  OracleProxyContract,
  TimeSeriesFeedContract
} from '@utils/contracts';
import { ZERO, ONE_DAY_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('EMAOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let ema26DayDataSource: LinearizedEMADataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let emaOracle: EMAOracleContract;

  let initialEMAValue: BigNumber;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  const emaTimePeriodOne = new BigNumber(26);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    legacyMakerOracleAdapter = await oracleWrapper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleWrapper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    const interpolationThreshold = ONE_DAY_IN_SECONDS.mul(3);
    ema26DayDataSource = await oracleWrapper.deployLinearizedEMADataSourceAsync(
      oracleProxy.address,
      emaTimePeriodOne,
      interpolationThreshold,
    );

    await oracleWrapper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [ema26DayDataSource.address]
    );

    initialEMAValue = ether(150);
    const seededValues = [initialEMAValue];
    timeSeriesFeed = await oracleWrapper.deployTimeSeriesFeedAsync(
      ema26DayDataSource.address,
      seededValues
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectTimeSeriesFeedAddresses: Address[];
    let subjectTimeSeriesFeedDays: BigNumber[];
    let subjectDataDescription: string;

    let ema13DayDataSource: LinearizedEMADataSourceContract;
    let timeSeriesFeedTwo: TimeSeriesFeedContract;

    const emaTimePeriodTwo = new BigNumber(13);
    const initialEMAValueTwo = ether(300);

    beforeEach(async () => {
      const interpolationThreshold = ONE_DAY_IN_SECONDS;
      ema13DayDataSource = await oracleWrapper.deployLinearizedEMADataSourceAsync(
        oracleProxy.address,
        emaTimePeriodTwo,
        interpolationThreshold,
      );

      await oracleWrapper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [ema13DayDataSource.address]
      );

      const seededValues = [initialEMAValue];
      timeSeriesFeedTwo = await oracleWrapper.deployTimeSeriesFeedAsync(
        ema13DayDataSource.address,
        seededValues
      );

      subjectTimeSeriesFeedAddresses = [timeSeriesFeed.address, timeSeriesFeedTwo.address];
      subjectTimeSeriesFeedDays = [emaTimePeriodOne, emaTimePeriodTwo];
      subjectDataDescription = 'ETHEMAOracle';
    });

    async function subject(): Promise<EMAOracleContract> {
      return oracleWrapper.deployEMAOracleAsync(
        subjectTimeSeriesFeedAddresses,
        subjectTimeSeriesFeedDays,
        subjectDataDescription
      );
    }

    it('sets the correct time series feed addresses', async () => {
      emaOracle = await subject();

      const actualPriceFeedAddressOne = await emaOracle.emaTimeSeriesFeeds.callAsync(emaTimePeriodOne);
      expect(actualPriceFeedAddressOne).to.equal(timeSeriesFeed.address);

      const actualPriceFeedAddressTwo = await emaOracle.emaTimeSeriesFeeds.callAsync(emaTimePeriodTwo);
      expect(actualPriceFeedAddressTwo).to.equal(timeSeriesFeedTwo.address);
    });

    it('sets the correct data description', async () => {
      emaOracle = await subject();

      const actualDataDescription = await emaOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let updatedValues: BigNumber[];

    let subjectDataPoints: BigNumber;
    let newestEthPrice = ether(500);
    let previousEMAValue: BigNumber;

    beforeEach(async () => {
      subjectDataPoints = emaTimePeriodOne;

      const dataDescription = 'EMA Oracle';
      emaOracle = await oracleWrapper.deployEMAOracleAsync(
        [timeSeriesFeed.address],
        [emaTimePeriodOne],
        dataDescription
      );

      previousEMAValue = await emaOracle.read.callAsync(subjectDataPoints);

      updatedValues = await oracleWrapper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        1,
        [newestEthPrice]
      );
    });

    async function subject(): Promise<BigNumber> {
      return emaOracle.read.callAsync(
        subjectDataPoints
      );
    }

    it('returns the correct moving average', async () => {
      const actualEMA = await subject();

      const expectedEMA = oracleWrapper.calculateEMA(
        previousEMAValue,
        subjectDataPoints,
        newestEthPrice,
      );

      expect(actualEMA).to.be.bignumber.equal(expectedEMA);
    });
  });
});