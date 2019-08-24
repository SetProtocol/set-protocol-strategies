require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address, TimeSeriesFeedState } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  LinearizedEMADataSourceContract,
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

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const LinearizedEMADataSource = artifacts.require('LinearizedEMADataSource');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('LinearizedEMADataSource', accounts => {
  const [
    deployerAccount,
    oracleAccount,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let linearizedDataSource: LinearizedEMADataSourceContract;
  let oracleProxy: OracleProxyContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(LinearizedEMADataSource.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(LinearizedEMADataSource.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    legacyMakerOracleAdapter = await oracleWrapper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleWrapper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectEmaTimePeriod: BigNumber;
    let subjectInterpolationThreshold: BigNumber;
    let subjectOracleAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectEmaTimePeriod = new BigNumber(26);
      subjectInterpolationThreshold = ONE_DAY_IN_SECONDS;
      subjectOracleAddress = oracleProxy.address;
      subjectDataDescription = '200DailyETHPrice';
    });

    async function subject(): Promise<LinearizedEMADataSourceContract> {
      return oracleWrapper.deployLinearizedEMADataSourceAsync(
        subjectOracleAddress,
        subjectEmaTimePeriod,
        subjectInterpolationThreshold,
        subjectDataDescription,
      );
    }

    it('sets the correct EMA TimePeriod', async () => {
      linearizedDataSource = await subject();

      const actualTimePeriod = await linearizedDataSource.emaTimePeriod.callAsync();

      expect(actualTimePeriod).to.be.bignumber.equal(subjectEmaTimePeriod);
    });

    it('sets the correct interpolationThreshold', async () => {
      linearizedDataSource = await subject();

      const actualInterpolationThreshold = await linearizedDataSource.interpolationThreshold.callAsync();

      expect(actualInterpolationThreshold).to.be.bignumber.equal(subjectInterpolationThreshold);
    });

    it('sets the correct oracle address', async () => {
      linearizedDataSource = await subject();

      const actualOracleAddress = await linearizedDataSource.oracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectOracleAddress);
    });

    it('sets the correct data description', async () => {
      linearizedDataSource = await subject();

      const actualDataDescription = await linearizedDataSource.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let newEthPrice: BigNumber;
    let interpolationThreshold: BigNumber;
    let emaTimePeriod: BigNumber;

    let previousEMAValue: BigNumber;

    let subjectTimeSeriesState: TimeSeriesFeedState;
    let subjectTimeFastForward: BigNumber;

    let customEtherPrice: BigNumber;

    beforeEach(async () => {
      emaTimePeriod = new BigNumber(26);
      previousEMAValue = ether(100);

      newEthPrice = customEtherPrice || ether(200);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      interpolationThreshold = ONE_DAY_IN_SECONDS;
      const oracleAddress = oracleProxy.address;
      linearizedDataSource = await oracleWrapper.deployLinearizedEMADataSourceAsync(
        oracleAddress,
        emaTimePeriod,
        interpolationThreshold,
      );
      const block = await web3.eth.getBlock('latest');

      await oracleWrapper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [linearizedDataSource.address]
      );

      const nextEarliestUpdate = new BigNumber(block.timestamp);
      const updateInterval = ONE_DAY_IN_SECONDS;
      const timeSeriesDataArray = [previousEMAValue];

      subjectTimeSeriesState = {
        nextEarliestUpdate,
        updateInterval,
        timeSeriesDataArray,
      } as TimeSeriesFeedState;
      subjectTimeFastForward = ZERO;
    });

    async function subject(): Promise<BigNumber> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);

      // Send dummy transaction to advance block
      await web3.eth.sendTransaction({
        from: deployerAccount,
        to: deployerAccount,
        value: ether(1).toString(),
        gas: DEFAULT_GAS,
      });

      return linearizedDataSource.read.callAsync(
        subjectTimeSeriesState
      );
    }

    it('updates the linearizedDataSource with the correct price', async () => {
      const output = await subject();

      const newEMAValue = oracleWrapper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);
      expect(output).to.bignumber.equal(newEMAValue);
    });

    describe('when the timestamp has surpassed the interpolationThreshold and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = interpolationThreshold.mul(3);
      });

      it('returns with the correct interpolated value', async () => {
        const actualNewPrice = await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(subjectTimeSeriesState.nextEarliestUpdate);

        const newEMAValue = oracleWrapper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);

        const timeFromLastUpdate = timeFromExpectedUpdate.add(subjectTimeSeriesState.updateInterval);
        const previousLoggedPrice = subjectTimeSeriesState.timeSeriesDataArray[0];
        const expectedNewPrice = newEMAValue
                                     .mul(subjectTimeSeriesState.updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

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
        subjectTimeFastForward = interpolationThreshold.mul(3);
      });

      it('returns with the correct interpolated value', async () => {
        const actualNewPrice = await subject();

        const block = await web3.eth.getBlock('latest');
        const timeFromExpectedUpdate = new BigNumber(block.timestamp).sub(subjectTimeSeriesState.nextEarliestUpdate);

        const newEMAValue = oracleWrapper.calculateEMA(previousEMAValue, emaTimePeriod, newEthPrice);

        const timeFromLastUpdate = timeFromExpectedUpdate.add(subjectTimeSeriesState.updateInterval);
        const previousLoggedPrice = subjectTimeSeriesState.timeSeriesDataArray[0];
        const expectedNewPrice = newEMAValue
                                     .mul(subjectTimeSeriesState.updateInterval)
                                     .add(previousLoggedPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);

        expect(actualNewPrice).to.bignumber.equal(expectedNewPrice);
      });
    });
    describe('when the nextEarliestUpdate timestamp is greater than current block timestamp', async () => {
      beforeEach(async () => {
        const block = await web3.eth.getBlock('latest');
        subjectTimeSeriesState.nextEarliestUpdate = new BigNumber(block.timestamp).add(60);
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
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const oracleAddress = oracleProxy.address;
      linearizedDataSource = await oracleWrapper.deployLinearizedEMADataSourceAsync(
        oracleAddress,
        emaTimePeriod,
      );

      subjectNewOracle = oracleAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return linearizedDataSource.changeOracle.sendTransactionAsync(
        subjectNewOracle,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the Oracle address', async () => {
      await subject();

      const actualOracleAddress = await linearizedDataSource.oracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectNewOracle);
    });

    it('emits correct LogOracleUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogOracleUpdated(
        subjectNewOracle,
        linearizedDataSource.address
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