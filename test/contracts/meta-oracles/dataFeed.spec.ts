require('module-alias/register');

import * as _ from 'lodash';
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
  DataFeedContract,
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

contract('DataFeed', accounts => {
  const [
    deployerAccount,
    medianizerAccount,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let historicalPriceFeed: DataFeedContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);


  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let ethPrice: BigNumber;

    let subjectUpdatePeriod: BigNumber;
    let subjectMaxDataPoints: BigNumber;
    let subjectDataSourceAddress: Address;
    let subjectDataDescription: string;
    let subjectSeededValues: BigNumber[];

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      subjectUpdatePeriod = ONE_DAY_IN_SECONDS.div(4);
      subjectMaxDataPoints = new BigNumber(200);
      subjectDataSourceAddress = ethMedianizer.address;
      subjectDataDescription = '200DailyETHPrice';
      subjectSeededValues = [];
    });

    async function subject(): Promise<DataFeedContract> {
      return oracleWrapper.deployDataFeedAsync(
        subjectDataSourceAddress,
        subjectUpdatePeriod,
        subjectMaxDataPoints,
        subjectDataDescription,
        subjectSeededValues,
      );
    }

    it('sets the correct updatePeriod', async () => {
      historicalPriceFeed = await subject();

      const actualUpdateFrequency = await historicalPriceFeed.updatePeriod.callAsync();

      expect(actualUpdateFrequency).to.be.bignumber.equal(subjectUpdatePeriod);
    });

    it('sets the correct dataSource address', async () => {
      historicalPriceFeed = await subject();

      const actualDataSourceAddress = await historicalPriceFeed.dataSource.callAsync();

      expect(actualDataSourceAddress).to.equal(subjectDataSourceAddress);
    });

    it('sets the correct maxDataPoints', async () => {
      historicalPriceFeed = await subject();

      const actualMaxDataPoints = await historicalPriceFeed.maxDataPoints.callAsync();

      expect(actualMaxDataPoints).to.equal(subjectMaxDataPoints);
    });

    it('sets the correct data description', async () => {
      historicalPriceFeed = await subject();

      const actualDataDescription = await historicalPriceFeed.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });

    it('sets the lastUpdatedAt timestamp to the block timestamp', async () => {
      historicalPriceFeed = await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp);

      const actualTimestamp = await historicalPriceFeed.lastUpdatedAt.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    it('sets the correct price array', async () => {
      historicalPriceFeed = await subject();

      const daysOfData = new BigNumber(1);
      const actualPriceArray = await historicalPriceFeed.read.callAsync(daysOfData);

      const expectedPriceArray = [ethPrice];

      expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
    });

    describe('when the price feed is seeded with values', async () => {
      beforeEach(async () => {
        subjectSeededValues = [ether(160), ether(170), ether(165)];
      });

      it('should set the correct price array with 4 values', async () => {
        historicalPriceFeed = await subject();

        const daysOfData = new BigNumber(4);
        const actualPriceArray = await historicalPriceFeed.read.callAsync(daysOfData);

        const expectedPriceArray = [ethPrice].concat(subjectSeededValues.reverse());

        expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
      });
    });
  });

  describe('#poke', async () => {
    let initialEthPrice: BigNumber;
    let newEthPrice: BigNumber;

    let subjectTimeFastForward: BigNumber;

    beforeEach(async () => {
      initialEthPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        initialEthPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const updateFrequency = ONE_DAY_IN_SECONDS;
      const medianizerAddress = ethMedianizer.address;
      const dataDescription = '200DailyETHPrice';
      const seededValues = [];
      historicalPriceFeed = await oracleWrapper.deployDataFeedAsync(
        updateFrequency,
        medianizerAddress,
        dataDescription,
        seededValues
      );

      newEthPrice = ether(160);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return historicalPriceFeed.poke.sendTransactionAsync(
        { gas: DEFAULT_GAS}
      );
    }

    it('updates the historicalPriceFeed with the correct price', async () => {
      await subject();

      const actualNewPrice = await historicalPriceFeed.read.callAsync(new BigNumber(2));
      const expectedNewPrice = [newEthPrice, initialEthPrice];

      expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
    });

    it('sets the lastUpdatedAt timestamp to the block timestamp', async () => {
      await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp);

      const actualTimestamp = await historicalPriceFeed.lastUpdatedAt.callAsync();

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

      const updateFrequency = ONE_DAY_IN_SECONDS;
      const medianizerAddress = ethMedianizer.address;
      const dataDescription = '200DailyETHPrice';
      const seededValues = [];
      historicalPriceFeed = await oracleWrapper.deployDataFeedAsync(
        updateFrequency,
        medianizerAddress,
        dataDescription,
        seededValues,
      );

      updatedPrices = await oracleWrapper.batchUpdateDataFeedAsync(
        historicalPriceFeed,
        ethMedianizer,
        20,
      );

      subjectDataDays = new BigNumber(20);
    });

    async function subject(): Promise<BigNumber[]> {
      return historicalPriceFeed.read.callAsync(
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
});