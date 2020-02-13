import { Address } from 'set-protocol-utils';
import {
  AllocatorMathLibraryMockContract,
  FlexibleTimingManagerLibraryMockContract,
  ManagerLibraryMockContract,
  UintArrayUtilsLibraryMockContract,
} from '../contracts';
import {
  getContractInstance,
  txnFrom,
} from '../web3Helper';

const AllocatorMathLibraryMock = artifacts.require('AllocatorMathLibraryMock');
const FlexibleTimingManagerLibraryMock = artifacts.require('FlexibleTimingManagerLibraryMock');
const ManagerLibraryMock = artifacts.require('ManagerLibraryMock');
const UintArrayUtilsLibrary = artifacts.require('UintArrayUtilsLibrary');
const UintArrayUtilsLibraryMock = artifacts.require('UintArrayUtilsLibraryMock');

export class LibraryMockHelper {
  private _contractOwnerAddress: Address;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
  }

  /* ============ Deployment ============ */

  public async deployManagerLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<ManagerLibraryMockContract> {
    const managerLibraryMockContract = await ManagerLibraryMock.new(txnFrom(from));

    return new ManagerLibraryMockContract(
      getContractInstance(managerLibraryMockContract),
      txnFrom(from),
    );
  }

  public async deployFlexibleTimingManagerLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<FlexibleTimingManagerLibraryMockContract> {
    const managerLibraryMockContract = await FlexibleTimingManagerLibraryMock.new(txnFrom(from));

    return new FlexibleTimingManagerLibraryMockContract(
      getContractInstance(managerLibraryMockContract),
      txnFrom(from),
    );
  }

  public async deployAllocatorMathLibraryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<AllocatorMathLibraryMockContract> {
    const mathHelperMockContract = await AllocatorMathLibraryMock.new(txnFrom(from));

    return new AllocatorMathLibraryMockContract(
      getContractInstance(mathHelperMockContract),
      txnFrom(from),
    );
  }

  public async deployUintArrayUtilsLibraryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<UintArrayUtilsLibraryMockContract> {
    await this.linkUintArrayUtilsLibraryAsync(UintArrayUtilsLibraryMock);

    const mathHelperMockContract = await UintArrayUtilsLibraryMock.new(txnFrom(from));

    return new UintArrayUtilsLibraryMockContract(
      getContractInstance(mathHelperMockContract),
      txnFrom(from),
    );
  }

  public async linkUintArrayUtilsLibraryAsync(
    contract: any,
  ): Promise<void> {
    const truffleUintArrayUtilsLibrary = await UintArrayUtilsLibrary.new(
      { from: this._contractOwnerAddress },
    );

    await contract.link('UintArrayUtilsLibrary', truffleUintArrayUtilsLibrary.address);
  }
}
