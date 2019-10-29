require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  UintArrayUtilsLibraryMockContract,
} from '@utils/contracts';


import { LibraryMockHelper } from '@utils/helpers/libraryMockHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const { expect } = chai;

contract('AllocatorMathLibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  const libraryMockHelper = new LibraryMockHelper(deployerAccount);

  let arrayLibraryMock: UintArrayUtilsLibraryMockContract;

  beforeEach(async () => {
    arrayLibraryMock = await libraryMockHelper.deployUintArrayUtilsLibraryAsync();
  });

  describe('#sumArrayValues', async () => {
    let subjectArray: BigNumber[];

    beforeEach(async () => {
      subjectArray = [new BigNumber(156), new BigNumber(245), new BigNumber(574)];
    });

    async function subject(): Promise<BigNumber> {
      return arrayLibraryMock.sumArrayValues.callAsync(
        subjectArray,
      );
    }

    it('calculates the correct value', async () => {
      const actualOutput = await subject();

      expect(actualOutput).to.be.bignumber.equal(new BigNumber(975));
    });
  });
});