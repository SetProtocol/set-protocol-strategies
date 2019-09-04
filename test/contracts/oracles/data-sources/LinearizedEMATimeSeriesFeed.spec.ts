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
  LinearizedEMATimeSeriesFeedContract,
  OracleProxyContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ZERO
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogOracleUpdated } from '@utils/contract_logs/linearizedPriceDataSource';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const LinearizedEMATimeSeriesFeed = artifacts.require('LinearizedEMATimeSeriesFeed');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('LinearizedEMATimeSeriesFeed', accounts => {
  const [
    deployerAccount,
    oracleAccount,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let emaTimeSeriesFeed: LinearizedEMATimeSeriesFeedContract;
  let oracleProxy: OracleProxyContract;

  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(LinearizedEMATimeSeriesFeed.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(LinearizedEMATimeSeriesFeed.abi);
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
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectUpdateInterval: BigNumber;
    let subjectMaxDataPoints: BigNumber;
    let subjectNextEarliestUpdate: BigNumber;
    let subjectSeededValues: BigNumber[];

    let subjectEmaTimePeriod: BigNumber;
    let subjectInterpolationThreshold: BigNumber;
    let subjectOracleAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectUpdateInterval = ONE_DAY_IN_SECONDS;
      subjectMaxDataPoints = new BigNumber(200);
      subjectSeededValues = [ether(150)];
      subjectNextEarliestUpdate = SetTestUtils.generateTimestamp(subjectUpdateInterval.toNumber());

      subjectEmaTimePeriod = new BigNumber(26);
      subjectInterpolationThreshold = ONE_DAY_IN_SECONDS;
      subjectOracleAddress = oracleProxy.address;
      subjectDataDescription = 'ETH12DayEMAPrice';
    });

    async function subject(): Promise<LinearizedEMATimeSeriesFeedContract> {
      return oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
        subjectOracleAddress,
        subjectEmaTimePeriod,
        subjectSeededValues,
        subjectInterpolationThreshold,
        subjectUpdateInterval,
        subjectMaxDataPoints,
        subjectDataDescription,
        subjectNextEarliestUpdate
      );
    }

    it('sets the correct updateInterval', async () => {
      emaTimeSeriesFeed = await subject();

      const actualUpdateFrequency = await emaTimeSeriesFeed.updateInterval.callAsync();

      expect(actualUpdateFrequency).to.be.bignumber.equal(subjectUpdateInterval);
    });

    it('sets the correct maxDataPoints', async () => {
      emaTimeSeriesFeed = await subject();

      const actualMaxDataPoints = await emaTimeSeriesFeed.maxDataPoints.callAsync();

      expect(actualMaxDataPoints).to.bignumber.equal(subjectMaxDataPoints);
    });

    it('sets the nextEarliestUpdate timestamp to passed timestamp', async () => {
      emaTimeSeriesFeed = await subject();

      const actualTimestamp = await emaTimeSeriesFeed.nextEarliestUpdate.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(subjectNextEarliestUpdate);
    });

    it('sets the correct EMA TimePeriod', async () => {
      emaTimeSeriesFeed = await subject();

      const actualTimePeriod = await emaTimeSeriesFeed.emaTimePeriod.callAsync();

      expect(actualTimePeriod).to.be.bignumber.equal(subjectEmaTimePeriod);
    });

    it('sets the correct interpolationThreshold', async () => {
      emaTimeSeriesFeed = await subject();

      const actualInterpolationThreshold = await emaTimeSeriesFeed.interpolationThreshold.callAsync();

      expect(actualInterpolationThreshold).to.be.bignumber.equal(subjectInterpolationThreshold);
    });

    it('sets the correct oracle address', async () => {
      emaTimeSeriesFeed = await subject();

      const actualOracleAddress = await emaTimeSeriesFeed.oracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectOracleAddress);
    });

    it('sets the correct data description', async () => {
      emaTimeSeriesFeed = await subject();

      const actualDataDescription = await emaTimeSeriesFeed.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });

    it('sets the correct price array', async () => {
      emaTimeSeriesFeed = await subject();

      const daysOfData = new BigNumber(1);
      const actualPriceArray = await emaTimeSeriesFeed.read.callAsync(daysOfData);

      const expectedPriceArray = subjectSeededValues;

      expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
    });

    describe('when the price feed is seeded with values', async () => {
      beforeEach(async () => {
        subjectSeededValues = [ether(160), ether(170), ether(165)];
      });

      it('should set the correct price array with 4 values', async () => {
        emaTimeSeriesFeed = await subject();

        const daysOfData = new BigNumber(3);
        const actualPriceArray = await emaTimeSeriesFeed.read.callAsync(daysOfData);

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

  describe('#read', async () => {
    let ethPrice: BigNumber;
    let emaUpdatedPrices: BigNumber[];

    let subjectDataDays: BigNumber;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const oracleAddress = oracleProxy.address;
      const emaTimePeriod = new BigNumber(12);
      const seededValues = [ethPrice];
      emaTimeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
        oracleAddress,
        emaTimePeriod,
        seededValues,
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [emaTimeSeriesFeed.address]
      );

      const updatedPrices = await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        emaTimeSeriesFeed,
        ethMedianizer,
        20,
      );

      emaUpdatedPrices = oracleHelper.batchCalculateEMA(
        ethPrice,
        emaTimePeriod,
        updatedPrices
      );

      subjectDataDays = new BigNumber(20);
    });

    async function subject(): Promise<BigNumber[]> {
      return emaTimeSeriesFeed.read.callAsync(
        subjectDataDays,
        { gas: DEFAULT_GAS}
      );
    }

    it('returns the correct array', async () => {
      const actualDailyPriceOutput = await subject();

      const expectedDailyPriceOutput = emaUpdatedPrices.slice(-subjectDataDays.toNumber()).reverse();

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
    let newEthPrice: BigNumber;
    let interpolationThreshold: BigNumber;
    let emaTimePeriod: BigNumber;

    let previousEMAValue: BigNumber;
    let subjectTimeFastForward: BigNumber;

    let customEtherPrice: BigNumber;

    beforeEach(async () => {
      emaTimePeriod = new BigNumber(12);
      previousEMAValue = ether(100);

      newEthPrice = customEtherPrice || ether(200);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      const oracleAddress = oracleProxy.address;
      const seededValues = [previousEMAValue];
      interpolationThreshold = ONE_DAY_IN_SECONDS.div(8);
      emaTimeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
        oracleAddress,
        emaTimePeriod,
        seededValues,
        interpolationThreshold
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [emaTimeSeriesFeed.address]
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

      return emaTimeSeriesFeed.poke.sendTransactionAsync();
    }

    it('updates the linearizedDataSource with the correct price', async () => {
      await subject();

      const [ output ] = await emaTimeSeriesFeed.read.callAsync(new BigNumber(1));

      const newEMAValue = oracleHelper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);
      expect(output).to.bignumber.equal(newEMAValue);
    });

    describe('when the timestamp has surpassed the interpolationThreshold and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(interpolationThreshold.mul(3));
      });

      it('returns with the correct interpolated value', async () => {
        const [ previousLoggedPrice ] = await emaTimeSeriesFeed.read.callAsync(new BigNumber(1));
        const nextEarliestUpdate = await emaTimeSeriesFeed.nextEarliestUpdate.callAsync();

        await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(nextEarliestUpdate);

        const newEMAValue = oracleHelper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);

        const updateInterval = await emaTimeSeriesFeed.updateInterval.callAsync();
        const timeFromLastUpdate = timeFromExpectedUpdate.add(updateInterval);

        const expectedNewPrice = newEMAValue
                                     .mul(updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        const [ actualNewPrice ] = await emaTimeSeriesFeed.read.callAsync(new BigNumber(1));
        expect(actualNewPrice).to.bignumber.equal(expectedNewPrice);
      });
    });

    describe('when the timestamp has surpassed the interpolationThreshold and price decreases', async () => {
      before(async () => {
        customEtherPrice = ether(50);
      });

      after(async () => {
        customEtherPrice = undefined;
      });

      beforeEach(async () => {
        subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(interpolationThreshold.mul(3));
      });

      it('returns with the correct interpolated value', async () => {
        const [ previousLoggedPrice ] = await emaTimeSeriesFeed.read.callAsync(new BigNumber(1));
        const nextEarliestUpdate = await emaTimeSeriesFeed.nextEarliestUpdate.callAsync();

        await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(nextEarliestUpdate);

        const newEMAValue = oracleHelper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);

        const updateInterval = await emaTimeSeriesFeed.updateInterval.callAsync();
        const timeFromLastUpdate = timeFromExpectedUpdate.add(updateInterval);

        const expectedNewPrice = newEMAValue
                                     .mul(updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        const [ actualNewPrice ] = await emaTimeSeriesFeed.read.callAsync(new BigNumber(1));
        expect(actualNewPrice).to.bignumber.equal(expectedNewPrice);
      });
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

  describe('#changeOracle', async () => {
    let ethPrice: BigNumber;
    const emaTimePeriod = new BigNumber(26);

    let subjectNewOracle: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const oracleAddress = oracleProxy.address;
      const seededValues = [ether(150)];
      emaTimeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
        oracleAddress,
        emaTimePeriod,
        seededValues
      );

      subjectNewOracle = oracleAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return emaTimeSeriesFeed.changeOracle.sendTransactionAsync(
        subjectNewOracle,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the Oracle address', async () => {
      await subject();

      const actualOracleAddress = await emaTimeSeriesFeed.oracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectNewOracle);
    });

    it('emits correct LogOracleUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogOracleUpdated(
        subjectNewOracle,
        emaTimeSeriesFeed.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('when non owner calls', async () => {
      beforeEach(async () => {
        subjectCaller = nonOwnerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when passed address is not new', async () => {
      beforeEach(async () => {
        subjectNewOracle = oracleProxy.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});