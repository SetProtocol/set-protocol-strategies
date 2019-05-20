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
import { MedianContract } from 'set-protocol-contracts';
import {
  DailyPriceFeedContract,
  MovingAverageOracleContract,
} from '@utils/contracts';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('MovingAverageOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let dailyPriceFeed: DailyPriceFeedContract;
  let movingAverageOracle: MovingAverageOracleContract;

  let initialEthPrice: BigNumber;

  const oracleWrapper = new OracleWrapper(deployerAccount);


  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleWrapper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    const feedDataDescription = '200DailyETHPrice';
    dailyPriceFeed = await oracleWrapper.deployDailyPriceFeedAsync(
      ethMedianizer.address,
      feedDataDescription
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe.only('#constructor', async () => {
    let subjectPriceFeedAddress: Address;
    let subjectDataPoints: BigNumber;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectPriceFeedAddress = dailyPriceFeed.address;
      subjectDataPoints = new BigNumber(20);
      subjectDataDescription = 'ETH20dayMA';
    });

    async function subject(): Promise<MovingAverageOracleContract> {
      return oracleWrapper.deployMovingAverageOracleAsync(
        subjectPriceFeedAddress,
        subjectDataPoints,
        subjectDataDescription
      );
    }

    it('sets the correct price feed address', async () => {
      movingAverageOracle = await subject();

      const actualPriceFeedAddress = await movingAverageOracle.priceFeedAddress.callAsync();

      expect(actualPriceFeedAddress).to.equal(subjectPriceFeedAddress);
    });

    it('sets the correct data points amount', async () => {
      movingAverageOracle = await subject();

      const actualDataPoints = await movingAverageOracle.dataPoints.callAsync();

      expect(actualDataPoints).to.be.bignumber.equal(subjectDataPoints);
    });

    it('sets the correct data description', async () => {
      movingAverageOracle = await subject();

      const actualDataDescription = await movingAverageOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });
});