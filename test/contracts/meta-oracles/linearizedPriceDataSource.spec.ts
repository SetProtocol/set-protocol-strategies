require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
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
  LinearizedPriceDataSourceContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogMedianizerUpdated } from '@utils/contract_logs/lineraizedPriceDataSource';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const LinearizedPriceDataSource = artifacts.require('LinearizedPriceDataSource');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('LinearizedPriceDataSource', accounts => {
  const [
    deployerAccount,
    medianizerAccount,
    nonOwnerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let historicalPriceFeed: LinearizedPriceDataSourceContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(LinearizedPriceDataSource.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(LinearizedPriceDataSource.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let ethPrice: BigNumber;

    let subjectUpdateTolerance: BigNumber;
    let subjectMedianizerAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      subjectUpdateTolerance = subjectUpdatePeriod.div(4);
      subjectMedianizerAddress = ethMedianizer.address;
      subjectDataDescription = '200DailyETHPrice';
    });

    async function subject(): Promise<LinearizedPriceDataSourceContract> {
      return oracleWrapper.deployLinearizedPriceDataSourceAsync(
        subjectMedianizerAddress,
        subjectUpdateTolerance,
        subjectDataDescription,
      );
    }

    it('sets the correct updateTolerance', async () => {
      historicalPriceFeed = await subject();

      const actualUpdateTolerance = await historicalPriceFeed.updateTolerance.callAsync();

      expect(actualUpdateTolerance).to.be.bignumber.equal(subjectUpdateTolerance);
    });

    it('sets the correct medianizer address', async () => {
      historicalPriceFeed = await subject();

      const actualMedianizerAddress = await historicalPriceFeed.medianizerInstance.callAsync();

      expect(actualMedianizerAddress).to.equal(subjectMedianizerAddress);
    });

    it('sets the correct data description', async () => {
      historicalPriceFeed = await subject();

      const actualDataDescription = await historicalPriceFeed.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    let initialEthPrice: BigNumber;
    let newEthPrice: BigNumber;
    let updatePeriod: BigNumber;
    let updateTolerance: BigNumber;

    let overrideEthPrice: BigNumber = undefined;
    let subjectTimeFastForward: BigNumber;

    beforeEach(async () => {
      initialEthPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        initialEthPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      updatePeriod = ONE_DAY_IN_SECONDS;
      updateTolerance = updatePeriod.div(4);
      const medianizerAddress = ethMedianizer.address;
      historicalPriceFeed = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
        medianizerAddress,
        updatePeriod,
        updateTolerance,
      );

      newEthPrice = overrideEthPrice || ether(160);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        newEthPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return historicalPriceFeed.read.sendTransactionAsync(
        { gas: DEFAULT_GAS}
      );
    }

    it('updates the historicalPriceFeed with the correct price', async () => {
      await subject();

      const actualNewPrice = await historicalPriceFeed.read.callAsync(new BigNumber(2));
      const expectedNewPrice = [newEthPrice, initialEthPrice];

      expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
    });

    it('sets the nextAvailableUpdate timestamp to previous timestamp plus 24 hours', async () => {
      const previousTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();

      await subject();

      const actualTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();
      const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
      expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('when update occured after the updateTolerance and price increases', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = updatePeriod.add(updateTolerance);
      });

      it('updates the historicalPriceFeed with the correct linearized price', async () => {
        const nextAvailableUpdate = await historicalPriceFeed.nextAvailableUpdate.callAsync();
        const lastUpdateTimestamp = nextAvailableUpdate.sub(ONE_DAY_IN_SECONDS);

        await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const actualNewPrice = await historicalPriceFeed.read.callAsync(new BigNumber(2));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextAvailableUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const linearizedEthPrice = newEthPrice
                                     .mul(updatePeriod)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);
        const expectedNewPrice = [linearizedEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextAvailableUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();

        await subject();

        const actualTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();
        const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
        expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
      });
    });

    describe('when update occured after the updateTolerance and price decreases', async () => {
      before(async () => {
        overrideEthPrice = ether(140);
      });

      beforeEach(async () => {
        subjectTimeFastForward = updatePeriod.add(updateTolerance);
      });

      it('updates the historicalPriceFeed with the correct linearized price', async () => {
        const nextAvailableUpdate = await historicalPriceFeed.nextAvailableUpdate.callAsync();
        const lastUpdateTimestamp = nextAvailableUpdate.sub(ONE_DAY_IN_SECONDS);

        await subject();

        const pokeBlock = await web3.eth.getBlock('latest');
        const pokeBlockTimestamp = new BigNumber(pokeBlock.timestamp);

        const actualNewPrice = await historicalPriceFeed.read.callAsync(new BigNumber(2));
        const timeFromExpectedUpdate = pokeBlockTimestamp.sub(nextAvailableUpdate);
        const timeFromLastUpdate = pokeBlockTimestamp.sub(lastUpdateTimestamp);
        const linearizedEthPrice = newEthPrice
                                     .mul(updatePeriod)
                                     .add(initialEthPrice.mul(timeFromExpectedUpdate))
                                     .div(timeFromLastUpdate)
                                     .round(0, 3);
        const expectedNewPrice = [linearizedEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextAvailableUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();

        await subject();

        const actualTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();
        const expectedTimestamp = previousTimestamp.add(ONE_DAY_IN_SECONDS);
        expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
      });
    });

    describe('when previous update was late but not past updateTolerance so next update happens on time', async () => {
      beforeEach(async () => {
        const laggedUpdateTime = ONE_DAY_IN_SECONDS.add(ONE_HOUR_IN_SECONDS);
        await blockchain.increaseTimeAsync(laggedUpdateTime);
        await historicalPriceFeed.poke.sendTransactionAsync(
          { gas: DEFAULT_GAS}
        );

        subjectTimeFastForward = ONE_DAY_IN_SECONDS.sub(ONE_HOUR_IN_SECONDS).add(1);
      });

      it('updates the historicalPriceFeed with the correct price', async () => {
        await subject();

        const actualNewPrice = await historicalPriceFeed.read.callAsync(new BigNumber(3));
        const expectedNewPrice = [newEthPrice, newEthPrice, initialEthPrice];

        expect(JSON.stringify(actualNewPrice)).to.equal(JSON.stringify(expectedNewPrice));
      });

      it('sets the nextAvailableUpdate timestamp to previous timestamp plus 24 hours', async () => {
        const previousTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();

        await subject();

        const actualTimestamp = await historicalPriceFeed.nextAvailableUpdate.callAsync();
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

  describe('#changeMedianizer', async () => {
    let ethPrice: BigNumber;

    let subjectNewMedianizer: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      ethPrice = ether(150);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      const medianizerAddress = ethMedianizer.address;
      historicalPriceFeed = await oracleWrapper.deployLinearizedPriceDataSourceAsync(
        medianizerAddress,
      );

      subjectNewMedianizer = medianizerAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return historicalPriceFeed.changeMedianizer.sendTransactionAsync(
        subjectNewMedianizer,
        {
          from: subjectCaller,
          gas: DEFAULT_GAS,
        }
      );
    }

    it('updates the medianizer address', async () => {
      await subject();

      const actualMedianizerAddress = await historicalPriceFeed.medianizerInstance.callAsync();

      expect(actualMedianizerAddress).to.equal(subjectNewMedianizer);
    });

    it('emits correct LogMedianizerUpdated event', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedLogs = LogMedianizerUpdated(
        subjectNewMedianizer,
        historicalPriceFeed.address
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
  });
});