require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { MedianContract } from 'set-protocol-contracts';
import {
  DataFeedContract,
  LinearizedPriceDataSourceContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('DataFeed with DataSource', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let dataFeed: DataFeedContract;
  let dataSource: LinearizedPriceDataSourceContract;
  let ethMedianizer: MedianContract;

  let initialEthPrice: BigNumber;
  let updateInterval: BigNumber;
  let interpolationThreshold: BigNumber;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleWrapper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000000000),
    );

    // Deploy DataSource
    interpolationThreshold = ONE_DAY_IN_SECONDS.div(4);
    dataSource = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
      ethMedianizer.address,
      interpolationThreshold,
    );

    // Deploy DataFeed
    updateInterval = ONE_DAY_IN_SECONDS;
    const maxDataPoints = new BigNumber(200);
    const sourceDataAddress = dataSource.address;
    const dataDescription = '200DailyETHPrice';
    const seededValues = [initialEthPrice];
    dataFeed = await oracleWrapper.deployDataFeedAsync(
      sourceDataAddress,
      updateInterval,
      maxDataPoints,
      dataDescription,
      seededValues
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#dataFeed.poke with DataSource connected', async () => {
    let newEthPrice: BigNumber;

    let subjectTimeFastForward: BigNumber;

    let customEthPrice: BigNumber;

    beforeEach(async () => {
      newEthPrice = customEthPrice || ether(160);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000000000)
      );

      subjectTimeFastForward = updateInterval;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return dataFeed.poke.sendTransactionAsync(
        { gas: DEFAULT_GAS}
      );
    }

    it('updates the dataFeed with the correct price', async () => {
      await subject();

      const actualNewPrice = await dataFeed.read.callAsync(new BigNumber(2));
      const expectedNewPrice = [newEthPrice, initialEthPrice];

      expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
    });

    it('sets the nextEarliestUpdate timestamp to previous timestamp plus 24 hours', async () => {
      const previousTimestamp = await dataFeed.nextEarliestUpdate.callAsync();

      await subject();

      const actualTimestamp = await dataFeed.nextEarliestUpdate.callAsync();
      const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('when update occured after the interpolationThreshold and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = updateInterval.add(interpolationThreshold);
      });

      it('updates the dataFeed with the correct linearized price', async () => {
        const nextEarliestUpdate = await dataFeed.nextEarliestUpdate.callAsync();
        const lastUpdateTimestamp = nextEarliestUpdate.sub(ONE_DAY_IN_SECONDS);

        await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const actualNewPrice = await dataFeed.read.callAsync(new BigNumber(2));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextEarliestUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const linearizedEthPrice = newEthPrice
                                     .mul(updateInterval)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);
        const expectedNewPrice = [linearizedEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextEarliestUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await dataFeed.nextEarliestUpdate.callAsync();

        await subject();

        const actualTimestamp = await dataFeed.nextEarliestUpdate.callAsync();
        const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
        expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
      });
    });


    describe('when update occured after the interpolationThreshold and price decreases', async () => {
      before(async () => {
        customEthPrice = ether(140);
      });

      beforeEach(async () => {
        subjectTimeFastForward = updateInterval.add(interpolationThreshold);
      });

      it('updates the dataFeed with the correct linearized price', async () => {
        const nextEarliestUpdate = await dataFeed.nextEarliestUpdate.callAsync();
        const lastUpdateTimestamp = nextEarliestUpdate.sub(ONE_DAY_IN_SECONDS);

        await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const actualNewPrice = await dataFeed.read.callAsync(new BigNumber(2));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextEarliestUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const linearizedEthPrice = newEthPrice
                                     .mul(updateInterval)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);
        const expectedNewPrice = [linearizedEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextEarliestUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await dataFeed.nextEarliestUpdate.callAsync();

        await subject();

        const actualTimestamp = await dataFeed.nextEarliestUpdate.callAsync();
        const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
        expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
      });
    });

    describe('when previous update was late but not past interpolationThreshold so next update happens on time'
    , async () => {
      beforeEach(async () => {
        const laggedUpdateTime = ONE_DAY_IN_SECONDS.add(ONE_HOUR_IN_SECONDS);
        await blockchain.increaseTimeAsync(laggedUpdateTime);
        await dataFeed.poke.sendTransactionAsync(
          { gas: DEFAULT_GAS}
        );

        subjectTimeFastForward = ONE_DAY_IN_SECONDS.sub(ONE_HOUR_IN_SECONDS).add(1);
      });

      it('updates the dataFeed with the correct price', async () => {
        await subject();

        const actualNewPrice = await dataFeed.read.callAsync(new BigNumber(3));
        const expectedNewPrice = [newEthPrice, newEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextEarliestUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await dataFeed.nextEarliestUpdate.callAsync();

        await subject();

        const actualTimestamp = await dataFeed.nextEarliestUpdate.callAsync();
        const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
        expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
      });
    });

    describe('when not enough time has passed to update', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = new BigNumber(1);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});