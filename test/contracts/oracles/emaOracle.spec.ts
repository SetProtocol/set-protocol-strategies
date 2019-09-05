require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import * as ABIDecoder from 'abi-decoder';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  LinearizedEMATimeSeriesFeedContract,
  EMAOracleContract,
  OracleProxyContract
} from '@utils/contracts';
import { NULL_ADDRESS, DEFAULT_GAS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';
import { expectRevertError } from '@utils/tokenAssertions';

import { OracleHelper } from '@utils/helpers/oracleHelper';

import { FeedAdded, FeedRemoved } from '@utils/contract_logs/emaOracle';

const EMAOracle = artifacts.require('EMAOracle');
BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('EMAOracle', accounts => {
  const [
    deployerAccount,
    fillerValue,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let ema26DayTimeSeriesFeed: LinearizedEMATimeSeriesFeedContract;
  let emaOracle: EMAOracleContract;

  let initialEMAValue: BigNumber;

  const oracleHelper = new OracleHelper(deployerAccount);

  const emaTimePeriodOne = new BigNumber(26);

  before(async () => {
    ABIDecoder.addABI(EMAOracle.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(EMAOracle.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleHelper.deployMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    legacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleHelper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    initialEMAValue = ether(150);
    const seededValues = [initialEMAValue];
    ema26DayTimeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
      oracleProxy.address,
      emaTimePeriodOne,
      seededValues,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [ema26DayTimeSeriesFeed.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectTimeSeriesFeedAddresses: Address[];
    let subjectTimeSeriesFeedDays: BigNumber[];
    let subjectDataDescription: string;

    let ema13DayTimeSeriesFeed: LinearizedEMATimeSeriesFeedContract;

    const emaTimePeriodTwo = new BigNumber(13);

    beforeEach(async () => {
      const seededValues = [initialEMAValue];
      ema13DayTimeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
        oracleProxy.address,
        emaTimePeriodTwo,
        seededValues,
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [ema13DayTimeSeriesFeed.address]
      );

      subjectTimeSeriesFeedAddresses = [ema26DayTimeSeriesFeed.address, ema13DayTimeSeriesFeed.address];
      subjectTimeSeriesFeedDays = [emaTimePeriodOne, emaTimePeriodTwo];
      subjectDataDescription = 'ETHEMAOracle';
    });

    async function subject(): Promise<EMAOracleContract> {
      return oracleHelper.deployEMAOracleAsync(
        subjectTimeSeriesFeedAddresses,
        subjectTimeSeriesFeedDays,
        subjectDataDescription
      );
    }

    it('sets the correct time series feed addresses', async () => {
      emaOracle = await subject();

      const actualPriceFeedAddressOne = await emaOracle.emaTimeSeriesFeeds.callAsync(emaTimePeriodOne);
      expect(actualPriceFeedAddressOne).to.equal(ema26DayTimeSeriesFeed.address);

      const actualPriceFeedAddressTwo = await emaOracle.emaTimeSeriesFeeds.callAsync(emaTimePeriodTwo);
      expect(actualPriceFeedAddressTwo).to.equal(ema13DayTimeSeriesFeed.address);
    });

    it('sets the correct data description', async () => {
      emaOracle = await subject();

      const actualDataDescription = await emaOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });

    describe('when the input lengths differ', async () => {
      beforeEach(async () => {
        subjectTimeSeriesFeedDays = [emaTimePeriodOne, emaTimePeriodTwo, new BigNumber(3)];
      });

      it('reverts', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#read', async () => {
    let subjectDataPoints: BigNumber;
    const newestEthPrice = ether(500);
    let previousEMAValue: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectDataPoints = emaTimePeriodOne;
      subjectCaller = deployerAccount;

      const dataDescription = 'EMA Oracle';
      emaOracle = await oracleHelper.deployEMAOracleAsync(
        [ema26DayTimeSeriesFeed.address],
        [emaTimePeriodOne],
        dataDescription
      );

      previousEMAValue = await emaOracle.read.callAsync(subjectDataPoints);

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        ema26DayTimeSeriesFeed,
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

    it('returns the correct EMA value', async () => {
      const actualEMA = await subject();

      const expectedEMA = oracleHelper.calculateEMA(
        previousEMAValue,
        subjectDataPoints,
        newestEthPrice,
      );

      expect(actualEMA).to.be.bignumber.equal(expectedEMA);
    });

    describe('when a feed has not been added', async () => {
      beforeEach(async () => {
        await emaOracle.removeFeed.sendTransactionAsync(
          subjectDataPoints,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      });

      it('reverts', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#addFeed', async () => {
    let subjectFeedAddress: Address;
    let subjectEMADays: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      const dataDescription = 'EMA Oracle';
      emaOracle = await oracleHelper.deployEMAOracleAsync(
        [ema26DayTimeSeriesFeed.address],
        [emaTimePeriodOne],
        dataDescription
      );

      subjectFeedAddress = fillerValue;
      subjectEMADays = new BigNumber(13);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return emaOracle.addFeed.sendTransactionAsync(
        subjectFeedAddress,
        subjectEMADays,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );
    }

    it('adds the feed correctly', async () => {
      await subject();

      const currentFeedValue = await emaOracle.emaTimeSeriesFeeds.callAsync(subjectEMADays);

      expect(currentFeedValue).to.equal(subjectFeedAddress);
    });

    it('emits the FeedAdded event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = FeedAdded(
        subjectFeedAddress,
        subjectEMADays,
        emaOracle.address,
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('when a feed has already been added', async () => {
      beforeEach(async () => {
        await emaOracle.addFeed.sendTransactionAsync(
          subjectFeedAddress,
          subjectEMADays,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      });

      it('reverts', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#removeFeed', async () => {
    let subjectFeedAddress: Address;
    let subjectEMADays: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCaller = deployerAccount;

      const dataDescription = 'EMA Oracle';
      emaOracle = await oracleHelper.deployEMAOracleAsync(
        [ema26DayTimeSeriesFeed.address],
        [emaTimePeriodOne],
        dataDescription
      );

      subjectFeedAddress = fillerValue;
      subjectEMADays = new BigNumber(13);

      await emaOracle.addFeed.sendTransactionAsync(
        subjectFeedAddress,
        subjectEMADays,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );
    });

    async function subject(): Promise<string> {
      return emaOracle.removeFeed.sendTransactionAsync(
        subjectEMADays,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );
    }

    it('removes the feed correctly', async () => {
      await subject();

      const currentFeedValue = await emaOracle.emaTimeSeriesFeeds.callAsync(subjectEMADays);

      expect(currentFeedValue).to.equal(NULL_ADDRESS);
    });

    it('emits the FeedRemoved event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = FeedRemoved(
        subjectFeedAddress,
        subjectEMADays,
        emaOracle.address,
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('when a feed has not been added', async () => {
      beforeEach(async () => {
        await emaOracle.removeFeed.sendTransactionAsync(
          subjectEMADays,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      });

      it('reverts', async () => {
        await expectRevertError(subject());
      });
    });
  });
});