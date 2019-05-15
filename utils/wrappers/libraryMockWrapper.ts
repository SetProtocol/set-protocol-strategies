import { Address } from 'set-protocol-utils';
import {
  LinkedListLibraryMockContract,
  ManagerLibraryMockContract,
} from '../contracts';
import {
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();
const LinkedListLibraryMock = artifacts.require('LinkedListLibraryMock');
const ManagerLibraryMock = artifacts.require('ManagerLibraryMock');


export class LibraryMockWrapper {
  private _contractOwnerAddress: Address;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
  }

  /* ============ Deployment ============ */

  public async deployManagerLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<ManagerLibraryMockContract> {
    const managerLibraryMockContract = await ManagerLibraryMock.new(
      { from },
    );

    return new ManagerLibraryMockContract(
      new web3.eth.Contract(managerLibraryMockContract.abi, managerLibraryMockContract.address),
      { from },
    );
  }

  public async deployLinkedListLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockContract> {
    const linkedList = await LinkedListLibraryMock.new(
      { from },
    );

    return new LinkedListLibraryMockContract(
      new web3.eth.Contract(linkedList.abi, linkedList.address),
      { from },
    );
  }
}