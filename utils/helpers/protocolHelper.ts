import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';

import {
  Core,
  CoreContract,
  FixedFeeCalculator,
  LinearAuctionLiquidator,
  LinearAuctionPriceCurve,
  LinearAuctionPriceCurveContract,
  MedianContract,
  OracleWhiteList,
  RebalanceAuctionModule,
  RebalanceAuctionModuleContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenV2,
  RebalancingSetTokenV2Contract,
  RebalancingSetTokenFactory,
  RebalancingSetTokenFactoryContract,
  RebalancingSetTokenV2Factory,
  SetToken,
  SetTokenContract,
  SetTokenFactory,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  TransferProxy,
  TransferProxyContract,
  Vault,
  VaultContract,
  WethMockContract,
  WhiteList,
  WhiteListContract,
} from 'set-protocol-contracts';
import { BigNumber } from 'bignumber.js';

import {
  DEFAULT_GAS,
  DEFAULT_UNIT_SHARES,
  DEFAULT_REBALANCING_MAXIMUM_NATURAL_UNIT,
  DEFAULT_REBALANCING_MINIMUM_NATURAL_UNIT,
  DEFAULT_REBALANCING_NATURAL_UNIT,
  ONE_DAY_IN_SECONDS,
} from '../constants';
import { extractNewSetTokenAddressFromLogs } from '../contract_logs/core';
import { getWeb3 } from '../web3Helper';
import { getDeployedAddress } from '../snapshotUtils';

const web3 = getWeb3();

const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);


export class ProtocolHelper {
  private _tokenOwnerAddress: Address;

  constructor(tokenOwnerAddress: Address) {
    this._tokenOwnerAddress = tokenOwnerAddress;
  }

  /* ============ Deployed Contracts ============ */

  public async getDeployedTransferProxyAsync(): Promise<TransferProxyContract> {
    const address = await getDeployedAddress(TransferProxy.contractName);

     return await TransferProxyContract.at(address, web3, {});
  }

  public async getDeployedVaultAsync(): Promise<VaultContract> {
    const address = await getDeployedAddress(Vault.contractName);

     return await VaultContract.at(address, web3, {});
  }

  public async getDeployedSetTokenFactoryAsync(): Promise<SetTokenFactoryContract> {
    const address = await getDeployedAddress(SetTokenFactory.contractName);

     return await SetTokenFactoryContract.at(address, web3, {});
  }

  public async getDeployedRebalancingSetTokenFactoryAsync(): Promise<RebalancingSetTokenFactoryContract> {
    const address = await getDeployedAddress(RebalancingSetTokenFactory.contractName);

     return await RebalancingSetTokenFactoryContract.at(address, web3, {});
  }

  public async getDeployedRebalancingSetTokenFactoryTwoAsync(): Promise<RebalancingSetTokenFactoryContract> {
    const address = await getDeployedAddress(`${RebalancingSetTokenFactory.contractName}-2`);

     return await RebalancingSetTokenFactoryContract.at(address, web3, {});
  }

  public async getDeployedCoreAsync(): Promise<CoreContract> {
    const address = await getDeployedAddress(Core.contractName);

     return await CoreContract.at(address, web3, {});
  }

  public async getDeployedWhiteList(): Promise<WhiteListContract> {
    const address = await getDeployedAddress(WhiteList.contractName);

     return await WhiteListContract.at(address, web3, {});
  }

  public async getDeployedRebalanceAuctionModuleAsync(): Promise<RebalanceAuctionModuleContract> {
    const address = await getDeployedAddress(RebalanceAuctionModule.contractName);

     return await RebalanceAuctionModuleContract.at(address, web3, {});
  }

  public async getDeployedLinearAuctionPriceCurveAsync(): Promise<LinearAuctionPriceCurveContract> {
    const address = await getDeployedAddress(LinearAuctionPriceCurve.contractName);

     return await LinearAuctionPriceCurveContract.at(address, web3, {});
  }

  public async getDeployedWBTCMedianizerAsync(): Promise<MedianContract> {
    const address = await getDeployedAddress('WBTC_MEDIANIZER');

     return await MedianContract.at(address, web3, {});
  }

