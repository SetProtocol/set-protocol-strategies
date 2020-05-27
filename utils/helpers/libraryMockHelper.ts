import { Address } from 'set-protocol-utils';
import {
  AllocatorMathLibraryMockContract,
  FlexibleTimingManagerLibraryMockContract,
  UintArrayUtilsLibraryMockContract,
} from '../contracts';
import {
  getContractInstance,
  importArtifactsFromSource,
  txnFrom,
} from '../web3Helper';

const AllocatorMathLibraryMock = importArtifactsFromSource('AllocatorMathLibraryMock');
const FlexibleTimingManagerLibraryMock = importArtifactsFromSource('FlexibleTimingManagerLibraryMock');
const UintArrayUtilsLibrary = importArtifactsFromSource('UintArrayUtilsLibrary');
const UintArrayUtilsLibraryMock = importArtifactsFromSource('UintArrayUtilsLibraryMock');

export class LibraryMockHelper {
  private _contractOwnerAddress: Address;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
  }

  /* ============ Deployment ============ */

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
