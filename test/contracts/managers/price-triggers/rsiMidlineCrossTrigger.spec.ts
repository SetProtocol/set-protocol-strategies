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
  RSIOracleContract,
  RSIMidlineCrossTriggerContract,
  OracleProxyContract,
  TimeSeriesFeedContract,
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
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('RSIMidlineCrossTrigger', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let rsiOracle: RSIOracleContract;

  let priceTrigger: RSIMidlineCrossTriggerContract;

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

    before(async () => {
      subjectLowerBound = new BigNumber(40);
      subjectUpperBound = new BigNumber(60);
    });

    beforeEach(async () => {
      subjectRSIOracleInstance = rsiOracle.address;
      subjectRSITimePeriod = new BigNumber(14);
    });

    async function subject(): Promise<RSIMidlineCrossTriggerContract> {
      return managerHelper.deployRSIMidlineCrossTrigger(
        subjectRSIOracleInstance,
        subjectLowerBound,
        subjectUpperBound,
        subjectRSITimePeriod
      );
    }

    it('sets the correct RSI oracle address', async () => {
      priceTrigger = await subject();

      const actualRSIOracleAddress = await priceTrigger.rsiOracleInstance.callAsync();

      expect(actualRSIOracleAddress).to.equal(subjectRSIOracleInstance);
    });

    it('sets the correct RSI days', async () => {
      priceTrigger = await subject();

      const actualRSITimePeriod = await priceTrigger.rsiTimePeriod.callAsync();

      expect(actualRSITimePeriod).to.be.bignumber.equal(subjectRSITimePeriod);
    });

    describe('when lower bound is higher than upper bound', async () => {
      before(async () => {
        subjectLowerBound = new BigNumber(60);
        subjectUpperBound = new BigNumber(40);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#checkPriceTrigger', async () => {
    let subjectCaller: Address;

    let lowerBound: BigNumber;
    let upperBound: BigNumber;
    let rsiTimePeriod: BigNumber;

    let updatedValues: BigNumber[];

    before(async () => {
      // Prices are increasing each day
      updatedValues = _.map(new Array(15), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      rsiTimePeriod = new BigNumber(14);
      lowerBound = new BigNumber(40);
      upperBound = new BigNumber(60);

      priceTrigger = await managerHelper.deployRSIMidlineCrossTrigger(
        rsiOracle.address,
        lowerBound,
        upperBound,
        rsiTimePeriod
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

    it('when RSI over 60 it returns 100', async () => {
      const actualReturnedAllocation = await subject();

      const expectedReturnedAllocation = new BigNumber(100);

      expect(actualReturnedAllocation).to.be.bignumber.equal(expectedReturnedAllocation);
    });

    describe('when RSI is below 40 it returns 0', async () => {
      before(async () => {
        // Prices are decreasing each day
        updatedValues = _.map(new Array(15), function(el, i) {return ether(170 - i); });
      });

      it('returns 0', async () => {
        const actualReturnedAllocation = await subject();

        const expectedReturnedAllocation = ZERO;

        expect(actualReturnedAllocation).to.be.bignumber.equal(expectedReturnedAllocation);
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