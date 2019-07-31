import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';
import {
  TimeSeriesFeedMockContract,
  FlexibleTimingManagerLibraryMockContract,
  LinkedListLibraryMockContract,
  ManagerLibraryMockContract,
  PriceFeedMockContract,
} from '../contracts';
import {
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();
const TimeSeriesFeedMock = artifacts.require('TimeSeriesFeedMock');
const FlexibleTimingManagerLibraryMock = artifacts.require('FlexibleTimingManagerLibraryMock');
const LinkedListLibraryMock = artifacts.require('LinkedListLibraryMock');
const ManagerLibraryMock = artifacts.require('ManagerLibraryMock');
const PriceFeedMock = artifacts.require('PriceFeedMock');


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

  public async deployTimeSeriesFeedMockAsync(
    dataSourceAddress: Address,
    updatePeriod: BigNumber,
    maxDataPoints: BigNumber,
    dataDescription: string,
    seededValues: BigNumber[],
    from: Address = this._contractOwnerAddress
  ): Promise<TimeSeriesFeedMockContract> {
    const timeSeriesFeed = await TimeSeriesFeedMock.new(
      updatePeriod,
      maxDataPoints,
      dataSourceAddress,
      dataDescription,
      seededValues,
      { from },
    );

    return new TimeSeriesFeedMockContract(
      new web3.eth.Contract(timeSeriesFeed.abi, timeSeriesFeed.address),
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
