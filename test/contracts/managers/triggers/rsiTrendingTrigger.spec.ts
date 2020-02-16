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
  LegacyMakerOracleAdapterContract,
  LinearizedPriceDataSourceContract,
  MedianContract,
  RSIOracleContract,
  OracleProxyContract,
  TimeSeriesFeedContract,
} from 'set-protocol-oracles';
import {
  RSITrendingTriggerContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ZERO,
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();

const RSITrendingTrigger = artifacts.require('RSITrendingTrigger');
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('RSITrendingTrigger', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let rsiOracle: RSIOracleContract;

  let trigger: RSITrendingTriggerContract;

  let initialEthPrice: BigNumber;

  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const protocolHelper = new ProtocolHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(RSITrendingTrigger.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(RSITrendingTrigger.abi);
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

    initialEthPrice = ether(150);
    const seededValues = [initialEthPrice];
    timeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededValues
    );

    const dataDescription = 'ETHDailyRSI';
    rsiOracle = await oracleHelper.deployRSIOracleAsync(
      timeSeriesFeed.address,
      dataDescription
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectRSIOracleInstance: Address;
    let subjectLowerBound: BigNumber;
    let subjectUpperBound: BigNumber;
    let subjectRSITimePeriod: BigNumber;

    beforeEach(async () => {
      subjectLowerBound = new BigNumber(40);
      subjectUpperBound = new BigNumber(60);
      subjectRSIOracleInstance = rsiOracle.address;
      subjectRSITimePeriod = new BigNumber(14);
    });

    async function subject(): Promise<RSITrendingTriggerContract> {
      return managerHelper.deployRSITrendingTrigger(
        subjectRSIOracleInstance,
        subjectLowerBound,
        subjectUpperBound,
        subjectRSITimePeriod,
      );
    }

    it('sets the correct RSI oracle address', async () => {
      trigger = await subject();

      const actualRSIOracleAddress = await trigger.rsiOracle.callAsync();

      expect(actualRSIOracleAddress).to.equal(subjectRSIOracleInstance);
    });

    it('sets the correct lower bound', async () => {
      trigger = await subject();

      const [actualRSILowerBound] = await trigger.bounds.callAsync();

      expect(actualRSILowerBound).to.be.bignumber.equal(subjectLowerBound);
    });

    it('sets the correct upper bound', async () => {
      trigger = await subject();

      const [, actualRSIUpperBound] = await trigger.bounds.callAsync();

      expect(actualRSIUpperBound).to.be.bignumber.equal(subjectUpperBound);
    });

    it('sets the correct RSI days', async () => {
      trigger = await subject();

      const actualRSITimePeriod = await trigger.rsiTimePeriod.callAsync();

      expect(actualRSITimePeriod).to.be.bignumber.equal(subjectRSITimePeriod);
    });

    describe('when lower bound is higher than upper bound', async () => {
      beforeEach(async () => {
        subjectLowerBound = new BigNumber(60);
        subjectUpperBound = new BigNumber(40);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when time period is 0', async () => {
      beforeEach(async () => {
        subjectRSITimePeriod = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when upper bound is greater than 100', async () => {
      beforeEach(async () => {
        subjectUpperBound = new BigNumber(100);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#isBullish', async () => {
    let subjectCaller: Address;

    let updatedValues: BigNumber[];

    before(async () => {
      // Prices are increasing each day
      updatedValues = _.map(new Array(15), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      const rsiTimePeriod = new BigNumber(14);
      const lowerBound = new BigNumber(40);
      const upperBound = new BigNumber(60);

      trigger = await managerHelper.deployRSITrendingTrigger(
        rsiOracle.address,
        lowerBound,
        upperBound,
        rsiTimePeriod,
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
      return trigger.isBullish.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('when RSI over 60 it returns true', async () => {
      const result = await subject();
      expect(result).to.be.true;
    });

    describe('when RSI is below 40', async () => {
      before(async () => {
        // Prices are decreasing each day
        updatedValues = _.map(new Array(15), function(el, i) {return ether(170 - i); });
      });

      it('returns false', async () => {
        const result = await subject();
      expect(result).to.be.false;
      });
    });

    describe('when RSI is between 40 and 60', async () => {
      before(async () => {
        // Prices are alternating each day
        updatedValues = [
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
          ether(150),
          ether(170),
        ];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

});