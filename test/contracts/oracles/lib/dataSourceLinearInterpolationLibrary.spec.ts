require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  DataSourceLinearInterpolationLibraryMockContract,
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  ONE_DAY_IN_SECONDS
} from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { LibraryMockWrapper } from '@utils/wrappers/libraryMockWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('LinkedListLibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let linearInterpolationLibraryMock: DataSourceLinearInterpolationLibraryMockContract;

  const libraryMockWrapper = new LibraryMockWrapper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    linearInterpolationLibraryMock =
      await libraryMockWrapper.deployDataSourceLinearInterpolationLibraryMockAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#interpolateDelayedPriceUpdate', async () => {
    let subjectCurrentPrice: BigNumber;
    let subjectUpdateInterval: BigNumber;
    let subjectTimeFromExpectedUpdate: BigNumber;
    let subjectPreviousLoggedDataPoint: BigNumber;

    beforeEach(async () => {
      subjectCurrentPrice = ether(200);
      subjectUpdateInterval = ONE_DAY_IN_SECONDS.div(4);
      subjectTimeFromExpectedUpdate = ONE_DAY_IN_SECONDS;
      subjectPreviousLoggedDataPoint = ether(100);
    });

    async function subject(): Promise<BigNumber> {
      return linearInterpolationLibraryMock.interpolateDelayedPriceUpdateMock.callAsync(
        subjectCurrentPrice,
        subjectUpdateInterval,
        subjectTimeFromExpectedUpdate,
        subjectPreviousLoggedDataPoint
      );
    }

    it('returns the correct price', async () => {
      const actualOutputPrice = await subject();

      const timeFromLastUpdate = subjectTimeFromExpectedUpdate.add(subjectUpdateInterval);
      const expectedNewPrice = subjectCurrentPrice
                                   .mul(subjectUpdateInterval)
                                   .add(subjectPreviousLoggedDataPoint.mul(subjectTimeFromExpectedUpdate))
                                   .div(timeFromLastUpdate)
                                   .round(0, 3);

      expect(actualOutputPrice).to.be.bignumber.equal(expectedNewPrice);
    });
  });
});