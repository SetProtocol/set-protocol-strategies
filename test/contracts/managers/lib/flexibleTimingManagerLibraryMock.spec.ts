require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  FlexibleTimingManagerLibraryMockContract
} from '@utils/contracts';
import { Blockchain } from 'set-protocol-contracts';
import { ether } from '@utils/units';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { LibraryMockHelper } from '@utils/helpers/libraryMockHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const blockchain = new Blockchain(web3);
const { expect } = chai;

contract('FlexibleTimingManagerLibraryMock', accounts => {
  const [
    contractDeployer,
  ] = accounts;

  let managerLibraryMock: FlexibleTimingManagerLibraryMockContract;

  const libraryMockHelper = new LibraryMockHelper(contractDeployer);

  beforeEach(async () => {
    await blockchain.saveSnapshotAsync();

    managerLibraryMock = await libraryMockHelper.deployFlexibleTimingManagerLibraryMockAsync();
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

      const expectedDollarValue = ether(300);

      expect(tokenDollarValue).to.bignumber.equal(expectedDollarValue);
    });

    describe('when USD value is less than 18 decimals', async () => {
      beforeEach(async () => {
        subjectUnits = [new BigNumber(1)];
        subjectNaturalUnit = new BigNumber(10 ** 19);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});
