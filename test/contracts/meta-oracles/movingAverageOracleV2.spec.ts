require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  LinearizedPriceDataSourceContract,
  MovingAverageOracleV2Contract,
  OracleProxyContract,
  TimeSeriesFeedContract
} from '@utils/contracts';
import { ZERO, ONE_DAY_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('MovingAverageOracleV2', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let movingAverageOracle: MovingAverageOracleV2Contract;

  let initialEthPrice: BigNumber;

  const oracleWrapper = new OracleWrapper(deployerAccount);


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

    const interpolationThreshold = ONE_DAY_IN_SECONDS;
    linearizedDataSource = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
      oracleProxy.address,
      interpolationThreshold,
    );

    await oracleWrapper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [linearizedDataSource.address]
    );

    initialEthPrice = ether(150);
    const seededValues = [initialEthPrice];
    timeSeriesFeed = await oracleWrapper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededValues
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectTimeSeriesFeedAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectTimeSeriesFeedAddress = timeSeriesFeed.address;
      subjectDataDescription = 'ETHDailyMA';
    });

    async function subject(): Promise<MovingAverageOracleV2Contract> {
      return oracleWrapper.deployMovingAverageOracleV2Async(
        subjectTimeSeriesFeedAddress,
        subjectDataDescription
      );
    }

    it('sets the correct time series feed address', async () => {
      movingAverageOracle = await subject();

      const actualPriceFeedAddress = await movingAverageOracle.timeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectTimeSeriesFeedAddress);
    });

    it('sets the correct data description', async () => {
      movingAverageOracle = await subject();

      const actualDataDescription = await movingAverageOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let updatedValues: BigNumber[];

    let subjectDataPoints: BigNumber;

    beforeEach(async () => {
      updatedValues = await oracleWrapper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        19
      );

      const dataDescription = 'ETH20dayMA';
      movingAverageOracle = await oracleWrapper.deployMovingAverageOracleV2Async(
        timeSeriesFeed.address,
        dataDescription
      );

      subjectDataPoints = new BigNumber(20);
    });

    async function subject(): Promise<BigNumber> {
      return movingAverageOracle.read.callAsync(
        subjectDataPoints
      );
    }

    it('returns the correct moving average', async () => {
      const actualMovingAverage = await subject();

      updatedValues.push(initialEthPrice);
      const expectedMovingAverage = updatedValues.reduce((a, b) => a.add(b), ZERO).div(updatedValues.length);

      expect(actualMovingAverage).to.be.bignumber.equal(expectedMovingAverage);
    });
  });
});