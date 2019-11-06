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
  TwoAssetLastPeriodPriceOracleContract,
  OracleProxyContract,
  TimeSeriesFeedContract
} from '@utils/contracts';
import { ONE_DAY_IN_SECONDS, ONE_HOUR_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('TwoAssetLastPeriodPriceOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let btcMedianizer: MedianContract;

  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;

  let ethOracleProxy: OracleProxyContract;
  let btcOracleProxy: OracleProxyContract;

  let ethLinearizedDataSource: LinearizedPriceDataSourceContract;
  let btcLinearizedDataSource: LinearizedPriceDataSourceContract;

  let ethTimeSeriesFeed: TimeSeriesFeedContract;
  let btcTimeSeriesFeed: TimeSeriesFeedContract;
  let twoAssetLastPeriodPriceOracle: TwoAssetLastPeriodPriceOracleContract;

  let initialEthPrice: BigNumber;
  let initialBtcPrice: BigNumber;

  const oracleHelper = new OracleHelper(deployerAccount);


  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleHelper.deployMedianizerAsync();
    btcMedianizer = await oracleHelper.deployMedianizerAsync();

    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    ethLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );
    btcLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      btcMedianizer.address,
    );

    ethOracleProxy = await oracleHelper.deployOracleProxyAsync(
      ethLegacyMakerOracleAdapter.address,
    );
    btcOracleProxy = await oracleHelper.deployOracleProxyAsync(
      btcLegacyMakerOracleAdapter.address,
    );

    const interpolationThreshold = ONE_DAY_IN_SECONDS.mul(2);
    ethLinearizedDataSource = await oracleHelper.deployLinearizedPriceDataSourceAsync(
      ethOracleProxy.address,
      interpolationThreshold,
    );
    btcLinearizedDataSource = await oracleHelper.deployLinearizedPriceDataSourceAsync(
      btcOracleProxy.address,
      interpolationThreshold,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      ethOracleProxy,
      [ethLinearizedDataSource.address]
    );
    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      btcOracleProxy,
      [btcLinearizedDataSource.address]
    );

    initialEthPrice = ether(150);
    const ethSeededValues = [initialEthPrice];

    initialBtcPrice = ether(7500);
    const btcSeededValues = [initialBtcPrice];

    ethTimeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      ethLinearizedDataSource.address,
      ethSeededValues
    );

    blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS);

    btcTimeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      btcLinearizedDataSource.address,
      btcSeededValues
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectEthTimeSeriesFeedAddress: Address;
    let subjectBtcTimeSeriesFeedAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectEthTimeSeriesFeedAddress = ethTimeSeriesFeed.address;
      subjectBtcTimeSeriesFeedAddress = btcTimeSeriesFeed.address;
      subjectDataDescription = 'ETHBTCDailyPrice';
    });

    async function subject(): Promise<TwoAssetLastPeriodPriceOracleContract> {
      return oracleHelper.deployTwoAssetLastPeriodPriceOracle(
        subjectEthTimeSeriesFeedAddress,
        subjectBtcTimeSeriesFeedAddress,
        subjectDataDescription
      );
    }

    it('sets the correct base asset time series feed address', async () => {
      twoAssetLastPeriodPriceOracle = await subject();

      const actualPriceFeedAddress = await twoAssetLastPeriodPriceOracle.baseTimeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectEthTimeSeriesFeedAddress);
    });

    it('sets the correct quote asset time series feed address', async () => {
      twoAssetLastPeriodPriceOracle = await subject();

      const actualPriceFeedAddress = await twoAssetLastPeriodPriceOracle.quoteTimeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectBtcTimeSeriesFeedAddress);
    });

    it('sets the correct data description', async () => {
      twoAssetLastPeriodPriceOracle = await subject();

      const actualDataDescription = await twoAssetLastPeriodPriceOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    beforeEach(async () => {
      const dataDescription = 'ETHBTCDailyPrice';

      twoAssetLastPeriodPriceOracle = await oracleHelper.deployTwoAssetLastPeriodPriceOracle(
        ethTimeSeriesFeed.address,
        btcTimeSeriesFeed.address,
        dataDescription
      );
    });

    async function subject(): Promise<BigNumber> {
      return twoAssetLastPeriodPriceOracle.read.callAsync();
    }

    it('returns the correct current price ratio', async () => {
      const actualCurrentPriceRatio = await subject();

      const expectedCurrentPriceRatio = initialEthPrice
                                          .mul(10 ** 18)
                                          .div(initialBtcPrice)
                                          .round(0, BigNumber.ROUND_DOWN);

      expect(actualCurrentPriceRatio).to.be.bignumber.equal(expectedCurrentPriceRatio);
    });
  });
});