require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  EMALibraryMockContract,
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import { getWeb3 } from '@utils/web3Helper';

import { LibraryMockHelper } from '@utils/helpers/libraryMockHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('EMALibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let emaLibraryMock: EMALibraryMockContract;

  const libraryMockHelper = new LibraryMockHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    emaLibraryMock = await libraryMockHelper.deployEMALibraryMockAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#calculate', async () => {
    let subjectPreviousEMAValue: BigNumber;
    let subjectTimePeriod: BigNumber;
    let subjectCurrentAssetPrice: BigNumber;

    let customPreviousEMAValue: BigNumber;
    let customTimePeriod: BigNumber;
    let customCurrentAssetPrice: BigNumber;

    beforeEach(async () => {
      subjectPreviousEMAValue = customPreviousEMAValue || ether(200);
      subjectTimePeriod = customTimePeriod || new BigNumber(26);
      subjectCurrentAssetPrice = customCurrentAssetPrice || ether(300);
    });

    afterEach(async () => {
      customPreviousEMAValue = undefined;
      customTimePeriod = undefined;
      customCurrentAssetPrice = undefined;
    });

    async function subject(): Promise<BigNumber> {
      return emaLibraryMock.calculateMock.callAsync(
        subjectPreviousEMAValue,
        subjectTimePeriod,
        subjectCurrentAssetPrice,
      );
    }

    it('returns the correct price', async () => {
      const output = await subject();
      const expectedOutput = oracleHelper.calculateEMA(
        subjectPreviousEMAValue,
        subjectTimePeriod,
        subjectCurrentAssetPrice,
      );
      expect(output).to.be.bignumber.equal(expectedOutput);
    });

    describe('using custom value set 1', async () => {
      before(async () => {
        customPreviousEMAValue = ether(1.5558);
        customTimePeriod = new BigNumber(4);
        customCurrentAssetPrice = ether(1.556);
      });

      it('returns the correct price', async () => {
        const output = await subject();
        const expectedOutput = oracleHelper.calculateEMA(
          subjectPreviousEMAValue,
          subjectTimePeriod,
          subjectCurrentAssetPrice,
        );
        expect(output).to.be.bignumber.equal(expectedOutput);
      });
    });
  });
});
