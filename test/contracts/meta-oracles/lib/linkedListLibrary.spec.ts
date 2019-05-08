require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  LinkedListLibraryMockContract,
} from '@utils/contracts';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  ZERO,
  DEFAULT_GAS
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('LinkedListLibrary', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let linkedListLibraryMock: LinkedListLibraryMockContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    linkedListLibraryMock = await oracleWrapper.deployLinkedListLibraryMockAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#initialize', async () => {
    let subjectDataSizeLimit: BigNumber;
    let subjectInitialValue: BigNumber;

    beforeEach(async () => {
      subjectDataSizeLimit = new BigNumber(200);
      subjectInitialValue = ether(150);
    });

    async function subject(): Promise<string> {
      return linkedListLibraryMock.initialize.sendTransactionAsync(
        subjectDataSizeLimit,
        subjectInitialValue,
        { gas: DEFAULT_GAS}
      );
    }

    it('sets correct data size limit', async () => {
      await subject();

      const actualDataSizeLimit = await linkedListLibraryMock.getDataSizeLimit.callAsync();

      expect(actualDataSizeLimit).to.be.bignumber.equal(subjectDataSizeLimit);
    });

    it('sets correct last updated index', async () => {
      await subject();

      const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();

      expect(actualLastUpdatedIndex).to.be.bignumber.equal(ZERO);
    });

    it('sets correct data array', async () => {
      await subject();

      const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const expectedDataArray = [subjectInitialValue];

      expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
    });

    it('sets correct node link for index 0', async () => {
      await subject();

      const actualNodeLink = await linkedListLibraryMock.getNodeLink.callAsync(ZERO);
      const expectedNodeLink = subjectDataSizeLimit.sub(1);

      expect(actualNodeLink).to.be.bignumber.equal(expectedNodeLink);
    });
  });

  describe('#addNode', async () => {
    let initialValue: BigNumber;
    let dataSizeLimit: BigNumber;

    let subjectAddedValue: BigNumber;

    beforeEach(async () => {
      initialValue = ether(150);
      dataSizeLimit = new BigNumber(2);
      await linkedListLibraryMock.initialize.sendTransactionAsync(
        dataSizeLimit,
        initialValue,
        { gas: DEFAULT_GAS}
      );

      subjectAddedValue = ether(160);
    });

    async function subject(): Promise<string> {
      return linkedListLibraryMock.addNode.sendTransactionAsync(
        subjectAddedValue,
        { gas: DEFAULT_GAS}
      );
    }

    it('sets correct last updated index', async () => {
      await subject();

      const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();
      const expectedLastUpdatedIndex = new BigNumber(1);
      expect(actualLastUpdatedIndex).to.be.bignumber.equal(expectedLastUpdatedIndex);
    });

    it('sets correct data array', async () => {
      await subject();

      const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const expectedDataArray = [initialValue, subjectAddedValue];

      expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
    });

    it('sets correct node link for index 1', async () => {
      await subject();

      const actualNodeLink = await linkedListLibraryMock.getNodeLink.callAsync(new BigNumber(1));
      const expectedNodeLink = ZERO;

      expect(actualNodeLink).to.be.bignumber.equal(expectedNodeLink);
    });

    describe('when attempting to add node that exceeds data size limit', async () => {
      beforeEach(async () => {
        await subject();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#updateNode', async () => {
    let initialValue: BigNumber;
    let addedValue: BigNumber;
    let dataSizeLimit: BigNumber;
    let biggerDataLimit: BigNumber;

    let subjectUpdatedValue: BigNumber;

    beforeEach(async () => {
      initialValue = ether(150);
      dataSizeLimit = biggerDataLimit || new BigNumber(2);
      await linkedListLibraryMock.initialize.sendTransactionAsync(
        dataSizeLimit,
        initialValue,
        { gas: DEFAULT_GAS}
      );

      addedValue = ether(160);
      await linkedListLibraryMock.addNode.sendTransactionAsync(
        addedValue,
        { gas: DEFAULT_GAS}
      );

      subjectUpdatedValue = ether(170);
    });

    async function subject(): Promise<string> {
      return linkedListLibraryMock.updateNode.sendTransactionAsync(
        subjectUpdatedValue,
        { gas: DEFAULT_GAS}
      );
    }

    it('sets correct last updated index', async () => {
      await subject();

      const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();
      const expectedLastUpdatedIndex = ZERO;
      expect(actualLastUpdatedIndex).to.be.bignumber.equal(expectedLastUpdatedIndex);
    });

    it('sets correct data array', async () => {
      await subject();

      const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const expectedDataArray = [subjectUpdatedValue, addedValue];

      expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
    });

    describe('when not updating existing node at beginning of array', async () => {
      beforeEach(async () => {
        await subject();
      });

      it('sets correct last updated index', async () => {
        await subject();

        const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();
        const expectedLastUpdatedIndex = new BigNumber(1);
        expect(actualLastUpdatedIndex).to.be.bignumber.equal(expectedLastUpdatedIndex);
      });

      it('sets correct data array', async () => {
        await subject();

        const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
        const expectedDataArray = [subjectUpdatedValue, subjectUpdatedValue];

        expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
      });
    });

    describe('when attempting to update a non-existent node', async () => {
      before(async () => {
        biggerDataLimit = new BigNumber(3);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#editList', async () => {
    let initialValue: BigNumber;
    let addedValue: BigNumber;
    let dataSizeLimit: BigNumber;

    let subjectUpdatedValue: BigNumber;

    beforeEach(async () => {
      initialValue = ether(150);
      dataSizeLimit = new BigNumber(2);
      await linkedListLibraryMock.initialize.sendTransactionAsync(
        dataSizeLimit,
        initialValue,
        { gas: DEFAULT_GAS}
      );

      subjectUpdatedValue = ether(170);
    });

    async function subject(): Promise<string> {
      return linkedListLibraryMock.editList.sendTransactionAsync(
        subjectUpdatedValue,
        { gas: DEFAULT_GAS}
      );
    }

    it('sets correct last updated index', async () => {
      await subject();

      const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();
      const expectedLastUpdatedIndex = new BigNumber(1);
      expect(actualLastUpdatedIndex).to.be.bignumber.equal(expectedLastUpdatedIndex);
    });

    it('sets correct data array', async () => {
      await subject();

      const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const expectedDataArray = [initialValue, subjectUpdatedValue];

      expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
    });

    it('adds node to list', async () => {
      const oldDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const oldDataArrayLength = oldDataArray.length;
      const oldExpectedLength = 1;

      expect(oldDataArrayLength).to.equal(oldExpectedLength);

      await subject();

      const newDataArray = await linkedListLibraryMock.getDataArray.callAsync();
      const newDataArrayLength = newDataArray.length;
      const newExpectedLength = 2;

      expect(newDataArrayLength).to.equal(newExpectedLength);
    });

    describe('when updating existing node', async () => {
      beforeEach(async () => {
        addedValue = ether(160);
        await linkedListLibraryMock.addNode.sendTransactionAsync(
          addedValue
        );
      });

      it('sets correct last updated index', async () => {
        await subject();

        const actualLastUpdatedIndex = await linkedListLibraryMock.getLastUpdatedIndex.callAsync();
        const expectedLastUpdatedIndex = ZERO;
        expect(actualLastUpdatedIndex).to.be.bignumber.equal(expectedLastUpdatedIndex);
      });

      it('sets correct data array', async () => {
        await subject();

        const actualDataArray = await linkedListLibraryMock.getDataArray.callAsync();
        const expectedDataArray = [subjectUpdatedValue, addedValue];

        expect(JSON.stringify(actualDataArray)).to.equal(JSON.stringify(expectedDataArray));
      });
    });
  });
});