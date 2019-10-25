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
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

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

  let priceTrigger: MovingAverageToAssetPriceCrossoverTriggerContract;

  let initialEthPrice: BigNumber;

  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const protocolHelper = new ProtocolHelper(deployerAccount);

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
      priceTrigger = await subject();

      const actualMovingAveragePriceFeedAddress = await priceTrigger.movingAveragePriceFeedInstance.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectMovingAveragePriceFeedInstance);
    });

    it('sets the correct asset pair oracle address', async () => {
      priceTrigger = await subject();

      const actualAssetPairOracleAddress = await priceTrigger.assetPairOracleInstance.callAsync();

      expect(actualAssetPairOracleAddress).to.equal(subjectAssetPairOracleInstance);
    });

    it('sets the correct moving average days', async () => {
      priceTrigger = await subject();

      const actualMovingAverageDays = await priceTrigger.movingAverageDays.callAsync();

      expect(actualMovingAverageDays).to.be.bignumber.equal(subjectMovingAverageDays);
    });

    it('sets the correct signalConfirmationMinTime', async () => {
      priceTrigger = await subject();

      const actualSignalConfirmationMinTime = await priceTrigger.signalConfirmationMinTime.callAsync();

      expect(actualSignalConfirmationMinTime).to.be.bignumber.equal(subjectSignalConfirmationMinTime);
    });

    it('sets the correct signalConfirmationMaxTime', async () => {
      priceTrigger = await subject();

      const actualSignalConfirmationMaxTime = await priceTrigger.signalConfirmationMaxTime.callAsync();

      expect(actualSignalConfirmationMaxTime).to.be.bignumber.equal(subjectSignalConfirmationMaxTime);
    });

    it('sets the correct lastConfirmedState', async () => {
      priceTrigger = await subject();

      const actualBaseAssetAllocation = await priceTrigger.isBullish.callAsync();

      expect(actualBaseAssetAllocation).to.be.false;
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
      priceTrigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [priceTrigger.address]
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
      return priceTrigger.initialTrigger.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the proposalTimestamp correctly', async () => {
      await subject();

      const block = await web3.eth.getBlock('latest');
      const expectedTimestamp = new BigNumber(block.timestamp);

      const actualTimestamp = await priceTrigger.lastInitialTriggerTimestamp.callAsync();
      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('but not enough time has passed from last initial propose', async () => {
      beforeEach(async () => {
        await priceTrigger.initialTrigger.sendTransactionAsync();
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
      priceTrigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [priceTrigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      await priceTrigger.initialTrigger.sendTransactionAsync();

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
      return priceTrigger.confirmTrigger.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the lastConfirmedAllocation correctly', async () => {
      await subject();

      const actualLastConfirmedAllocation = await priceTrigger.isBullish.callAsync();
      expect(actualLastConfirmedAllocation).to.be.true;
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

        const actualLastConfirmedAllocation = await priceTrigger.isBullish.callAsync();
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

  describe('#isBullish', async () => {
    let initialState: boolean;

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      initialState = false;
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      priceTrigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
        initialState,
        signalConfirmationMinTime,
        signalConfirmationMaxTime
      );
    });

    async function subject(): Promise<boolean> {
      return priceTrigger.isBullish.callAsync();
    }

    it('retrieves the lastConfirmedState', async () => {
      const actualLastConfirmedState = await subject();

      const expectedLastConfirmedState = initialState;
      expect(actualLastConfirmedState).to.be.equal(expectedLastConfirmedState);
    });
  });
});