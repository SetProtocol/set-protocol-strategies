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
  OracleProxyContract,
  TimeSeriesFeedContract,
} from 'set-protocol-oracles';
import {
  MovingAverageCrossoverTriggerContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS
} from '@utils/constants';

import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();

const MovingAverageCrossoverTrigger = artifacts.require('MovingAverageCrossoverTrigger');
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('MovingAverageCrossoverTrigger', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let movingAverageOracle: MovingAverageOracleV2Contract;

  let trigger: MovingAverageCrossoverTriggerContract;

  let initialEthPrice: BigNumber;

  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const protocolHelper = new ProtocolHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(MovingAverageCrossoverTrigger.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(MovingAverageCrossoverTrigger.abi);
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

    beforeEach(async () => {
      subjectMovingAveragePriceFeedInstance = movingAverageOracle.address;
      subjectAssetPairOracleInstance = oracleProxy.address;
      subjectMovingAverageDays = new BigNumber(20);
    });

    async function subject(): Promise<MovingAverageCrossoverTriggerContract> {
      return managerHelper.deployMovingAverageCrossoverTrigger(
        subjectMovingAveragePriceFeedInstance,
        subjectAssetPairOracleInstance,
        subjectMovingAverageDays,
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
  });

  describe('#isBullish', async () => {
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let lastPrice: BigNumber;

    before(async () => {
      lastPrice = ether(170);
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      trigger = await managerHelper.deployMovingAverageCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays,
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

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      return trigger.isBullish.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('returns true', async () => {
      const result = await subject();
      expect(result).to.be.true;
    });

    describe('price going from bullish to bearish', async () => {
      before(async () => {
        lastPrice = ether(130);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
      });

      after(async () => {
        lastPrice = ether(170);
        updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      });

      it('returns false', async () => {
        const result = await subject();
        expect(result).to.be.false;
      });
    });
  });
});