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
  TwoAssetLinearizedTimeSeriesFeedContract,
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
const TwoAssetLinearizedTimeSeriesFeed = artifacts.require('TwoAssetLinearizedTimeSeriesFeed');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('TwoAssetLinearizedTimeSeriesFeed', accounts => {
  const [
    deployerAccount,
    nonOracleAddress,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let btcMedianizer: MedianContract;

  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;

  let ethBtcTimeSeriesFeed: TwoAssetLinearizedTimeSeriesFeedContract;
  let ethOracleProxy: OracleProxyContract;
  let btcOracleProxy: OracleProxyContract;

  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(TwoAssetLinearizedTimeSeriesFeed.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(TwoAssetLinearizedTimeSeriesFeed.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleHelper.deployMedianizerAsync();
    btcMedianizer = await oracleHelper.deployMedianizerAsync();

    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    ethLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );
    btcLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      btcMedianizer.address,
    );

    ethOracleProxy = await oracleHelper.deployOracleProxyAsync(
      ethLegacyMakerOracleAdapter.address,
    );
    btcOracleProxy = await oracleHelper.deployOracleProxyAsync(
      btcLegacyMakerOracleAdapter.address,
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

    let subjectInterpolationThreshold: BigNumber;
    let subjectEthOracleAddress: Address;
    let subjectBtcOracleAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectUpdateInterval = ONE_DAY_IN_SECONDS;
      subjectMaxDataPoints = new BigNumber(200);
      subjectSeededValues = [ether(0.015)];
      subjectNextEarliestUpdate = SetTestUtils.generateTimestamp(subjectUpdateInterval.toNumber());

      subjectInterpolationThreshold = ONE_DAY_IN_SECONDS;
      subjectEthOracleAddress = ethOracleProxy.address;
      subjectBtcOracleAddress = btcOracleProxy.address;
      subjectDataDescription = 'ETHBTCDailyPrice';
    });

    async function subject(): Promise<TwoAssetLinearizedTimeSeriesFeedContract> {
      return oracleHelper.deployTwoAssetLinearizedTimeSeriesFeedAsync(
        subjectEthOracleAddress,
        subjectBtcOracleAddress,
        subjectSeededValues,
        subjectInterpolationThreshold,
        subjectUpdateInterval,
        subjectMaxDataPoints,
        subjectDataDescription,
        subjectNextEarliestUpdate
      );
    }

    it('sets the correct updateInterval', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualUpdateFrequency = await ethBtcTimeSeriesFeed.updateInterval.callAsync();

      expect(actualUpdateFrequency).to.be.bignumber.equal(subjectUpdateInterval);
    });

    it('sets the correct maxDataPoints', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualMaxDataPoints = await ethBtcTimeSeriesFeed.maxDataPoints.callAsync();

      expect(actualMaxDataPoints).to.bignumber.equal(subjectMaxDataPoints);
    });

    it('sets the nextEarliestUpdate timestamp to passed timestamp', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualTimestamp = await ethBtcTimeSeriesFeed.nextEarliestUpdate.callAsync();

      expect(actualTimestamp).to.be.bignumber.equal(subjectNextEarliestUpdate);
    });

    it('sets the correct interpolationThreshold', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualInterpolationThreshold = await ethBtcTimeSeriesFeed.interpolationThreshold.callAsync();

      expect(actualInterpolationThreshold).to.be.bignumber.equal(subjectInterpolationThreshold);
    });

    it('sets the correct base oracle address', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualEthOracleAddress = await ethBtcTimeSeriesFeed.baseOracleInstance.callAsync();

      expect(actualEthOracleAddress).to.equal(subjectEthOracleAddress);
    });

    it('sets the correct quote oracle address', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualBtcOracleAddress = await ethBtcTimeSeriesFeed.quoteOracleInstance.callAsync();

      expect(actualBtcOracleAddress).to.equal(subjectBtcOracleAddress);
    });

    it('sets the correct data description', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const actualDataDescription = await ethBtcTimeSeriesFeed.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });

    it('sets the correct price array', async () => {
      ethBtcTimeSeriesFeed = await subject();

      const daysOfData = new BigNumber(1);
      const actualPriceArray = await ethBtcTimeSeriesFeed.read.callAsync(daysOfData);

      const expectedPriceArray = subjectSeededValues;

      expect(JSON.stringify(actualPriceArray)).to.equal(JSON.stringify(expectedPriceArray));
    });

    describe('when the price feed is seeded with values', async () => {
      beforeEach(async () => {
        subjectSeededValues = [ether(0.016), ether(0.018), ether(0.0165)];
      });

      it('should set the correct price array', async () => {
        ethBtcTimeSeriesFeed = await subject();

        const daysOfData = new BigNumber(3);
        const actualPriceArray = await ethBtcTimeSeriesFeed.read.callAsync(daysOfData);

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
    let ethPrice: BigNumber;
    let btcPrice: BigNumber;

    let updatedPrices: BigNumber[];

    let subjectDataDays: BigNumber;

    beforeEach(async () => {
      ethPrice = ether(150.125);
      btcPrice = ether(8200.567);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );
      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        btcPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const ethOracleAddress = ethOracleProxy.address;
      const btcOracleAddress = btcOracleProxy.address;

      const seededValues = [ethPrice.mul(10 ** 18).div(btcPrice).round(0, BigNumber.ROUND_DOWN)];
      ethBtcTimeSeriesFeed = await oracleHelper.deployTwoAssetLinearizedTimeSeriesFeedAsync(
        ethOracleAddress,
        btcOracleAddress,
        seededValues
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );

      updatedPrices = await oracleHelper.batchUpdateTwoAssetTimeSeriesFeedAsync(
        ethBtcTimeSeriesFeed,
        ethMedianizer,
        btcMedianizer,
        20
      );

      subjectDataDays = new BigNumber(20);
    });

    async function subject(): Promise<BigNumber[]> {
      return ethBtcTimeSeriesFeed.read.callAsync(
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

  describe('#poke', async () => {
    let previousEthPrice: BigNumber;
    let previousBtcPrice: BigNumber;

    let newEthPrice: BigNumber;
    let newBtcPrice: BigNumber;
    let interpolationThreshold: BigNumber;

    let subjectTimeFastForward: BigNumber;

    let customEtherPrice: BigNumber;

    beforeEach(async () => {
      previousEthPrice = ether(160.5312);
      previousBtcPrice = ether(8067.1234);

      newEthPrice = customEtherPrice || ether(200);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      newBtcPrice = ether(8000);
      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        newBtcPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      const ethOracleAddress = ethOracleProxy.address;
      const btcOracleAddress = btcOracleProxy.address;

      const seededValues = [previousEthPrice.mul(10 ** 18).div(previousBtcPrice).round(0, BigNumber.ROUND_DOWN)];
      interpolationThreshold = ONE_DAY_IN_SECONDS.div(8);
      ethBtcTimeSeriesFeed = await oracleHelper.deployTwoAssetLinearizedTimeSeriesFeedAsync(
        ethOracleAddress,
        btcOracleAddress,
        seededValues,
        interpolationThreshold
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [ethBtcTimeSeriesFeed.address]
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

      return ethBtcTimeSeriesFeed.poke.sendTransactionAsync();
    }

    it('updates the linearizedDataSource with the correct price', async () => {
      await subject();

      const [ output ] = await ethBtcTimeSeriesFeed.read.callAsync(new BigNumber(1));

      const newEthBtcValue = newEthPrice.mul(10 ** 18).div(newBtcPrice).round(0, BigNumber.ROUND_DOWN);
      expect(output).to.bignumber.equal(newEthBtcValue);
    });

    describe('when the timestamp has surpassed the interpolationThreshold and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(interpolationThreshold.mul(3));
      });

      it('returns with the correct interpolated value', async () => {
        const [ previousLoggedPrice ] = await ethBtcTimeSeriesFeed.read.callAsync(new BigNumber(1));
        const nextEarliestUpdate = await ethBtcTimeSeriesFeed.nextEarliestUpdate.callAsync();

        await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(nextEarliestUpdate);

        const newEthBtcValue = newEthPrice.mul(10 ** 18).div(newBtcPrice).round(0, BigNumber.ROUND_DOWN);

        const updateInterval = await ethBtcTimeSeriesFeed.updateInterval.callAsync();
        const timeFromLastUpdate = timeFromExpectedUpdate.add(updateInterval);

        const expectedNewPrice = newEthBtcValue
                                     .mul(updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        const [ actualNewPrice ] = await ethBtcTimeSeriesFeed.read.callAsync(new BigNumber(1));
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
        const [ previousLoggedPrice ] = await ethBtcTimeSeriesFeed.read.callAsync(new BigNumber(1));
        const nextEarliestUpdate = await ethBtcTimeSeriesFeed.nextEarliestUpdate.callAsync();

        await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(nextEarliestUpdate);

        const newEthBtcValue = newEthPrice.mul(10 ** 18).div(newBtcPrice).round(0, BigNumber.ROUND_DOWN);

        const updateInterval = await ethBtcTimeSeriesFeed.updateInterval.callAsync();
        const timeFromLastUpdate = timeFromExpectedUpdate.add(updateInterval);

        const expectedNewPrice = newEthBtcValue
                                     .mul(updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        const [ actualNewPrice ] = await ethBtcTimeSeriesFeed.read.callAsync(new BigNumber(1));
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

  describe('#changeBaseOracle', async () => {
    let ethPrice: BigNumber;
    let btcPrice: BigNumber;

    let subjectNewBaseOracle: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      ethPrice = ether(150.125);
      btcPrice = ether(8200.567);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );
      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        btcPrice,
        SetTestUtils.generateTimestamp(1000),
      );
      const ethOracleAddress = ethOracleProxy.address;
      const btcOracleAddress = btcOracleProxy.address;
      const seededValues = [ether(0.013)];
      ethBtcTimeSeriesFeed = await oracleHelper.deployTwoAssetLinearizedTimeSeriesFeedAsync(
        ethOracleAddress,
        btcOracleAddress,
        seededValues
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );

      subjectNewBaseOracle = btcOracleAddress;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return ethBtcTimeSeriesFeed.changeBaseOracle.sendTransactionAsync(
        subjectNewBaseOracle,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the Base Oracle address', async () => {
      await subject();

      const actualOracleAddress = await ethBtcTimeSeriesFeed.baseOracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectNewBaseOracle);
    });

    it('emits correct LogOracleUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogOracleUpdated(
        subjectNewBaseOracle,
        ethBtcTimeSeriesFeed.address
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
        subjectNewBaseOracle = ethOracleProxy.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when passed address is not an oracle address', async () => {
      beforeEach(async () => {
        subjectNewBaseOracle = nonOracleAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#changeQuoteOracle', async () => {
    let ethPrice: BigNumber;
    let btcPrice: BigNumber;

    let subjectNewQuoteOracle: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      ethPrice = ether(150.125);
      btcPrice = ether(8200.567);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );
      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        btcPrice,
        SetTestUtils.generateTimestamp(1000),
      );
      const ethOracleAddress = ethOracleProxy.address;
      const btcOracleAddress = btcOracleProxy.address;
      const seededValues = [ether(0.013)];
      ethBtcTimeSeriesFeed = await oracleHelper.deployTwoAssetLinearizedTimeSeriesFeedAsync(
        ethOracleAddress,
        btcOracleAddress,
        seededValues
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [ethBtcTimeSeriesFeed.address]
      );

      subjectNewQuoteOracle = ethOracleAddress;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return ethBtcTimeSeriesFeed.changeQuoteOracle.sendTransactionAsync(
        subjectNewQuoteOracle,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the Quote Oracle address', async () => {
      await subject();

      const actualOracleAddress = await ethBtcTimeSeriesFeed.quoteOracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectNewQuoteOracle);
    });

    it('emits correct LogOracleUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogOracleUpdated(
        subjectNewQuoteOracle,
        ethBtcTimeSeriesFeed.address
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
        subjectNewQuoteOracle = btcOracleProxy.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when passed address is not oracle address', async () => {
      beforeEach(async () => {
        subjectNewQuoteOracle = nonOracleAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});