import { Address } from 'set-protocol-utils';
import {
  AllocatorMathLibraryMockContract,
  DataSourceLinearInterpolationLibraryMockContract,
  EMALibraryMockContract,
  RSILibraryMockContract,
  FlexibleTimingManagerLibraryMockContract,
  LinkedListHelperMockContract,
  LinkedListLibraryMockContract,
  LinkedListLibraryMockV2Contract,
  LinkedListLibraryMockV3Contract,
  ManagerLibraryMockContract,
  PriceFeedMockContract,
  UintArrayUtilsLibraryMockContract,
} from '../contracts';
import {
  getContractInstance,
  txnFrom,
} from '../web3Helper';

const AllocatorMathLibraryMock = artifacts.require('AllocatorMathLibraryMock');
const DataSourceLinearInterpolationLibraryMock = artifacts.require('DataSourceLinearInterpolationLibraryMock');
const FlexibleTimingManagerLibraryMock = artifacts.require('FlexibleTimingManagerLibraryMock');
const LinkedListHelperMock = artifacts.require('LinkedListHelperMock');
const LinkedListLibraryMock = artifacts.require('LinkedListLibraryMock');
const LinkedListLibraryMockV2 = artifacts.require('LinkedListLibraryMockV2');
const LinkedListLibraryMockV3 = artifacts.require('LinkedListLibraryMockV3');
const ManagerLibraryMock = artifacts.require('ManagerLibraryMock');
const EMALibraryMock = artifacts.require('EMALibraryMock');
const PriceFeedMock = artifacts.require('PriceFeedMock');
const RSILibraryMock = artifacts.require('RSILibraryMock');
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

  public async deployEMALibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<EMALibraryMockContract> {
    const emaLibraryMockContract = await EMALibraryMock.new(txnFrom(from));

    return new EMALibraryMockContract(
      getContractInstance(emaLibraryMockContract),
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

  public async deployPriceFeedMockAsync(
    priceFeed: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<PriceFeedMockContract> {
    const priceFeedTruffle = await PriceFeedMock.new(
      priceFeed,
      txnFrom(from),
    );

    return new PriceFeedMockContract(
      getContractInstance(priceFeedTruffle),
      txnFrom(from),
    );
  }

  public async deployLinkedListHelperMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListHelperMockContract> {
    const linkedListHelper = await LinkedListHelperMock.new(txnFrom(from));

    return new LinkedListHelperMockContract(
      getContractInstance(linkedListHelper),
      txnFrom(from),
    );
  }

  public async deployLinkedListLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockContract> {
    const linkedList = await LinkedListLibraryMock.new(txnFrom(from));

    return new LinkedListLibraryMockContract(
      getContractInstance(linkedList),
      txnFrom(from),
    );
  }

  public async deployDataSourceLinearInterpolationLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<DataSourceLinearInterpolationLibraryMockContract> {
    const interpolationLib = await DataSourceLinearInterpolationLibraryMock.new(txnFrom(from));

    return new DataSourceLinearInterpolationLibraryMockContract(
      getContractInstance(interpolationLib),
      txnFrom(from),
    );
  }

  public async deployLinkedListLibraryMockV2Async(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockV2Contract> {
    const linkedList = await LinkedListLibraryMockV2.new(txnFrom(from));

    return new LinkedListLibraryMockV2Contract(
      getContractInstance(linkedList),
      txnFrom(from),
    );
  }

  public async deployLinkedListLibraryMockV3Async(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockV3Contract> {
    const linkedList = await LinkedListLibraryMockV3.new(txnFrom(from));

    return new LinkedListLibraryMockV3Contract(
      getContractInstance(linkedList),
      txnFrom(from),
    );
  }

  public async deployRSILibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<RSILibraryMockContract> {
    const rsiLibraryMockContract = await RSILibraryMock.new(txnFrom(from));

    return new RSILibraryMockContract(
      getContractInstance(rsiLibraryMockContract),
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
