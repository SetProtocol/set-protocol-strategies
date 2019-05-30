require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  FlexibleTimingManagerLibraryMockContract
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { getWeb3 } from '@utils/web3Helper';

import { LibraryMockWrapper } from '@utils/wrappers/libraryMockWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const blockchain = new Blockchain(web3);
const { expect } = chai;

contract('ManagerLibraryMock', accounts => {
  const [
    contractDeployer,
  ] = accounts;

  let managerLibraryMock: FlexibleTimingManagerLibraryMockContract;

  const libraryMockWrapper = new LibraryMockWrapper(contractDeployer);

  beforeEach(async () => {
    await blockchain.saveSnapshotAsync();

    managerLibraryMock = await libraryMockWrapper.deployFlexibleTimingManagerLibraryMockAsync();
  });

  afterEach(async () => {
    await blockchain.revertAsync();
  });

  describe('#calculateSetTokenDollarValue', async () => {
    let subjectTokenPrices: BigNumber[];
    let subjectNaturalUnit: BigNumber;
    let subjectUnits: BigNumber[];
    let subjectTokenDecimals: BigNumber[];

    beforeEach(async () => {
      subjectTokenPrices = [ether(150)];
      subjectNaturalUnit = new BigNumber(100);
      subjectUnits = [new BigNumber(200)];
      subjectTokenDecimals = [new BigNumber(18)];
    });

    async function subject(): Promise<any> {
      return managerLibraryMock.calculateSetTokenDollarValue.callAsync(
        subjectTokenPrices,
        subjectNaturalUnit,
        subjectUnits,
        subjectTokenDecimals,
      );
    }

    it('should return the correct set token dollar amount', async () => {
      const tokenDollarValue = await subject();

      const VALUE_TO_CENTS_CONVERSION = new BigNumber(10 ** 16);
      const expectedDollarValue = ether(300).div(VALUE_TO_CENTS_CONVERSION);

      expect(tokenDollarValue).to.bignumber.equal(expectedDollarValue);
    });
  });
});
