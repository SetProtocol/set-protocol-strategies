require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  AllocatorMathLibraryMockContract
} from '@utils/contracts';

import {
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
  ZERO
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';

import { LibraryMockHelper } from '@utils/helpers/libraryMockHelper';
import { ManagerHelper } from '@utils/helpers/managerHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const { expect } = chai;

contract('AllocatorMathLibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  const libraryMockHelper = new LibraryMockHelper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);

  let mathLibraryMock: AllocatorMathLibraryMockContract;

  beforeEach(async () => {
    mathLibraryMock = await libraryMockHelper.deployAllocatorMathLibraryAsync();
  });

  describe('#roundToNearestPowerOfTwo', async () => {
    let subjectValue: number;

    beforeEach(async () => {
      subjectValue = 2 ** 254;
    });

    async function subject(): Promise<BigNumber> {
      return mathLibraryMock.roundToNearestPowerOfTwo.callAsync(
        new BigNumber(subjectValue.toString()),
      );
    }

    it('calculates the correct value', async () => {
      const actualOutput = await subject();

      const expectedOutput = managerHelper.roundToNearestPowerOfTwo(subjectValue);

      expect(actualOutput.toNumber()).to.equal(expectedOutput);
    });

    describe('but value is less than 2 ** 64', async () => {
      beforeEach(async () => {
        subjectValue = 2 ** 53;
      });

      it('should return correct number', async () => {
        const actualOutput = await subject();

        const expectedOutput = managerHelper.roundToNearestPowerOfTwo(subjectValue);

        expect(actualOutput.toNumber()).to.equal(expectedOutput);
      });
    });

    describe('but value is less than 2', async () => {
      beforeEach(async () => {
        subjectValue = 1;
      });

      it('should return correct number', async () => {
        const actualOutput = await subject();

        expect(actualOutput.toNumber()).to.equal(1);
      });
    });
  });

  describe('#ceilLog10', async () => {
    let subjectValue: BigNumber;

    beforeEach(async () => {
      subjectValue = UNLIMITED_ALLOWANCE_IN_BASE_UNITS;
    });

    async function subject(): Promise<BigNumber> {
      return mathLibraryMock.ceilLog10.callAsync(
        subjectValue,
      );
    }

    it('calculates the correct value', async () => {
      const actualOutput = await subject();

      const expectedOutput = managerHelper.ceilLog10(subjectValue);

      expect(actualOutput).to.be.bignumber.equal(expectedOutput);
    });

    describe('but less than 10 ** 64', async () => {
      beforeEach(async () => {
        const rawValue = 1.5 * (10 ** 50);
        subjectValue = new BigNumber(rawValue.toString());
      });

      it('should return correct number', async () => {
        const actualOutput = await subject();

        const expectedOutput = managerHelper.ceilLog10(subjectValue);

        expect(actualOutput).to.be.bignumber.equal(expectedOutput);
      });
    });

    describe('but value is between 1-10', async () => {
      beforeEach(async () => {
        subjectValue = new BigNumber(9);
      });

      it('should return correct number', async () => {
        const actualOutput = await subject();

        expect(actualOutput).to.be.bignumber.equal(new BigNumber(1));
      });
    });

    describe('but value is 1', async () => {
      beforeEach(async () => {
        subjectValue = new BigNumber(1);
      });

      it('should return correct number', async () => {
        const actualOutput = await subject();

        expect(actualOutput).to.be.bignumber.equal(ZERO);
      });
    });

    describe('but value is 0', async () => {
      beforeEach(async () => {
        subjectValue = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});