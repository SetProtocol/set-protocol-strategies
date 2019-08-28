import { Address } from 'set-protocol-utils';
import {
  DataSourceLinearInterpolationLibraryMockContract,
  EMALibraryMockContract,
  FlexibleTimingManagerLibraryMockContract,
  LinkedListHelperMockContract,
  LinkedListLibraryMockContract,
  LinkedListLibraryMockV2Contract,
  ManagerLibraryMockContract,
  PriceFeedMockContract,
} from '../contracts';
import {
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();
const DataSourceLinearInterpolationLibraryMock = artifacts.require('DataSourceLinearInterpolationLibraryMock');
const FlexibleTimingManagerLibraryMock = artifacts.require('FlexibleTimingManagerLibraryMock');
const LinkedListHelperMock = artifacts.require('LinkedListHelperMock');
const LinkedListLibraryMock = artifacts.require('LinkedListLibraryMock');
const LinkedListLibraryMockV2 = artifacts.require('LinkedListLibraryMockV2');
const ManagerLibraryMock = artifacts.require('ManagerLibraryMock');
const EMALibraryMock = artifacts.require('EMALibraryMock');
const PriceFeedMock = artifacts.require('PriceFeedMock');


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
}
