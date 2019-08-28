require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
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
  LinearizedPriceDataSourceContract,
  OracleProxyContract,
  TimeSeriesFeedContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const FeedFactory = artifacts.require('FeedFactory');

contract('TimeSeriesFeed', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(FeedFactory.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(FeedFactory.abi);
  });

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

    const interpolationThreshold = ONE_DAY_IN_SECONDS;
    linearizedDataSource = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
      oracleProxy.address,
      interpolationThreshold,
    );

    await oracleWrapper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [linearizedDataSource.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectUpdateInterval: BigNumber;
    let subjectMaxDataPoints: BigNumber;
    let subjectDataSourceAddress: Address;
    let subjectDataDescription: string;
    let subjectSeededValues: BigNumber[];

    beforeEach(async () => {
      subjectUpdateInterval = ONE_DAY_IN_SECONDS.div(4);
      subjectMaxDataPoints = new BigNumber(200);
      subjectDataSourceAddress = linearizedDataSource.address;
      subjectDataDescription = '200DailyETHPrice';
      subjectSeededValues = [ether(150)];
    });

    async function subject(): Promise<TimeSeriesFeedContract> {
      return oracleWrapper.deployTimeSeriesFeedAsync(
        subjectDataSourceAddress,
        subjectSeededValues,
        subjectUpdateInterval,
        subjectMaxDataPoints,
        subjectDataDescription,
      );
    }

    it('sets the correct updateInterval', async () => {
      timeSeriesFeed = await subject();

      const actualUpdateFrequency = await timeSeriesFeed.updateInterval.callAsync();

      expect(actualUpdateFrequency).to.be.bignumber.equal(subjectUpdateInterval);
    });

    it('sets the correct dataSource address', async () => {
      timeSeriesFeed = await subject();

      const actualDataSourceAddress = await timeSeriesFeed.dataSourceInstance.callAsync();

      expect(actualDataSourceAddress).to.equal(subjectDataSourceAddress);
    });

    it('sets the correct maxDataPoints', async () => {
      timeSeriesFeed = await subject();

      const actualMaxDataPoints = await timeSeriesFeed.maxDataPoints.callAsync();

      expect(actualMaxDataPoints).to.bignumber.equal(subjectMaxDataPoints);
    });

    it('sets the correct data description', async () => {
      timeSeriesFeed = await subject();

      const actualDataDescription = await timeSeriesFeed.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });

    it('sets the nextEarliestUpdate timestamp to the block timestamp', async () => {
      timeSeriesFeed = await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp).plus(subjectUpdateInterval);

      const actualTimestamp = await timeSeriesFeed.nextEarliestUpdate.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    it('sets the correct price array', async () => {
      timeSeriesFeed = await subject();

      const daysOfData = new BigNumber(1);
      const actualPriceArray = await timeSeriesFeed.read.callAsync(daysOfData);

      const expectedPriceArray = subjectSeededValues;

      expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
    });

    describe('when the price feed is seeded with values', async () => {
      beforeEach(async () => {
        subjectSeededValues = [ether(160), ether(170), ether(165)];
      });

      it('should set the correct price array with 4 values', async () => {
        timeSeriesFeed = await subject();

        const daysOfData = new BigNumber(3);
        const actualPriceArray = await timeSeriesFeed.read.callAsync(daysOfData);

        const expectedPriceArray = subjectSeededValues.reverse();

        expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
      });
    });

    describe('when no seeded values are passed', async () => {
      beforeEach(async () => {
        subjectSeededValues = [];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#poke', async () => {
    let initialEthPrice: BigNumber;
    let newEthPrice: BigNumber;
    let updateInterval: BigNumber;

    let subjectTimeFastForward: BigNumber;

    beforeEach(async () => {
      initialEthPrice = ether(150);

      updateInterval = ONE_DAY_IN_SECONDS;
      const maxDataPoints = new BigNumber(200);
      const sourceDataAddress = linearizedDataSource.address;
      const dataDescription = '200DailyETHPrice';
      const seededValues = [initialEthPrice];
      timeSeriesFeed = await oracleWrapper.deployTimeSeriesFeedAsync(
        sourceDataAddress,
        seededValues,
        updateInterval,
        maxDataPoints,
        dataDescription,
      );

      newEthPrice = ether(160);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(ONE_DAY_IN_SECONDS.mul(2).toNumber()),
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return timeSeriesFeed.poke.sendTransactionAsync(
        { gas: DEFAULT_GAS}
      );
    }

    it('updates the timeSeriesFeed with the correct price', async () => {
      await subject();

      const actualNewPrice = await timeSeriesFeed.read.callAsync(new BigNumber(2));
      const expectedNewPrice = [newEthPrice, initialEthPrice];

      expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
    });

    it('sets the nextEarliestUpdate timestamp to the block timestamp', async () => {
      const previousTimestamp = await timeSeriesFeed.nextEarliestUpdate.callAsync();

      await subject();

      const expectedTimestamp = previousTimestamp.plus(updateInterval);

      const actualTimestamp = await timeSeriesFeed.nextEarliestUpdate.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('when not enough time has passed to update', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = new BigNumber(1);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#read', async () => {
    let ethPrice: BigNumber;
    let updatedPrices: BigNumber[];

    let subjectDataDays: BigNumber;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const updateInterval = ONE_DAY_IN_SECONDS;
      const maxDataPoints = new BigNumber(200);
      const sourceDataAddress = linearizedDataSource.address;
      const dataDescription = '200DailyETHPrice';
      const seededValues = [ethPrice];
      timeSeriesFeed = await oracleWrapper.deployTimeSeriesFeedAsync(
        sourceDataAddress,
        seededValues,
        updateInterval,
        maxDataPoints,
        dataDescription,
      );

      updatedPrices = await oracleWrapper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        20,
      );

      subjectDataDays = new BigNumber(20);
    });

    async function subject(): Promise<BigNumber[]> {
      return timeSeriesFeed.read.callAsync(
        subjectDataDays,
        { gas: DEFAULT_GAS}
      );
    }

    it('returns the correct array', async () => {
      const actualDailyPriceOutput = await subject();

      const expectedDailyPriceOutput = updatedPrices.slice(-subjectDataDays.toNumber()).reverse();

      expect(JSON.stringify(actualDailyPriceOutput)).to.equal(JSON.stringify(expectedDailyPriceOutput));
    });

    describe('when querying more data than available', async () => {
      beforeEach(async () => {
        subjectDataDays = new BigNumber(22);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#getTimeSeriesFeedState', async () => {
    let ethPrice: BigNumber;
    const numberOfUpdates: number = 20;

    let maxDataPoints: BigNumber;
    let updateInterval: BigNumber;
    let updatedPrices: BigNumber[];

    beforeEach(async () => {
      ethPrice = ether(150);

      updateInterval = ONE_DAY_IN_SECONDS;
      maxDataPoints = new BigNumber(200);
      const sourceDataAddress = linearizedDataSource.address;
      const dataDescription = '200DailyETHPrice';
      const seededValues = [ethPrice];
      timeSeriesFeed = await oracleWrapper.deployTimeSeriesFeedAsync(
        sourceDataAddress,
        seededValues,
        updateInterval,
        maxDataPoints,
        dataDescription,
      );

      updatedPrices = await oracleWrapper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        numberOfUpdates,
      );
    });

    async function subject(): Promise<any> {
      return timeSeriesFeed.getTimeSeriesFeedState.callAsync();
    }

    it('returns the correct TimeSeriesState struct', async () => {
      const timeSeriesState = await subject();

      const [actualNextEarliestUpdate, actualUpdateInterval, timeSeriesData] = timeSeriesState;

      const expectedNextEarliestUpdate = await timeSeriesFeed.nextEarliestUpdate.callAsync();

      const expectedDataArray = [ethPrice].concat(updatedPrices);

      expect(actualNextEarliestUpdate).to.be.bignumber.equal(expectedNextEarliestUpdate);
      expect(actualUpdateInterval).to.be.bignumber.equal(updateInterval);
      expect(JSON.stringify(timeSeriesData.dataArray)).to.equal(JSON.stringify(expectedDataArray));
      expect(timeSeriesData.lastUpdatedIndex).to.bignumber.equal(numberOfUpdates);
      expect(timeSeriesData.dataSizeLimit).to.bignumber.equal(maxDataPoints);
    });
  });
});