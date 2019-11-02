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

import {
  MedianContract
} from 'set-protocol-contracts';

import {
  LegacyMakerOracleAdapterContract,
  LinearizedPriceDataSourceContract,
  MovingAverageOracleV2Contract,
  MovingAverageToAssetPriceCrossoverTriggerContract,
  OracleProxyContract,
  TimeSeriesFeedContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  ZERO
} from '@utils/constants';

import { LogTriggerFlipped } from '@utils/contract_logs/iTrigger';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();

const MovingAverageToAssetPriceCrossoverTrigger = artifacts.require('MovingAverageToAssetPriceCrossoverTrigger');
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('MovingAverageToAssetPriceCrossoverTrigger', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let movingAverageOracle: MovingAverageOracleV2Contract;

  let trigger: MovingAverageToAssetPriceCrossoverTriggerContract;

  let initialEthPrice: BigNumber;

  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const protocolHelper = new ProtocolHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(MovingAverageToAssetPriceCrossoverTrigger.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(MovingAverageToAssetPriceCrossoverTrigger.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await protocolHelper.getDeployedWETHMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );


    legacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleHelper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    const interpolationThreshold = ONE_DAY_IN_SECONDS;
    linearizedDataSource = await oracleHelper.deployLinearizedPriceDataSourceAsync(
      oracleProxy.address,
      interpolationThreshold,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [linearizedDataSource.address]
    );

    const seededValues = _.map(new Array(20), function(el, i) {return ether(150 + i); });
    timeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededValues
    );

    const dataDescription = 'ETH20dayMA';
    movingAverageOracle = await oracleHelper.deployMovingAverageOracleV2Async(
      timeSeriesFeed.address,
      dataDescription
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectMovingAveragePriceFeedInstance: Address;
    let subjectAssetPairOracleInstance: Address;
    let subjectMovingAverageDays: BigNumber;
    let subjectInitialState: boolean;
    let subjectSignalConfirmationMinTime: BigNumber;
    let subjectSignalConfirmationMaxTime: BigNumber;

    beforeEach(async () => {
      subjectMovingAveragePriceFeedInstance = movingAverageOracle.address;
      subjectAssetPairOracleInstance = oracleProxy.address;
      subjectMovingAverageDays = new BigNumber(20);
      subjectInitialState = false;
      subjectSignalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
    });

    async function subject(): Promise<MovingAverageToAssetPriceCrossoverTriggerContract> {
      return managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        subjectMovingAveragePriceFeedInstance,
        subjectAssetPairOracleInstance,
        subjectMovingAverageDays,
        subjectInitialState,
        subjectSignalConfirmationMinTime,
        subjectSignalConfirmationMaxTime
      );
    }

    it('sets the correct moving average oracle address', async () => {
      trigger = await subject();

      const actualMovingAveragePriceFeedAddress = await trigger.movingAveragePriceFeedInstance.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectMovingAveragePriceFeedInstance);
    });

    it('sets the correct asset pair oracle address', async () => {
      trigger = await subject();

      const actualAssetPairOracleAddress = await trigger.assetPairOracleInstance.callAsync();

      expect(actualAssetPairOracleAddress).to.equal(subjectAssetPairOracleInstance);
    });

    it('sets the correct moving average days', async () => {
      trigger = await subject();

      const actualMovingAverageDays = await trigger.movingAverageDays.callAsync();

      expect(actualMovingAverageDays).to.be.bignumber.equal(subjectMovingAverageDays);
    });

    it('sets the correct signalConfirmationMinTime', async () => {
      trigger = await subject();

      const actualSignalConfirmationMinTime = await trigger.signalConfirmationMinTime.callAsync();

      expect(actualSignalConfirmationMinTime).to.be.bignumber.equal(subjectSignalConfirmationMinTime);
    });

    it('sets the correct signalConfirmationMaxTime', async () => {
      trigger = await subject();

      const actualSignalConfirmationMaxTime = await trigger.signalConfirmationMaxTime.callAsync();

      expect(actualSignalConfirmationMaxTime).to.be.bignumber.equal(subjectSignalConfirmationMaxTime);
    });

    it('sets the correct lastConfirmedState', async () => {
      trigger = await subject();

      const actualBaseAssetAllocation = await trigger.isBullish.callAsync();

      expect(actualBaseAssetAllocation).to.be.false;
    });

    it('sets the current triggerFlippedIndex to 0', async () => {
      trigger = await subject();

      const actualTriggerFlippedIndex = await trigger.triggerFlippedIndex.callAsync();

      expect(actualTriggerFlippedIndex).to.be.bignumber.equal(ZERO);
    });

    it('deployed with requiresConfirmation set to true', async () => {
      trigger = await subject();

      const requiresConfirmation = await trigger.requiresConfirmation.callAsync();

      expect(requiresConfirmation).to.be.true;
    });
  });

  describe('#initialTrigger', async () => {
    let subjectCaller: Address;

    let updatedValues: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      const initialState = false;
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      trigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [trigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return trigger.initialTrigger.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the proposalTimestamp correctly', async () => {
      await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp);

      const actualTimestamp = await trigger.lastInitialTriggerTimestamp.callAsync();
      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('but not enough time has passed from last initial propose', async () => {
      beforeEach(async () => {
        await trigger.initialTrigger.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but price trigger has not flipped', async () => {
      before(async () => {
        updatedValues = _.map(new Array(19), function(el, i) {return ether(170 - i); });
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#confirmTrigger', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let lastPrice: BigNumber;
    let initialState: boolean;
    let signalConfirmationMinTime: BigNumber;
    let signalConfirmationMaxTime: BigNumber;

    before(async () => {
      initialState = false;
      lastPrice = ether(170);
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      trigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [trigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      await trigger.initialTrigger.sendTransactionAsync();

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectTimeFastForward = signalConfirmationMinTime.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return trigger.confirmTrigger.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the lastConfirmedAllocation correctly', async () => {
      await subject();

      const actualLastConfirmedAllocation = await trigger.isBullish.callAsync();
      expect(actualLastConfirmedAllocation).to.be.true;
    });

    it('sets the current triggerFlippedIndex to 1', async () => {
      await subject();

      const actualTriggerFlippedIndex = await trigger.triggerFlippedIndex.callAsync();

      expect(actualTriggerFlippedIndex).to.be.bignumber.equal(new BigNumber(1));
    });

    it('emits the correct TriggerFlipped event', async () => {
      const txHash = await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp);

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogTriggerFlipped(
        true,
        new BigNumber(1),
        expectedTimestamp,
        trigger.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('but price trigger has not flipped', async () => {
      before(async () => {
        lastPrice = ether(150);
      });

      after(async () => {
        lastPrice = ether(170);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('price going from bullish to bearish', async () => {
      before(async () => {
        initialState = true;
        lastPrice = ether(130);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
      });

      after(async () => {
        initialState = false;
        lastPrice = ether(170);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      });

      it('sets the lastConfirmedAllocation correctly', async () => {
        await subject();

        const actualLastConfirmedAllocation = await trigger.isBullish.callAsync();
        expect(actualLastConfirmedAllocation).to.be.false;
      });

      describe('but price trigger has not flipped', async () => {
        before(async () => {
          lastPrice = ether(150);
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });
    });

    describe('but not enough time has passed from initial propose', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = signalConfirmationMinTime.sub(10);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but too much time has passed from initial propose', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = signalConfirmationMaxTime.add(1);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#canInitialTrigger', async () => {
    let subjectCaller: Address;

    let updatedValues: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      const initialState = false;
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      trigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [trigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      return trigger.canInitialTrigger.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('returns true', async () => {
      const canInitialTrigger = await subject();

      expect(canInitialTrigger).to.be.true;
    });

    describe('but not enough time has passed from last initial propose', async () => {
      beforeEach(async () => {
        await trigger.initialTrigger.sendTransactionAsync();
      });

      it('should return false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });

    describe('but price trigger has not flipped', async () => {
      before(async () => {
        updatedValues = _.map(new Array(19), function(el, i) {return ether(170 - i); });
      });

      it('should return false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });
  });

  describe('#canConfirmTrigger', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let lastPrice: BigNumber;
    let initialState: boolean;
    let signalConfirmationMinTime: BigNumber;
    let signalConfirmationMaxTime: BigNumber;

    before(async () => {
      initialState = false;
      lastPrice = ether(170);
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      trigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [trigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      await trigger.initialTrigger.sendTransactionAsync();

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectTimeFastForward = signalConfirmationMinTime.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return trigger.canConfirmTrigger.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('returns true', async () => {
      const canInitialTrigger = await subject();

      expect(canInitialTrigger).to.be.true;
    });

    describe('but price trigger has not flipped', async () => {
      before(async () => {
        lastPrice = ether(150);
      });

      after(async () => {
        lastPrice = ether(170);
      });

      it('should return false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });

    describe('price going from bullish to bearish', async () => {
      before(async () => {
        initialState = true;
        lastPrice = ether(130);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
      });

      after(async () => {
        initialState = false;
        lastPrice = ether(170);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      });

      it('should return true', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.true;
      });

      describe('but price trigger has not flipped', async () => {
        before(async () => {
          lastPrice = ether(150);
        });

        it('should return false', async () => {
          const canInitialTrigger = await subject();

          expect(canInitialTrigger).to.be.false;
        });
      });
    });

    describe('but not enough time has passed from initial propose', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = signalConfirmationMinTime.sub(10);
      });

      it('should return false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });

    describe('but too much time has passed from initial propose', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = signalConfirmationMaxTime.add(1);
      });

      it('should return false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });
  });

  describe('#isBullish', async () => {
    let initialState: boolean;

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      initialState = false;
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      trigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
    });

    async function subject(): Promise<boolean> {
      return trigger.isBullish.callAsync();
    }

    it('retrieves the lastConfirmedState', async () => {
      const actualLastConfirmedState = await subject();

      const expectedLastConfirmedState = initialState;
      expect(actualLastConfirmedState).to.be.equal(expectedLastConfirmedState);
    });
  });
});