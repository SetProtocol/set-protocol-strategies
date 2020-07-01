require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from 'set-protocol-contracts';
import { ether } from '@utils/units';

import {
  LegacyMakerOracleAdapterContract,
  LinearizedPriceDataSourceContract,
  MedianContract,
  MovingAverageOracleV2Contract,
  OracleProxyContract,
  TimeSeriesFeedContract,
} from 'set-protocol-oracles';
import {
  TwoMovingAverageCrossoverTriggerContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS
} from '@utils/constants';

import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from 'set-protocol-oracles';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();

const TwoMovingAverageCrossoverTrigger = artifacts.require('TwoMovingAverageCrossoverTrigger');
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('TwoMovingAverageCrossoverTrigger', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let longTermTimeSeriesFeed: TimeSeriesFeedContract;
  let shortTermTimeSeriesFeed: TimeSeriesFeedContract;
  let longTermMAOracle: MovingAverageOracleV2Contract;
  let shortTermMAOracle: MovingAverageOracleV2Contract;

  let trigger: TwoMovingAverageCrossoverTriggerContract;

  let initialEthPrice: BigNumber;

  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const protocolHelper = new ProtocolHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(TwoMovingAverageCrossoverTrigger.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(TwoMovingAverageCrossoverTrigger.abi);
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

    const seededLongTermMATimePeriod = _.map(new Array(20), function(el, i) {return ether(150 + i); });
    longTermTimeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededLongTermMATimePeriod
    );

    const dataDescriptionLongTermMA = 'ETHDaily20MA';
    longTermMAOracle = await oracleHelper.deployMovingAverageOracleV2Async(
      longTermTimeSeriesFeed.address,
      dataDescriptionLongTermMA
    );

    const seededShortTermMATimePeriod = _.map(new Array(10), function(el, i) {return ether(200 + i); });
    shortTermTimeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededShortTermMATimePeriod
    );

    const dataDescriptionShortTermMA = 'ETHHourly10MA';
    shortTermMAOracle = await oracleHelper.deployMovingAverageOracleV2Async(
      shortTermTimeSeriesFeed.address,
      dataDescriptionShortTermMA
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectLongTermMAOracle: Address;
    let subjectShortTermMAOracle: Address;
    let subjectLongTermMATimePeriod: BigNumber;
    let subjectShortTermMATimePeriod: BigNumber;

    beforeEach(async () => {
      subjectLongTermMAOracle = longTermMAOracle.address;
      subjectShortTermMAOracle = shortTermMAOracle.address;
      subjectLongTermMATimePeriod = new BigNumber(20);
      subjectShortTermMATimePeriod = new BigNumber(10);
    });

    async function subject(): Promise<TwoMovingAverageCrossoverTriggerContract> {
      return managerHelper.deployTwoMovingAverageCrossoverTrigger(
        subjectLongTermMAOracle,
        subjectShortTermMAOracle,
        subjectLongTermMATimePeriod,
        subjectShortTermMATimePeriod,
      );
    }

    it('sets the correct long term moving average oracle address', async () => {
      trigger = await subject();

      const actualMovingAveragePriceFeedAddress = await trigger.longTermMAOracle.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectLongTermMAOracle);
    });

    it('sets the correct short term moving average oracle address', async () => {
      trigger = await subject();

      const actualMovingAveragePriceFeedAddress = await trigger.shortTermMAOracle.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectShortTermMAOracle);
    });

    it('sets the correct long term moving average days', async () => {
      trigger = await subject();

      const actualMovingAverageTimePeriod = await trigger.longTermMATimePeriod.callAsync();

      expect(actualMovingAverageTimePeriod).to.be.bignumber.equal(subjectLongTermMATimePeriod);
    });

    it('sets the correct short term moving average days', async () => {
      trigger = await subject();

      const actualMovingAverageTimePeriod = await trigger.shortTermMATimePeriod.callAsync();

      expect(actualMovingAverageTimePeriod).to.be.bignumber.equal(subjectShortTermMATimePeriod);
    });
  });

  describe('#isBullish', async () => {
    let subjectCaller: Address;

    let updatedLongTermTimePeriod: BigNumber[];

    before(async () => {
      updatedLongTermTimePeriod = _.map(new Array(20), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const longTermMATimePeriod = new BigNumber(20);
      const shortTermMATimePeriod = new BigNumber(10);

      trigger = await managerHelper.deployTwoMovingAverageCrossoverTrigger(
        longTermMAOracle.address,
        shortTermMAOracle.address,
        longTermMATimePeriod,
        shortTermMATimePeriod
      );
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [trigger.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        longTermTimeSeriesFeed,
        ethMedianizer,
        updatedLongTermTimePeriod.length,
        updatedLongTermTimePeriod
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
        updatedLongTermTimePeriod = _.map(new Array(19), function(el, i) {return ether(300 + i); });
      });

      after(async () => {
        updatedLongTermTimePeriod = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      });

      it('returns false', async () => {
        const result = await subject();
        expect(result).to.be.false;
      });
    });
  });
});