require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { MedianContract } from 'set-protocol-contracts';
import {
  HistoricalPriceFeedContract,
  MovingAverageOracleContract,
} from '@utils/contracts';
import { ONE_DAY_IN_SECONDS } from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('MovingAverageOracle:Scenario', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let dailyPriceFeed: HistoricalPriceFeedContract;
  let movingAverageOracle: MovingAverageOracleContract;

  let initialEthPrice: BigNumber;

  const oracleWrapper = new OracleWrapper(deployerAccount);


  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = new BigNumber(251720000000000000000);
    await oracleWrapper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#calculate average with May 2019 price data', async () => {
    const seededValues: BigNumber[] = [
      new BigNumber(158500000000000000000),
      new BigNumber(157290000000000000000),
      new BigNumber(155170000000000000000),
      new BigNumber(162190000000000000000),
      new BigNumber(160850000000000000000),
      new BigNumber(162080000000000000000),
      new BigNumber(167890000000000000000),
      new BigNumber(164020000000000000000),
      new BigNumber(163340000000000000000),
      new BigNumber(172430000000000000000),
      new BigNumber(169900000000000000000),
      new BigNumber(170950000000000000000),
      new BigNumber(170310000000000000000),
      new BigNumber(173140000000000000000),
      new BigNumber(194160000000000000000),
      new BigNumber(187420000000000000000),
      new BigNumber(196740000000000000000),
      new BigNumber(217010000000000000000),
      new BigNumber(246940000000000000000),
      new BigNumber(263850000000000000000),
      new BigNumber(243910000000000000000),
      new BigNumber(234450000000000000000),
      new BigNumber(261270000000000000000),
      new BigNumber(251650000000000000000),
      new BigNumber(255000000000000000000),
      new BigNumber(244670000000000000000),
      new BigNumber(245990000000000000000),
      new BigNumber(249690000000000000000),
    ];

    let subjectDataPoints: BigNumber;

    beforeEach(async () => {
      const updateFrequency = ONE_DAY_IN_SECONDS;
      const feedDataDescription = '200DailyETHPrice';
      dailyPriceFeed = await oracleWrapper.deployHistoricalPriceFeedAsync(
        updateFrequency,
        ethMedianizer.address,
        feedDataDescription,
        seededValues,
      );

      const dataDescription = 'ETH20dayMA';
      movingAverageOracle = await oracleWrapper.deployMovingAverageOracleAsync(
        dailyPriceFeed.address,
        dataDescription
      );

      subjectDataPoints = new BigNumber(20);
    });

    async function subject(): Promise<string> {
      return movingAverageOracle.read.callAsync(
        subjectDataPoints
      );
    }

    it('returns the correct moving average', async () => {
      const actualMovingAverage = await subject();

      const expectedMovingAverage = new BigNumber(220060000000000000000);

      expect(actualMovingAverage).to.be.bignumber.equal(expectedMovingAverage);
    });

    describe('after one additional day', async () => {
      beforeEach(async () => {
        const newEthPrice = new BigNumber(267140000000000000000);

        // Update medianizer and price feed
        await oracleWrapper.updateHistoricalPriceFeedAsync(
          dailyPriceFeed,
          ethMedianizer,
          newEthPrice,
        );
      });

      it('returns the correct moving average', async () => {
        const actualMovingAverage = await subject();

        const expectedMovingAverage = new BigNumber(224795500000000000000);

        expect(actualMovingAverage).to.be.bignumber.equal(expectedMovingAverage);
      });
    });
  });
});