  public async getDeployedWETHMedianizerAsync(): Promise<MedianContract> {
    const address = await getDeployedAddress('WETH_MEDIANIZER');

     return await MedianContract.at(address, web3, {});
  }

  public async getDeployedWBTCAsync(): Promise<StandardTokenMockContract> {
    const address = await getDeployedAddress('WBTC');

     return await StandardTokenMockContract.at(address, web3, {});
  }

  public async getDeployedWETHAsync(): Promise<WethMockContract> {
    const address = await getDeployedAddress('WETH');

     return await WethMockContract.at(address, web3, {});
  }

  public async getDeployedDAIAsync(): Promise<StandardTokenMockContract> {
    const address = await getDeployedAddress('DAI');

     return await StandardTokenMockContract.at(address, web3, {});
  }

  public async deployWhiteListAsync(
    initialAddresses: Address[] = [],
    from: Address = this._tokenOwnerAddress
  ): Promise<string> {
    const instance = await new web3.eth.Contract(WhiteList.abi).deploy({
      data: WhiteList.bytecode,
      arguments: [
        initialAddresses,
      ],
    }).send({ from, gas: DEFAULT_GAS });

    return instance.options.address;
  }

  public async deployOracleWhiteListAsync(
    initialTokenAddresses: Address[] = [],
    initialOracleAddresses: Address[] = [],
    from: Address = this._tokenOwnerAddress
  ): Promise<string> {
    const instance = await new web3.eth.Contract(OracleWhiteList.abi).deploy({
      data: OracleWhiteList.bytecode,
      arguments: [
        initialTokenAddresses,
        initialOracleAddresses,
      ],
    }).send({ from, gas: DEFAULT_GAS });

    return instance.options.address;
  }

  public async deployLinearLiquidatorAsync(
    core: Address,
    oracleWhiteList: Address,
    auctionPeriod: BigNumber = ONE_DAY_IN_SECONDS.div(6),
    rangeStart: BigNumber = new BigNumber(10),
    rangeEnd: BigNumber = new BigNumber(10),
    name: string = 'Liquidator',
    from: Address = this._tokenOwnerAddress
  ): Promise<string> {
    const instance = await new web3.eth.Contract(LinearAuctionLiquidator.abi).deploy({
      data: LinearAuctionLiquidator.bytecode,
      arguments: [
        core,
        oracleWhiteList,
        auctionPeriod.toString(),
        rangeStart.toString(),
        rangeEnd.toString(),
        name,
      ],
    }).send({ from, gas: DEFAULT_GAS });

    return instance.options.address;
  }

  public async deployFixedFeeCalculatorAsync(
    from: Address = this._tokenOwnerAddress
  ): Promise<string> {
    const instance = await new web3.eth.Contract(FixedFeeCalculator.abi).deploy({
      data: FixedFeeCalculator.bytecode,
      arguments: [],
    }).send({ from, gas: DEFAULT_GAS });

    return instance.options.address;
  }

  /* ============ CoreFactory Extension ============ */

  public async deployRebalancingSetTokenV2FactoryAsync(
    coreAddress: Address,
    componentWhitelistAddress: Address,
    liquidatorWhitelistAddress: Address,
    rebalanceFeeWhiteListAddress: Address,
    minimumRebalanceInterval: BigNumber = ONE_DAY_IN_SECONDS,
    minimumFailRebalancePeriod: BigNumber = ONE_DAY_IN_SECONDS,
    maximumFailRebalancePeriod: BigNumber = ONE_DAY_IN_SECONDS.mul(30),
    minimumNaturalUnit: BigNumber = DEFAULT_REBALANCING_MINIMUM_NATURAL_UNIT,
    maximumNaturalUnit: BigNumber = DEFAULT_REBALANCING_MAXIMUM_NATURAL_UNIT,
    from: Address = this._tokenOwnerAddress
  ): Promise<string> {
    const instance = await new web3.eth.Contract(RebalancingSetTokenV2Factory.abi).deploy({
      data: RebalancingSetTokenV2Factory.bytecode,
      arguments: [
        coreAddress,
        componentWhitelistAddress,
        liquidatorWhitelistAddress,
        rebalanceFeeWhiteListAddress,
        minimumRebalanceInterval.toString(),
        minimumFailRebalancePeriod.toString(),
        maximumFailRebalancePeriod.toString(),
        minimumNaturalUnit.toString(),
        maximumNaturalUnit.toString(),
      ],
    }).send({ from, gas: DEFAULT_GAS });

    return instance.options.address;
  }

