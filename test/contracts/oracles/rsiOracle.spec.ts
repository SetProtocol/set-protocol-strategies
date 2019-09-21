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
  RSIOracleContract,
  OracleProxyContract,
  TimeSeriesFeedContract
} from '@utils/contracts';
import { ONE_DAY_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('rsiOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let rsiOracle: RSIOracleContract;

  let initialEthPrice: BigNumber;

  const oracleHelper = new OracleHelper(deployerAccount);


  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleHelper.deployMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

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
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectTimeSeriesFeedAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectTimeSeriesFeedAddress = timeSeriesFeed.address;
      subjectDataDescription = 'ETHDailyRSI';
    });

    async function subject(): Promise<RSIOracleContract> {
      return oracleHelper.deployRSIOracleAsync(
        subjectTimeSeriesFeedAddress,
        subjectDataDescription
      );
    }

    it('sets the correct time series feed address', async () => {
      rsiOracle = await subject();

      const actualPriceFeedAddress = await rsiOracle.timeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectTimeSeriesFeedAddress);
    });

    it('sets the correct data description', async () => {
      rsiOracle = await subject();

      const actualDataDescription = await rsiOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let rsiTimePeriod: number;
    let updatedValues: BigNumber[];

    let subjectRSITimePeriod: BigNumber;

    beforeEach(async () => {
      rsiTimePeriod = 14;
      const updatedDataPoints = rsiTimePeriod + 1; // n + 1 data points needed for n period RSI
      const updatedValuesReversed = await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedDataPoints,
      );

      // Most recent daily price is first
      updatedValues = updatedValuesReversed.reverse();

      const dataDescription = 'ETHDailyRSI';
      rsiOracle = await oracleHelper.deployRSIOracleAsync(
        timeSeriesFeed.address,
        dataDescription
      );

      subjectRSITimePeriod = new BigNumber(rsiTimePeriod);
    });

    async function subject(): Promise<BigNumber> {
      return rsiOracle.read.callAsync(
        subjectRSITimePeriod
      );
    }

    it('returns the correct RSI', async () => {
      const actualRSI = await subject();

      const expectedRSI = oracleHelper.calculateRSI(
        updatedValues,
      );

      expect(actualRSI).to.be.bignumber.equal(expectedRSI);
    });
  });
});