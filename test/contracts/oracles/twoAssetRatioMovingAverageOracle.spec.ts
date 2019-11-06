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
  TwoAssetRatioMovingAverageOracleContract,
  OracleProxyContract,
  TimeSeriesFeedContract
} from '@utils/contracts';
import { ZERO, ONE_DAY_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('TwoAssetRatioMovingAverageOracle', accounts => {
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
  let movingAverageOracle: TwoAssetRatioMovingAverageOracleContract;

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
      subjectDataDescription = 'ETHBTCDailyMA';
    });

    async function subject(): Promise<TwoAssetRatioMovingAverageOracleContract> {
      return oracleHelper.deployTwoAssetRatioMovingAverageOracleAsync(
        subjectEthTimeSeriesFeedAddress,
        subjectBtcTimeSeriesFeedAddress,
        subjectDataDescription
      );
    }

    it('sets the correct base asset time series feed address', async () => {
      movingAverageOracle = await subject();

      const actualPriceFeedAddress = await movingAverageOracle.baseTimeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectEthTimeSeriesFeedAddress);
    });

    it('sets the correct quote asset time series feed address', async () => {
      movingAverageOracle = await subject();

      const actualPriceFeedAddress = await movingAverageOracle.quoteTimeSeriesFeedInstance.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectBtcTimeSeriesFeedAddress);
    });

    it('sets the correct data description', async () => {
      movingAverageOracle = await subject();

      const actualDataDescription = await movingAverageOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let ethBtcUpdatedValues: BigNumber[][];

    let subjectDataPoints: BigNumber;

    beforeEach(async () => {
      const ethBtcPriceArray = [
        [ether(101), ether(8101.23)],
        [ether(102), ether(9102.54)],
        [ether(105), ether(8815.55)],
        [ether(107), ether(8507.12)],
        [ether(107), ether(8507.09)],
        [ether(107), ether(8507.17)],
        [ether(107), ether(8507)],
        [ether(107), ether(8507)],
        [ether(107), ether(8507)],
        [ether(107), ether(8502)],
        [ether(107), ether(8507)],
        [ether(107), ether(8507)],
        [ether(107), ether(8507)],
        [ether(107), ether(8507)],
        [ether(107), ether(4507)],
        [ether(107), ether(8505.32)],
        [ether(107), ether(9507)],
        [ether(107), ether(10507)],
        [ether(107), ether(9507)],
      ];
      ethBtcUpdatedValues = await oracleHelper.batchUpdateTimeSeriesFeedsAsync(
        [ethTimeSeriesFeed, btcTimeSeriesFeed],
        [ethMedianizer, btcMedianizer],
        19,
        ethBtcPriceArray
      );

      const dataDescription = 'ETHBTC20dayMA';
      movingAverageOracle = await oracleHelper.deployTwoAssetRatioMovingAverageOracleAsync(
        ethTimeSeriesFeed.address,
        btcTimeSeriesFeed.address,
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

      ethBtcUpdatedValues.push([initialEthPrice, initialBtcPrice]);
      const expectedMovingAverage = ethBtcUpdatedValues
                                      .reduce((a, b, c) =>
                                        b[0].mul(10 ** 18).div(b[1]).round(0, BigNumber.ROUND_DOWN).add(a), ZERO)
                                      .div(subjectDataPoints)
                                      .round(0, BigNumber.ROUND_DOWN);

      expect(actualMovingAverage).to.be.bignumber.equal(expectedMovingAverage);
    });
  });
});