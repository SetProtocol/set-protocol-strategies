require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  TimeSeriesFeedV2MockContract
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ZERO
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('LinearizedEMATimeSeriesFeed', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let timeSeriesFeed: TimeSeriesFeedV2MockContract;
  const oracleHelper = new OracleHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectUpdateInterval: BigNumber;
    let subjectMaxDataPoints: BigNumber;
    let subjectNextEarliestUpdate: BigNumber;
    let subjectSeededValues: BigNumber[];

    beforeEach(async () => {
      subjectUpdateInterval = ONE_DAY_IN_SECONDS;
      subjectMaxDataPoints = new BigNumber(200);
      subjectSeededValues = [ether(150)];
      subjectNextEarliestUpdate = SetTestUtils.generateTimestamp(subjectUpdateInterval.toNumber());
    });

    async function subject(): Promise<TimeSeriesFeedV2MockContract> {
      return oracleHelper.deployTimeSeriesFeedV2MockAsync(
        subjectSeededValues,
        subjectUpdateInterval,
        subjectNextEarliestUpdate,
        subjectMaxDataPoints,
      );
    }

    it('sets the correct updateInterval', async () => {
      timeSeriesFeed = await subject();

      const actualUpdateFrequency = await timeSeriesFeed.updateInterval.callAsync();

      expect(actualUpdateFrequency).to.be.bignumber.equal(subjectUpdateInterval);
    });

    it('sets the correct maxDataPoints', async () => {
      timeSeriesFeed = await subject();

      const actualMaxDataPoints = await timeSeriesFeed.maxDataPoints.callAsync();

      expect(actualMaxDataPoints).to.bignumber.equal(subjectMaxDataPoints);
    });

    it('sets the nextEarliestUpdate timestamp to passed timestamp', async () => {
      timeSeriesFeed = await subject();

      const actualTimestamp = await timeSeriesFeed.nextEarliestUpdate.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(subjectNextEarliestUpdate);
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

    describe('when nextEarliest update is less than current block timestamp', async () => {
      beforeEach(async () => {
        subjectNextEarliestUpdate = new BigNumber(10);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when max data points is 0', async () => {
      beforeEach(async () => {
        subjectMaxDataPoints = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when update interval is 0', async () => {
      beforeEach(async () => {
        subjectUpdateInterval = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#read', async () => {
    let seededValues: BigNumber[];

    let subjectDataDays: BigNumber;

    beforeEach(async () => {
      seededValues = Array.from({length: 20}, () => ether(Math.floor(Math.random() * 100) + 100));
      timeSeriesFeed = await oracleHelper.deployTimeSeriesFeedV2MockAsync(
        seededValues,
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

      const expectedDailyPriceOutput = seededValues.slice(-subjectDataDays.toNumber()).reverse();

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

  describe('#poke', async () => {
    let subjectTimeFastForward: BigNumber;

    beforeEach(async () => {
      const previousValue = ether(100);
      const seededValues = [previousValue];
      timeSeriesFeed = await oracleHelper.deployTimeSeriesFeedV2MockAsync(
        seededValues,
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);

      // Send dummy transaction to advance block
      await web3.eth.sendTransaction({
        from: deployerAccount,
        to: deployerAccount,
        value: ether(1).toString(),
        gas: DEFAULT_GAS,
      });

      return timeSeriesFeed.poke.sendTransactionAsync();
    }

    it('updates the TimeSeriesFeed with the correct price', async () => {
      await subject();

      const [ output ] = await timeSeriesFeed.read.callAsync(new BigNumber(1));

      // Mock just updates TimeSeriesFeed with value = 1
      expect(output).to.bignumber.equal(new BigNumber(1));
    });

    describe('when the nextEarliestUpdate timestamp is greater than current block timestamp', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});