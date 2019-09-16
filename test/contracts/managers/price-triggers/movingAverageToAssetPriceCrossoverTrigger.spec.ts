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
  ZERO,
} from '@utils/constants';

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

    initialEthPrice = ether(150);
    const seededValues = [initialEthPrice];
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

    async function subject(): Promise<MovingAverageToAssetPriceCrossoverTriggerContract> {
      return managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        subjectMovingAveragePriceFeedInstance,
        subjectAssetPairOracleInstance,
        subjectMovingAverageDays
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
  });

  describe('#checkPriceTrigger', async () => {
    let subjectCaller: Address;

    let updatedValues: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const movingAverageDays = new BigNumber(20);
      priceTrigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
        movingAverageOracle.address,
        oracleProxy.address,
        movingAverageDays
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

    async function subject(): Promise<BigNumber> {
      return priceTrigger.checkPriceTrigger.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('with price over moving average it returns 100', async () => {
      const actualReturnedAllocation = await subject();

      const expectedReturnedAllocation = new BigNumber(100);

      expect(actualReturnedAllocation).to.be.bignumber.equal(expectedReturnedAllocation);
    });

    describe('when price is below moving average', async () => {
      before(async () => {
        updatedValues = _.map(new Array(19), function(el, i) {return ether(170 - i); });
      });

      it('returns 0', async () => {
        const actualReturnedAllocation = await subject();

        const expectedReturnedAllocation = ZERO;

        expect(actualReturnedAllocation).to.be.bignumber.equal(expectedReturnedAllocation);
      });
    });
  });
});