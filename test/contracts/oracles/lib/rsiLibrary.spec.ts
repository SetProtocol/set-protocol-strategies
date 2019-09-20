require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  RSILibraryMockContract,
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

contract('RSILibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let rsiLibraryMock: RSILibraryMockContract;

  const libraryMockHelper = new LibraryMockHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    rsiLibraryMock = await libraryMockHelper.deployRSILibraryMockAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#calculate', async () => {
    let subjectTimePeriod: number;
    let subjectSeededValues: BigNumber[];

    let customTimePeriod: number;
    let customSeededValues: BigNumber[];

    beforeEach(async () => {
      subjectTimePeriod = customTimePeriod || 14;
      subjectSeededValues = customSeededValues ||
        Array.from({length: subjectTimePeriod}, () => ether(Math.floor(Math.random() * 100) + 100));
    });

    afterEach(async () => {
      customTimePeriod = undefined;
      customSeededValues = undefined;
    });

    async function subject(): Promise<BigNumber> {
      return rsiLibraryMock.calculateMock.callAsync(
        subjectSeededValues,
      );
    }

    it('returns the correct RSI value', async () => {
      const output = await subject();
      const expectedOutput = oracleHelper.calculateRSI(
        subjectSeededValues,
      );
      expect(output).to.be.bignumber.equal(expectedOutput);
    });

    describe('using custom seeded values', async () => {
      before(async () => {
        customSeededValues = [ether(1.5), ether(2), ether(1.5), ether(3)];
      });

      afterEach(async () => {
        customSeededValues = undefined;
      });

      it('returns the correct RSI value', async () => {
        const output = await subject();
        expect(output).to.be.bignumber.equal(20);
      });
    });

    describe('using custom seeded values where prices keep declining', async () => {
      before(async () => {
        customSeededValues = [ether(1.143), ether(1.243), ether(1.343)];
      });

      afterEach(async () => {
        customSeededValues = undefined;
      });

      it('returns the correct RSI value of 0', async () => {
        const output = await subject();
        expect(output).to.be.bignumber.equal(0);
      });
    });

    describe('using custom seeded values where prices keep rising', async () => {
      before(async () => {
        customSeededValues = [ether(1.643), ether(1.642), ether(1.641), ether(1.640), ether(1.639)];
      });

      afterEach(async () => {
        customSeededValues = undefined;
      });

      it('returns the correct RSI value of 100', async () => {
        const output = await subject();
        expect(output).to.be.bignumber.equal(100);
      });
    });

    describe('using only one seeded value', async () => {
      before(async () => {
        customSeededValues = [ether(1.643)];
      });

      afterEach(async () => {
        customSeededValues = undefined;
      });

      it('returns the correct RSI value of 0', async () => {
        const output = await subject();
        const expectedOutput = oracleHelper.calculateRSI(
          subjectSeededValues,
        );
        expect(output).to.be.bignumber.equal(expectedOutput);
      });
    });
  });
});
