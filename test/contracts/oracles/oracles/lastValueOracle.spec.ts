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
  LastValueOracleContract,
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

contract('LastValueOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let medianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;

  let lastValueOracle: LastValueOracleContract;

  let initialPrice: BigNumber;

  const oracleHelper = new OracleHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    medianizer = await oracleHelper.deployMedianizerAsync();

    await oracleHelper.addPriceFeedOwnerToMedianizer(medianizer, deployerAccount);

    legacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      medianizer.address,
    );

    oracleProxy = await oracleHelper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    const interpolationThreshold = ONE_DAY_IN_SECONDS.mul(2);
    linearizedDataSource = await oracleHelper.deployLinearizedPriceDataSourceAsync(
      oracleProxy.address,
      interpolationThreshold,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [linearizedDataSource.address]
    );

    initialPrice = ether(150);
    const seededValues = [initialPrice];

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
      subjectDataDescription = 'ETHDailyPrice';
    });

    async function subject(): Promise<LastValueOracleContract> {
      return oracleHelper.deployLastValueOracleAsync(
        subjectTimeSeriesFeedAddress,
        subjectDataDescription
      );
    }

    it('sets the correct base asset time series feed address', async () => {
      lastValueOracle = await subject();

      const actualPriceFeedAddress = await lastValueOracle.timeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectTimeSeriesFeedAddress);
    });

    it('sets the correct data description', async () => {
      lastValueOracle = await subject();

      const actualDataDescription = await lastValueOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    beforeEach(async () => {
      const dataDescription = 'ETHDailyPrice';

      lastValueOracle = await oracleHelper.deployLastValueOracleAsync(
        timeSeriesFeed.address,
        dataDescription
      );
    });

    async function subject(): Promise<BigNumber> {
      return lastValueOracle.read.callAsync();
    }

    it('returns the correct most recent price on the feed', async () => {
      const actualCurrentPriceRatio = await subject();

      const expectedCurrentPriceRatio = initialPrice;

      expect(actualCurrentPriceRatio).to.be.bignumber.equal(expectedCurrentPriceRatio);
    });
  });
});