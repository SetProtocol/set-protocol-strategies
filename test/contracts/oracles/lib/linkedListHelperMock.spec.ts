require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  LinkedListHelperMockContract,
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  DEFAULT_GAS
} from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import { LibraryMockHelper } from '@utils/helpers/libraryMockHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('LinkedListHelper', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let linkedListLibraryMock: LinkedListHelperMockContract;

  const libraryMockHelper = new LibraryMockHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    linkedListLibraryMock = await libraryMockHelper.deployLinkedListHelperMockAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#getLatestValue', async () => {
    let lastUpdatedIndex: BigNumber;
    let dataArray: BigNumber[];
    let dataSizeLimit: BigNumber;

    let subjectLinkedList: any;

    beforeEach(async () => {
      lastUpdatedIndex = new BigNumber(4);
      dataSizeLimit = new BigNumber(5);

      dataArray = [
        ether(160),
        ether(175),
        ether(157),
        ether(162),
        ether(173),
      ];

      subjectLinkedList = {
        dataSizeLimit,
        lastUpdatedIndex,
        dataArray,
      };
    });

    async function subject(): Promise<BigNumber> {
      return linkedListLibraryMock.getLatestValueMock.callAsync(
        subjectLinkedList,
        { gas: DEFAULT_GAS }
      );
    }

    it('gets the correct last value', async () => {
      const latestValue = await subject();

      expect(latestValue).to.bignumber.equal(dataArray[lastUpdatedIndex.toNumber()]);
    });
  });
});