  public async createSetTokenAsync(
    core: CoreContract,
    factory: Address,
    componentAddresses: Address[],
    units: BigNumber[],
    naturalUnit: BigNumber,
    name: string = 'Set Token',
    symbol: string = 'SET',
    callData: string = '0x0',
    from: Address = this._tokenOwnerAddress,
  ): Promise<SetTokenContract> {
    const encodedName = SetUtils.stringToBytes(name);
    const encodedSymbol = SetUtils.stringToBytes(symbol);

    // Creates and registers the Set with Core as enabled
    const txHash = await core.createSet.sendTransactionAsync(
      factory,
      componentAddresses,
      units,
      naturalUnit,
      encodedName,
      encodedSymbol,
      callData,
      { from, gas: DEFAULT_GAS },
    );

    const logs = await setTestUtils.getLogsFromTxHash(txHash);
    const setAddress = extractNewSetTokenAddressFromLogs(logs);

    return await SetTokenContract.at(
      setAddress,
      web3,
      { from, gas: DEFAULT_GAS }
    );
  }

  public async createRebalancingTokenAsync(
    core: CoreContract,
    factory: Address,
    componentAddresses: Address[],
    units: BigNumber[],
    naturalUnit: BigNumber,
    callData: string = '',
    name: string = 'Rebalancing Set Token',
    symbol: string = 'RBSET',
    from: Address = this._tokenOwnerAddress,
  ): Promise<RebalancingSetTokenContract> {
    const encodedName = SetUtils.stringToBytes(name);
    const encodedSymbol = SetUtils.stringToBytes(symbol);

    const txHash = await core.createSet.sendTransactionAsync(
      factory,
      componentAddresses,
      units,
      naturalUnit,
      encodedName,
      encodedSymbol,
      callData,
      { from, gas: DEFAULT_GAS },
    );

    const logs = await setTestUtils.getLogsFromTxHash(txHash);
    const setAddress = extractNewSetTokenAddressFromLogs(logs);

    return await RebalancingSetTokenContract.at(
      setAddress,
      web3,
      { from, gas: DEFAULT_GAS }
    );
  }

  public async createDefaultRebalancingSetTokenAsync(
    core: CoreContract,
    factory: Address,
    manager: Address,
    initialSet: Address,
    proposalPeriod: BigNumber,
    initialUnitShares: BigNumber = DEFAULT_UNIT_SHARES,
  ): Promise<RebalancingSetTokenContract> {
    // Generate defualt rebalancingSetToken params
    const rebalanceInterval = ONE_DAY_IN_SECONDS;
    const callData = SetUtils.generateRebalancingSetTokenCallData(
      manager,
      proposalPeriod,
      rebalanceInterval,
    );

    // Create rebalancingSetToken
    return await this.createRebalancingTokenAsync(
      core,
      factory,
      [initialSet],
      [initialUnitShares],
      DEFAULT_REBALANCING_NATURAL_UNIT,
      callData,
    );
  }

  public async getSetTokenAsync(
    setTokenAddress: Address,
  ): Promise<SetTokenContract> {
    return new SetTokenContract(
      new web3.eth.Contract(SetToken.abi, setTokenAddress),
      { from: this._tokenOwnerAddress },
    );
  }

  public async getRebalancingSetTokenV2Async(
    setTokenAddress: Address,
  ): Promise<RebalancingSetTokenV2Contract> {
    return new RebalancingSetTokenV2Contract(
      new web3.eth.Contract(RebalancingSetTokenV2.abi, setTokenAddress),
      { from: this._tokenOwnerAddress },
    );
  }

  public async addTokenToWhiteList(
    address: Address,
    whiteList: WhiteListContract,
    from: Address = this._tokenOwnerAddress,
  ): Promise<void> {
    await whiteList.addAddress.sendTransactionAsync(
      address,
      { from, gas: DEFAULT_GAS },
    );
  }
}
