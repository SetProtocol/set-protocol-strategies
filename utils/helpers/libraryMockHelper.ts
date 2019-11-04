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
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();
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
    const managerLibraryMockContract = await ManagerLibraryMock.new(
      { from },
    );

    return new ManagerLibraryMockContract(
      new web3.eth.Contract(managerLibraryMockContract.abi, managerLibraryMockContract.address),
      { from },
    );
  }

  public async deployEMALibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<EMALibraryMockContract> {
    const emaLibraryMockContract = await EMALibraryMock.new(
      { from },
    );

    return new EMALibraryMockContract(
      new web3.eth.Contract(emaLibraryMockContract.abi, emaLibraryMockContract.address),
      { from },
    );
  }

  public async deployFlexibleTimingManagerLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<FlexibleTimingManagerLibraryMockContract> {
    const managerLibraryMockContract = await FlexibleTimingManagerLibraryMock.new(
      { from },
    );

    return new FlexibleTimingManagerLibraryMockContract(
      new web3.eth.Contract(managerLibraryMockContract.abi, managerLibraryMockContract.address),
      { from },
    );
  }

  public async deployPriceFeedMockAsync(
    priceFeed: Address,
    from: Address = this._contractOwnerAddress
  ): Promise<PriceFeedMockContract> {
    const priceFeedTruffle = await PriceFeedMock.new(
      priceFeed,
      { from },
    );

    return new PriceFeedMockContract(
      new web3.eth.Contract(priceFeedTruffle.abi, priceFeedTruffle.address),
      { from },
    );
  }

  public async deployLinkedListHelperMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListHelperMockContract> {
    const linkedListHelper = await LinkedListHelperMock.new(
      { from },
    );

    return new LinkedListHelperMockContract(
      new web3.eth.Contract(linkedListHelper.abi, linkedListHelper.address),
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

  public async deployDataSourceLinearInterpolationLibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<DataSourceLinearInterpolationLibraryMockContract> {
    const interpolationLib = await DataSourceLinearInterpolationLibraryMock.new(
      { from },
    );

    return new DataSourceLinearInterpolationLibraryMockContract(
      new web3.eth.Contract(interpolationLib.abi, interpolationLib.address),
      { from },
    );
  }

  public async deployLinkedListLibraryMockV2Async(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockV2Contract> {
    const linkedList = await LinkedListLibraryMockV2.new(
      { from },
    );

    return new LinkedListLibraryMockV2Contract(
      new web3.eth.Contract(linkedList.abi, linkedList.address),
      { from },
    );
  }

  public async deployLinkedListLibraryMockV3Async(
    from: Address = this._contractOwnerAddress
  ): Promise<LinkedListLibraryMockV3Contract> {
    const linkedList = await LinkedListLibraryMockV3.new(
      { from },
    );

    return new LinkedListLibraryMockV3Contract(
      new web3.eth.Contract(linkedList.abi, linkedList.address),
      { from },
    );
  }

  public async deployRSILibraryMockAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<RSILibraryMockContract> {
    const rsiLibraryMockContract = await RSILibraryMock.new(
      { from },
    );

    return new RSILibraryMockContract(
      new web3.eth.Contract(rsiLibraryMockContract.abi, rsiLibraryMockContract.address),
      { from },
    );
  }

  public async deployAllocatorMathLibraryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<AllocatorMathLibraryMockContract> {
    const mathHelperMockContract = await AllocatorMathLibraryMock.new(
      { from },
    );

    return new AllocatorMathLibraryMockContract(
      new web3.eth.Contract(mathHelperMockContract.abi, mathHelperMockContract.address),
      { from },
    );
  }

  public async deployUintArrayUtilsLibraryAsync(
    from: Address = this._contractOwnerAddress
  ): Promise<UintArrayUtilsLibraryMockContract> {
    await this.linkUintArrayUtilsLibraryAsync(UintArrayUtilsLibraryMock);

    const mathHelperMockContract = await UintArrayUtilsLibraryMock.new(
      { from },
    );

    return new UintArrayUtilsLibraryMockContract(
      new web3.eth.Contract(mathHelperMockContract.abi, mathHelperMockContract.address),
      { from },
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
